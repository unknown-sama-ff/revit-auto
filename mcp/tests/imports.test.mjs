import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, mapRows, drawingCandidates } from '../imports.mjs';

test('parses quoted CSV without formula execution', () => {
  const rows = parseDelimited('family,type,xMm,yMm\n"灯具","300x1200",1000,2000\n');
  assert.deepEqual(rows,[{family:'灯具',type:'300x1200',xMm:'1000',yMm:'2000'}]);
});
test('rejects malformed CSV quotes', () => assert.throws(() => parseDelimited('a,b\n"bad,2\n'), /unterminated/));
test('requires explicit import mapping', () => assert.match(mapRows([{family:'f'}]).issues[0].message, /mapping is required/));
test('maps numeric table fields and validates operations', () => {
  const result = mapRows([{family:'灯具',type:'300x1200',levelId:'1',xMm:'1000',yMm:'2000'}],{family:'family',type:'type',levelId:'levelId',xMm:'xMm',yMm:'yMm'},{operationType:'create_family_instance'});
  assert.equal(result.issues.length,0); assert.equal(result.operations[0].xMm,1000);
});
test('drawing import is candidate-only and calibrated', () => {
  const result=drawingCandidates({entities:[{objectName:'AcDbLine',layer:'wall',start:{x:0,y:0,z:0},end:{x:10,y:0,z:0}}]}, {scaleMmPerUnit:100,origin:{x:0,y:0},offsetMm:{x:0,y:0,z:0},rotationDegrees:0,levelId:1}, {wall:{operationType:'create_wall',wallTypeId:2,heightMm:3000}});
  assert.equal(result.candidateOnly,true); assert.equal(result.operations[0].start.xMm,0); assert.equal(result.operations[0].end.xMm,1000);
});
test('drawing import refuses missing calibration', () => assert.throws(() => drawingCandidates({entities:[]},null,{}), /calibration/));


import { zipSync,strToU8 } from 'fflate';
import { readXlsx } from '../imports.mjs';
function workbook(sheet,shared){
  const entries={
    '[Content_Types].xml':strToU8('<Types/>'),
    'xl/workbook.xml':strToU8('<workbook><sheets><sheet name="设备" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml':strToU8(sheet)
  };if(shared)entries['xl/sharedStrings.xml']=strToU8(shared);return zipSync(entries);
}
test('multiline CSV and escaped quotes are preserved',()=>assert.deepEqual(parseDelimited('name,note\r\nA,"a\r\nb"\r\nB,"a""b"'),[{name:'A',note:'a\r\nb'},{name:'B',note:'a"b'}]));
test('duplicate headers and malformed row lengths are rejected',()=>{assert.throws(()=>parseDelimited('a,a\n1,2'),/unique/);assert.throws(()=>parseDelimited('a,b\n1,2,3'),/expected/);});
test('XLSX inline strings and numeric values are read accurately',()=>{
  const bytes=workbook('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>xMm</t></is></c><c r="B1" t="inlineStr"><is><t>name</t></is></c></row><row><c r="A2"><v>1000</v></c><c r="B2" t="inlineStr"><is><t>灯具 &amp; 开关</t></is></c></row></sheetData></worksheet>');
  assert.deepEqual(readXlsx(bytes),[{xMm:'1000',name:'灯具 & 开关'}]);
});
test('XLSX shared strings and sparse blank cells are supported',()=>{
  const bytes=workbook('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="B2" t="s"><v>2</v></c></row></sheetData></worksheet>','<sst><si><t>family</t></si><si><t>type</t></si><si><r><t>300</t></r><r><t>x1200</t></r></si></sst>');
  assert.deepEqual(readXlsx(bytes),[{family:'',type:'300x1200'}]);
});
test('XLSX formulas and XML entities are rejected instead of using stale cached values',()=>{
  assert.throws(()=>readXlsx(workbook('<worksheet><sheetData><row><c r="A1"><f>SUM(A2)</f><v>10</v></c></row></sheetData></worksheet>')),/Formula/);
  assert.throws(()=>readXlsx(workbook('<!DOCTYPE worksheet [<!ENTITY x "bad">]><worksheet/>')),/entity/);
});
test('CSV formulas cannot become numeric model parameters',()=>assert.ok(mapRows([{operationType:'create_level',name:'Bad',elevationMm:'=SUM(1,2)'}]).issues.length));
