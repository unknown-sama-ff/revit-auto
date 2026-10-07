#!/usr/bin/env node
// Administrator CLI only, deliberately not registered as an MCP tool.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {familyLoadSchema} from './family-load.mjs';
const root=path.resolve(import.meta.dirname,'../families');
const [key,relativePath,expectedFamilyName,categoryText,...requiredTypes]=process.argv.slice(2);
if(!key||!relativePath||!expectedFamilyName||!categoryText||requiredTypes.length===0)throw new Error('Usage: node register-family-asset.mjs <familyKey> <relativeRfaPath> <expectedExactFamilyName> <negativeCategoryId> <exactTypeNames...>');
if(expectedFamilyName!==expectedFamilyName.trim()||requiredTypes.some(t=>t!==t.trim()))throw new Error('Family and type names must not have leading or trailing whitespace.');
familyLoadSchema.parse({families:[{familyKey:key,conflictPolicy:'reject',overwriteTypeParameters:false}]});
const expectedCategoryId=Number(categoryText);
if(!Number.isSafeInteger(expectedCategoryId)||expectedCategoryId>=0||expectedCategoryId<-10000000)throw new Error('Explicit built-in category ID required.');
if(requiredTypes.length>200||new Set(requiredTypes).size!==requiredTypes.length||requiredTypes.some(t=>!t.trim()||t.length>200)||expectedFamilyName.length>200)throw new Error('Reviewed distinct family/type names are required.');
const parts=relativePath.split(/[\\/]/);
if(path.isAbsolute(relativePath)||relativePath.includes(':')||/[?*]/.test(relativePath)||parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p))||path.extname(relativePath).toLowerCase()!=='.rfa')throw new Error('RFA must have a relative path inside families/.');
const file=path.resolve(root,relativePath);
if(!file.startsWith(root+path.sep))throw new Error('Outside approved library.');
let check=file;for(;;){if((await fs.lstat(check)).isSymbolicLink())throw new Error('Symlinks/junctions not allowed.');const parent=path.dirname(check);if(parent===check)break;check=parent;}
const stat=await fs.stat(file);if(!stat.isFile()||stat.size<=0||stat.size>100*1024*1024)throw new Error('Approved RFA must be nonempty and at most100MB.');
const hash=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const catalogPath=path.join(root,'library.json');let catalog={schemaVersion:1,assets:[]};
try{const stats=await fs.lstat(catalogPath);if(stats.isSymbolicLink())throw new Error('Catalog cannot be a symlink.');catalog=JSON.parse((await fs.readFile(catalogPath,'utf8')).replace(/^\uFEFF/,''));}catch(e){if(e.code!=='ENOENT')throw e;}
if(catalog.schemaVersion!==1||!Array.isArray(catalog.assets)||catalog.assets.length>=1000||catalog.assets.some(a=>a.familyKey===key))throw new Error('Invalid catalog, full catalog or duplicate key. Do not overwrite a previously reviewed asset silently.');
// Backup is append-only; registering metadata does not load or inspect the native RFA.
try{await fs.copyFile(catalogPath,catalogPath+'.backup-'+Date.now(),fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='ENOENT')throw e;}
catalog.assets.push({familyKey:key,relativePath,sha256:hash,expectedFamilyName,expectedCategoryId,requiredTypes});
await fs.writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({familyKey:key,sha256:hash,expectedFamilyName,requiredTypes,registeredOnly:true,nativeMetadataNotYetVerified:true}));


