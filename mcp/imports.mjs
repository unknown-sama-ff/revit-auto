import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { validateOperations } from './workflows.mjs';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 1000;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, processEntities: true });
const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
function within(root, file) { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
export async function permittedPath(file) {
  const roots = (process.env.REVIT_AI_IMPORT_ROOTS || ROOT).split(path.delimiter);
  const resolved = await fs.realpath(path.resolve(file));
  const allowed = await Promise.all(roots.map(root => fs.realpath(root)));
  if (!allowed.some(root => within(root, resolved))) throw new Error('Input file is outside the configured import roots. Place it in the workspace or configure REVIT_AI_IMPORT_ROOTS.');
  if (resolved.toLowerCase().includes(`${path.sep}runtime${path.sep}`)) throw new Error('Bridge runtime and authentication files cannot be imported.');
  if ((await fs.stat(resolved)).size > MAX_BYTES) throw new Error('Input is larger than the 20 MB import limit.');
  return resolved;
}
export function parseDelimited(input, separator = ',') {
  input = input.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let field = ''; let quoted = false; let closed = false;
  const push = () => { row.push(field); field = ''; closed = false; };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) { if (c === '"') { if (input[i+1] === '"') {field += '"'; i++;} else { quoted = false; closed = true; } } else field += c; continue; }
    if (c === '"') { if (field || closed) throw new Error('Malformed CSV quote.'); quoted = true; }
    else if (c === separator) push();
    else if (c === '\r' || c === '\n') { if (c === '\r' && input[i+1] === '\n') i++; push(); if (row.some(v => v !== '')) rows.push(row); row = []; }
    else { if (closed) throw new Error('Unexpected text after CSV closing quote.'); field += c; }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length || closed) { push(); if (row.some(v => v !== '')) rows.push(row); }
  return records(rows);
}
function records(matrix) {
  if (!matrix.length) throw new Error('Input table is empty.');
  const headers = matrix[0].map(v => String(v).trim());
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('Headers must be non-empty and unique.');
  if (matrix.length - 1 > MAX_ROWS) throw new Error(`Table exceeds ${MAX_ROWS} rows.`);
  return matrix.slice(1).map((values,i) => {
    if (values.length > headers.length || values.length < headers.length) throw new Error(`Row ${i+2} has ${values.length} cells; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h,index) => [h,values[index]]));
  });
}
export function readXlsx(bytes, sheetName) {
  // Validate central-directory sizes before extraction; reject zip64, external links and macros.
  const buffer = Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end = -1;
  for (let i = bytes.length-22; i >= Math.max(0,bytes.length-65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Invalid XLSX ZIP container.');
  const count = buffer.readUInt16LE(end+10); let offset = buffer.readUInt32LE(end+16); let expanded = 0;
  if (count > 1000 || count === 65535) throw new Error('XLSX archive has too many entries or uses ZIP64.');
  for (let index = 0; index < count; index++) {
    if (offset+46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid XLSX central directory.');
    const size = buffer.readUInt32LE(offset+24); const compressed = buffer.readUInt32LE(offset+20); const nameLength = buffer.readUInt16LE(offset+28); const extraLength = buffer.readUInt16LE(offset+30); const commentLength = buffer.readUInt16LE(offset+32);
    expanded += size;
    if (expanded > 40*1024*1024 || size > 8*1024*1024 || compressed > MAX_BYTES) throw new Error('XLSX expanded size exceeds safe limits.');
    const name = buffer.toString('utf8',offset+46,offset+46+nameLength);
    if (name.includes('vbaProject') || name.includes('externalLinks') || name.includes('../')) throw new Error('Macro/external-link workbooks are not accepted for modeling.');
    const local = buffer.readUInt32LE(offset+42);
    if (local+30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid XLSX local entry.');
    const localSize = buffer.readUInt32LE(local+22);
    if (localSize !== 0 && localSize !== size) throw new Error('Inconsistent XLSX entry sizes.');
    offset += 46+nameLength+extraLength+commentLength;
  }
  const entries = unzipSync(bytes);
  const parse = name => { if (!entries[name]) throw new Error(`XLSX entry ${name} missing.`); const text = new TextDecoder().decode(entries[name]); if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML entity declarations are not accepted.'); return xml.parse(text); };
  const workbook = parse('xl/workbook.xml'); const sheets = array(workbook.workbook?.sheets?.sheet);
  if (!sheets.length) throw new Error('Workbook has no sheets.');
  if (!sheetName && sheets.length > 1) throw new Error(`Workbook has multiple sheets. Specify sheetName: ${sheets.map(s => s['@_name']).join(', ')}.`);
  const sheet = sheetName ? sheets.find(s => s['@_name'] === sheetName) : sheets[0];
  if (!sheet) throw new Error(`Worksheet '${sheetName}' not found.`);
  const relationships = array(parse('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
  const relationship = relationships.find(r => r['@_Id'] === sheet['@_r:id']);
  if (!relationship || relationship['@_TargetMode'] === 'External') throw new Error('Invalid worksheet relationship.');
  const target = relationship['@_Target']; const sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize('xl/' + target);
  const shared = entries['xl/sharedStrings.xml'] ? array(parse('xl/sharedStrings.xml').sst?.si).map(si => si.t?.['#text'] ?? si.t ?? array(si.r).map(r => r.t?.['#text'] ?? r.t ?? '').join('')) : [];
  const worksheet = parse(sheetPath); const matrix = [];
  for (const row of array(worksheet.worksheet?.sheetData?.row)) {
    const cells = [];
    for (const cell of array(row.c)) {
      if (cell.f !== undefined) throw new Error(`Formula in cell ${cell['@_r']} must be replaced by an explicit reviewed value.`);
      const match = /^([A-Z]+)[0-9]+$/.exec(cell['@_r']); if (!match) throw new Error('Invalid cell address.');
      let index = 0; for (const c of match[1]) index = index*26 + c.charCodeAt(0)-64; index--;
      if (index > 100) throw new Error('Import tables may contain at most 101 columns.');
      let value = cell.v ?? '';
      if (cell['@_t'] === 's') value = shared[Number(value)] ?? '';
      if (cell['@_t'] === 'inlineStr') value = cell.is?.t?.['#text'] ?? cell.is?.t ?? array(cell.is?.r).map(r => r.t ?? '').join('');
      if (cell['@_t'] === 'e') throw new Error(`Spreadsheet error at ${cell['@_r']}.`);
      cells[index] = value;
    }
    if (cells.some(v => v !== '')) matrix.push(cells);
  }
  if (!matrix.length) throw new Error('Worksheet contains no data.');
  const width = matrix[0].length;
  return records(matrix.map(r => Array.from({length: Math.max(width,r.length)}, (_,i) => r[i] ?? '')));
}
const numericFields = new Set(['xMm','yMm','zMm','elevationMm','heightMm','widthMm','diameterMm','rotationDegrees','scale']);
export function mapRows(rows, mapping = {}, defaults = {}) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) throw new Error(`Provide 1..${MAX_ROWS} table rows.`);
  const issues = []; const operations = [];
  rows.forEach((row,index) => {
    try {
      let op;
      if (row.operationType && typeof row.operationType === 'string' && !Object.keys(mapping).length) op = {...defaults,...row};
      else {
        if (!Object.keys(mapping).length) throw new Error('mapping is required: destination field -> source column. No automatic family/type guessing is performed.');
        op = {...defaults}; for (const [destination,column] of Object.entries(mapping)) { if (!(column in row)) throw new Error(`Missing column ${column}.`); op[destination] = row[column]; }
      }
      for (const [field,value] of Object.entries(op)) {
        if (value === '' || value === undefined || value === null) {delete op[field]; continue;}
        if (typeof value === 'string' && (numericFields.has(field) || /Id$/.test(field) && !value.startsWith('@'))) { if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) throw new Error(`${field} is not numeric.`); op[field] = Number(value); }
        if (typeof value === 'string' && ['parameters','boundary','start','end','elementIds','fields','bends','point'].includes(field)) op[field] = JSON.parse(value);
      }
      operations.push(op);
    } catch (error) {issues.push({row:index+2,message:error.message});}
  });
  if (!issues.length) {try {validateOperations(operations);} catch (error) {issues.push({message:error.message});}}
  return {operations, issues};
}
export function drawingCandidates(data, calibration, layerMapping = {}) {
  if (!calibration || !Number.isFinite(calibration.scaleMmPerUnit) || calibration.scaleMmPerUnit <= 0 || !calibration.origin || !calibration.offsetMm) throw new Error('Drawing import requires scaleMmPerUnit, origin {x,y}, offsetMm {x,y,z}, rotationDegrees and levelId calibration.');
  const c = calibration;
  for (const value of [c.origin.x,c.origin.y,c.offsetMm.x,c.offsetMm.y,c.offsetMm.z,c.rotationDegrees ?? 0]) if (!Number.isFinite(value)) throw new Error('Invalid coordinate calibration.');
  if (!(Number.isSafeInteger(c.levelId) && c.levelId > 0)) throw new Error('Calibration needs levelId.');
  const theta = (c.rotationDegrees || 0)*Math.PI/180;
  const transform = p => {
    const x = (p.x-c.origin.x)*c.scaleMmPerUnit; const y = (p.y-c.origin.y)*c.scaleMmPerUnit;
    return { xMm: c.offsetMm.x + x*Math.cos(theta)-y*Math.sin(theta), yMm: c.offsetMm.y+x*Math.sin(theta)+y*Math.cos(theta), zMm:c.offsetMm.z+(p.z || 0)*c.scaleMmPerUnit };
  };
  const entities = Array.isArray(data) ? data : data.entities;
  if (!Array.isArray(entities)) throw new Error('Drawing data must contain an entities array.');
  const candidates = []; const issues = []; const text = [];
  for (const entity of entities) {
    if (entity.text) text.push({layer:entity.layer,text:entity.text});
    const mapping = layerMapping[entity.layer]; if (!mapping) continue;
    const template = {...mapping,levelId:c.levelId};
    if (entity.start && entity.end) candidates.push({...template,start:transform(entity.start),end:transform(entity.end)});
    else if (entity.insertion && (entity.objectName?.includes('Block') || entity.name)) candidates.push({...template,...transform(entity.insertion),rotationDegrees:(entity.rotation || 0)*180/Math.PI+(c.rotationDegrees||0)});
    else if (entity.closed && entity.coordinates && template.operationType === 'create_floor') {
      const stride = entity.objectName?.includes('2d') || entity.objectName?.includes('3d') ? 3 : 2;
      const boundary = []; for (let i=0;i<entity.coordinates.length;i+=stride) boundary.push(transform({x:entity.coordinates[i],y:entity.coordinates[i+1],z:stride===3?entity.coordinates[i+2]:0}));
      candidates.push({...template,boundary});
    } else issues.push({entity:entity.handle || entity.index,layer:entity.layer,message:'Mapped entity geometry needs manual interpretation (arcs/hatches/polylines are not guessed).'});
  }
  if (candidates.length > MAX_ROWS) throw new Error('Drawing produced too many candidates; restrict the selected layers.');
  return {operations:candidates,issues,text:text.slice(0,100),candidateOnly:true};
}
export async function importInput(args) {
  let rows = args.rows; let data; let isImage = args.format === 'image';
  if (args.filePath) {
    const file = await permittedPath(args.filePath); const extension = path.extname(file).toLowerCase();
    if (extension === '.dwg') {
      if (!args.calibration) throw new Error('DWG import requires calibration before extracting data.');
      const out = path.resolve(import.meta.dirname,'..','imports',`${randomUUID()}.json`); await fs.mkdir(path.dirname(out),{recursive:true});
      await exec('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(import.meta.dirname,'export-dwg.ps1'),'-InputPath',file,'-OutputPath',out],{windowsHide:true,timeout:60000,maxBuffer:1024*1024});
      data = JSON.parse((await fs.readFile(out,'utf8')).replace(/^\uFEFF/,''));
    } else if (['.png','.jpg','.jpeg','.webp'].includes(extension)) {
      isImage = true;
      if (!args.candidates) return {needsVision:true,message:'Use the assistant vision capability to inspect this image, then pass explicitly reviewed candidates and calibration. This bridge does not have its own vision model or send images to a third party.',source:file};
      rows = args.candidates;
    } else if (extension === '.xlsx') rows = readXlsx(new Uint8Array(await fs.readFile(file)),args.sheetName);
    else if (['.csv','.tsv'].includes(extension)) rows = parseDelimited(await fs.readFile(file,'utf8'),extension === '.tsv'?'\t':',');
    else if (extension === '.json') {const parsed = JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')); if (args.format === 'dwg' || parsed.entities) data = parsed; else rows = Array.isArray(parsed)?parsed:parsed.rows || parsed.operations;}
    else throw new Error(`Unsupported import format ${extension}. Old .xls files must be saved as .xlsx.`);
  }
  if (data) return drawingCandidates(data,args.calibration,args.layerMapping);
  if (isImage) {
    if (!args.calibration || !args.candidates) throw new Error('Image candidates require manual scale/origin/level calibration.');
    // Assistant candidates are entities in pixel coordinates, then pass through the same reviewed calibration path.
    return drawingCandidates(args.candidates,args.calibration,args.layerMapping);
  }
  return {...mapRows(rows,args.mapping,args.defaults),candidateOnly:false};
}
