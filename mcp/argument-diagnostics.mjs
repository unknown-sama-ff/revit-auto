// Adapted from bimwright/rvt-mcp ToolArgumentGuard.cs (Apache-2.0).
// Source and modifications: ../THIRD_PARTY_NOTICES.md.
const MAX_KEYS=32,MAX_NAME_LENGTH=64;
const normalize=key=>key.replaceAll('_','').replaceAll('-','').toLowerCase();
export function clipArgumentName(key){
 if(key.length<=MAX_NAME_LENGTH)return key;
 let end=MAX_NAME_LENGTH;
 if(end<key.length&&/[\uD800-\uDBFF]/.test(key[end-1])&&/[\uDC00-\uDFFF]/.test(key[end]))end--;
 return key.slice(0,end);
}
export function suggestArgumentName(key,expected){
 const normalized=normalize(key);if(!normalized)return null;
 const matches=[...new Set(expected)].filter(name=>normalize(name)===normalized);
 return matches.length===1&&matches[0]!==key?matches[0]:null;
}
export function describeArgumentKeys(received,expected,required=[]){
 for(const list of [received,expected,required])
  if(!Array.isArray(list)||list.some(k=>typeof k!=='string'))throw new TypeError('Argument diagnostics accepts key-name arrays only.');
 const keys=[...new Set(received)],allowed=[...new Set(expected)],mandatory=[...new Set(required)];
 if(mandatory.some(k=>!allowed.includes(k)))throw new TypeError('Required keys must be declared.');
 const unknown=keys.filter(k=>!allowed.includes(k)),missing=mandatory.filter(k=>!keys.includes(k));
 return {missing:missing.slice(0,MAX_KEYS).map(clipArgumentName),
  unknown:unknown.slice(0,MAX_KEYS).map(key=>{const suggestion=suggestArgumentName(key,allowed);
   return {key:clipArgumentName(key),...(suggestion?{did_you_mean:clipArgumentName(suggestion)}:{})};}),
  received:keys.slice(0,MAX_KEYS).map(clipArgumentName),expected:allowed.slice(0,MAX_KEYS).map(clipArgumentName),
  counts:{received:keys.length,expected:allowed.length,unknown:unknown.length,missing:missing.length},
  keysTruncated:[keys,allowed,unknown,missing].some(a=>a.length>MAX_KEYS),
  namesClipped:[...keys,...allowed].some(k=>k.length>MAX_NAME_LENGTH),valuesIncluded:false};
}
