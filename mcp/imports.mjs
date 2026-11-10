import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { validateOperations } from './workflows.mjs';
import {drawingCandidates,validateCalibration,validateLayerMapping} from './drawing-candidates.mjs';
export {drawingCandidates} from './drawing-candidates.mjs';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 1000;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, processEntities: true });
const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
function within(root, file) { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
export async function permittedPath(file) {
  if(typeof file!=='string'||!file||/^(?:\\|\/\/|https?:|file:)/i.test(file))throw new Error('Imports require a local filesystem path; network shares and URLs are not accepted.');
  const roots = (process.env.REVIT_AI_IMPORT_ROOTS || ROOT).split(path.delimiter).filter(Boolean);
  if(roots.some(root=>/^(?:\\|\/\/|https?:|file:)/i.test(root)))throw new Error('Configured import roots must be local directories.');
  const resolved = await fs.realpath(path.resolve(file));
  const allowed = await Promise.all(roots.map(root => fs.realpath(root)));
  if (!allowed.some(root => within(root, resolved))) throw new Error('Input file is outside the configured import roots. Place it in the workspace or configure REVIT_AI_IMPORT_ROOTS.');
  if (resolved.toLowerCase().includes(`${path.sep}runtime${path.sep}`)) throw new Error('Bridge runtime and authentication files cannot be imported.');
  const stat=await fs.stat(resolved);if(!stat.isFile())throw new Error('Input must be a regular local file.');
  if (stat.size > MAX_BYTES) throw new Error('Input is larger than the 20 MB import limit.');
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
function tableRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validationField(error, op) {
  const message=error.message||'';
  const required=/^(?:[a-z_]+: )?([A-Za-z][A-Za-z0-9]*) is required\./.exec(message);
  const invalid=/^Invalid ([A-Za-z][A-Za-z0-9]*):/.exec(message);
  if(required||invalid)return (required||invalid)[1];
  const numeric=/^([A-Za-z][A-Za-z0-9]*) must be a (positive )?finite number/.exec(message);
  if(numeric){
    const [,,positive]=numeric,field=numeric[1];
    const invalidNumber=value=>typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e8||positive&&value<=0;
    if(Object.hasOwn(op,field))return field;
    for(const container of ['point','start','end','paperPoint','firstConnector.point','secondConnector.point','cropBounds.min','cropBounds.max']){
      const value=container.split('.').reduce((current,key)=>current?.[key],op);
      if(tableRecord(value)&&invalidNumber(value[field]))return container+'.'+field;
    }
    if(Array.isArray(op.boundary)){
      const index=op.boundary.findIndex(point=>!tableRecord(point)||invalidNumber(point[field]));
      if(index>=0)return 'boundary.'+index+'.'+field;
    }
    return field;
  }
  if(message.startsWith('Unsupported operation'))return 'operationType';
  if(message.startsWith('Duplicate or invalid operation id'))return 'id';
  if(message.startsWith('Unresolved dependency')||op.dependencies!==undefined&&!Array.isArray(op.dependencies))return 'dependencies';
  if(message.startsWith('Floor needs'))return 'boundary';
  if(message.startsWith('A circuit needs'))return 'elementIds';
  if(message.startsWith('Point coordinates')){
    if(['create_grid','create_wall','create_pipe','create_duct','create_dimension'].includes(op.operationType))return !op.start?'start':'end';
    return 'point';
  }
  if(message.startsWith('first requires'))return 'firstConnector';
  if(message.startsWith('second requires'))return 'secondConnector';
  if(message.startsWith('Endpoint '))for(const prefix of ['first','second']){
    if(message.startsWith('Endpoint '+op[prefix+'ElementId']+':'))return prefix+(Object.hasOwn(op,prefix+'ConnectorId')?'ConnectorId':'Connector');
  }
  if(message.startsWith('New pipe/duct endpoint requires criteria'))for(const prefix of ['first','second']){
    if(typeof op[prefix+'ElementId']==='string'&&op[prefix+'ElementId'].startsWith('@')&&!op[prefix+'Connector'])return prefix+'Connector';
  }
  if(message.startsWith('Provide explicit known unique view settings'))return 'settings';
  if(message.startsWith('cropBounds'))return 'cropBounds';
  return undefined;
}
function operationIssues(error, row, op) {
  if(Array.isArray(error.issues)&&error.issues.length)return error.issues.map(issue=>({row,...(issue.path?.length?{field:issue.path.join('.')}:{}),message:issue.message}));
  const field=validationField(error,op);
  return [{row,...(field?{field}:{}),message:error.message}];
}
function referencedPriorIds(op, known) {
  const refs=new Set();
  for(const [field,value] of Object.entries(op)){
    if(op.operationType==='load_family'&&field==='expectedCategoryId')continue;
    const ids=field.endsWith('ConnectorId')?[]:field.endsWith('Ids')&&Array.isArray(value)?value:field.endsWith('Id')?[value]:[];
    for(const value of ids)if(typeof value==='string'&&value.startsWith('@')&&known.has(value.slice(1)))refs.add(value.slice(1));
  }
  if(Array.isArray(op.dependencies))for(const dependency of op.dependencies)if(known.has(dependency))refs.add(dependency);
  return refs;
}
export function mapRows(rows, mapping = {}, defaults = {}) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) throw new Error(`Provide 1..${MAX_ROWS} table rows.`);
  if(!tableRecord(mapping)||!tableRecord(defaults))return {operations:[],issues:[{field:!tableRecord(mapping)?'mapping':'defaults',message:'Table mapping and defaults must be objects.'}]};
  const issues=[],operations=[],operationRows=[],known=new Set();
  const destinations=Object.entries(mapping);
  Array.from(rows).forEach((row,index)=>{
    const rowNumber=index+2;
    if(!tableRecord(row)){issues.push({row:rowNumber,field:'row',message:'Each table row must be an object.'});return;}
    let op;
    const rowIssues=[];
    if(typeof row.operationType==='string'&&row.operationType&&!destinations.length)op={...defaults,...row};
    else{
      op={...defaults};
      if(!destinations.length)rowIssues.push({row:rowNumber,field:'mapping',message:'mapping is required: destination field -> source column. No automatic family/type guessing is performed.'});
      for(const [destination,column] of destinations){
        if(!destination.trim()||['__proto__','prototype','constructor'].includes(destination))rowIssues.push({row:rowNumber,field:destination||'mapping',message:'Mapping destination must be an explicit operation field, not an object-prototype key.'});
        else if(typeof column!=='string'||!column.trim())rowIssues.push({row:rowNumber,field:destination,message:'Mapping source column must be a non-empty string.'});
        else if(!Object.hasOwn(row,column))rowIssues.push({row:rowNumber,field:destination,column,message:`Missing column ${column}.`});
        else op[destination]=row[column];
      }
    }
    for(const [field,value] of Object.entries(op)){
      if(value===''||value===undefined||value===null){delete op[field];continue;}
      if(typeof value==='string'&&(numericFields.has(field)||/Id$/.test(field)&&!value.startsWith('@'))){
        if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())||!Number.isFinite(Number(value)))
          rowIssues.push({row:rowNumber,field,message:`${field} is not a finite numeric value.`});
        else op[field]=Number(value);
      }
      if(typeof value==='string'&&['parameters','boundary','start','end','elementIds','fields','bends','point','dependencies','settings','paperPoint','cropBounds','firstConnector','secondConnector','references'].includes(field)){
        try{op[field]=JSON.parse(value);}catch(error){rowIssues.push({row:rowNumber,field,message:`${field} contains invalid JSON: ${error.message}`});}
      }
    }
    if(op.dependencies!==undefined&&!Array.isArray(op.dependencies)&&!rowIssues.some(issue=>issue.field==='dependencies'))
      rowIssues.push({row:rowNumber,field:'dependencies',message:'dependencies must be an array of earlier operation IDs.'});
    const duplicate=typeof op.id==='string'&&known.has(op.id);
    if(duplicate)rowIssues.push({row:rowNumber,field:'id',message:`Duplicate or invalid operation id '${op.id}'.`});
    if(!rowIssues.length){
      // Only validation placeholders establish earlier IDs. They are never returned
      // or executed, and the unchanged full operation sequence is validated below.
      const context=[...referencedPriorIds(op,known)].map(id=>({operationType:'create_level',id,name:'table-reference-validation',elevationMm:0}));
      try{validateOperations([...context,op]);}catch(error){rowIssues.push(...operationIssues(error,rowNumber,op));}
    }
    issues.push(...rowIssues);
    if(typeof op.id==='string'&&op.id.trim()&&op.id.length<=80)known.add(op.id);
    operations.push(op);operationRows.push(rowNumber);
  });
  if(issues.length)return {operations:[],issues};
  try{validateOperations(operations);}catch(error){
    // The full validator owns sequence and connector-reservation rules. Locate
    // its first failing prefix so its plan error still names the source row.
    let failed=operations.length-1;
    for(let index=0;index<operations.length;index++){
      try{validateOperations(operations.slice(0,index+1));}catch{failed=index;break;}
    }
    return {operations:[],issues:operationIssues(error,operationRows[failed],operations[failed])};
  }
  return {operations,issues};
}
export async function importInput(args) {
  let rows = args.rows; let data = args.data ?? (Array.isArray(args.entities)?{entities:args.entities}:undefined); let isImage = args.format === 'image';
  if (args.filePath) {
    const file = await permittedPath(args.filePath); const extension = path.extname(file).toLowerCase();
    if (extension === '.dwg') {
      validateCalibration(args.calibration);validateLayerMapping(args.layerMapping||{});
      const directory=path.resolve(import.meta.dirname,'..','imports');await fs.mkdir(directory,{recursive:true});
      const realDirectory=await fs.realpath(directory);if(!within(await fs.realpath(ROOT),realDirectory))throw new Error('Generated DWG data directory escaped the package root.');
      const out=path.join(realDirectory,randomUUID()+'.json');
      try{
        await exec('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(import.meta.dirname,'export-dwg.ps1'),'-InputPath',file,'-OutputPath',out],{windowsHide:true,timeout:60000,maxBuffer:1024*1024,signal:args.signal});
        const stat=await fs.stat(out);if(stat.size>MAX_BYTES)throw new Error('Extracted DWG data exceeds the 20 MB import limit.');
        data=JSON.parse((await fs.readFile(out,'utf8')).replace(/^\uFEFF/,''));
      }finally{await fs.rm(out,{force:true});}
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
