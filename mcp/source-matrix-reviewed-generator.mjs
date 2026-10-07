import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const production={
 'architecture.csx':['architecture.build','建筑主体',['create_grid','create_wall','create_floor','create_family_instance']],
 'create-circuits.csx':['electrical.circuit','回路与配电盘',['set_parameter','create_circuit']],
 'create-wires.csx':['electrical.wire','导线与显式替换',['delete_element','create_wire']],
 'create-sheets.csx':['electrical.sheet','图纸与配电盘表',['create_view_plan','create_sheet','create_panel_schedule','place_viewport']],
 'fix-sheet-layout.csx':['electrical.sheet','图纸视口布局',['configure_view','place_viewport']],
 'mark-flush-mount.csx':['lighting.full','灯具安装参数',['set_parameter']],
 'name-circuits.csx':['electrical.circuit','回路命名',['set_parameter']],
 'openings.csx':['architecture.openings','宿主门窗及类型复制',['duplicate_type','create_family_instance']],
 'place-lighting.csx':['lighting.place','照明设备放置',['create_family_instance']],
 'rooms.csx':['architecture.rooms','封闭房间',['create_room']],
 'stairs.csx':['architecture.stairs','楼梯梯段平台',[]],
 'load-families.csx':['families.load','族库加载',[]]
};
const catalog={
 'audit-final.csx':['audit','模型类别和警告审计'],
 'audit-template.csx':['families.audit','外部样板族目录'],
 'audit-windows.csx':['families.audit','外部门窗RFA参数审计'],
 'check-families.csx':['families.audit','当前模型精确族名目录'],
 'inspect-control.csx':['diagnostics.query','电气控制参数检查'],
 'inspect-distribution.csx':['diagnostics.query','配电系统类型检查'],
 'inspect-enums.csx':['diagnostics.query','电气API枚举参考'],
 'inspect-layout.csx':['architecture.documentation','当前图纸视口关系'],
 'inspect-panel-api.csx':['diagnostics.query','配电盘API反射参考'],
 'inspect-power.csx':['diagnostics.query','设备电气类型与参数'],
 'inspect-revit-api.csx':['diagnostics.query','Revit API反射参考'],
 'inspect-schedule-api.csx':['diagnostics.query','明细表API反射参考'],
 'inspect-stair-api.csx':['architecture.stairs','楼梯API反射参考'],
 'inspect-stair-detail.csx':['architecture.stairs','楼梯原生构件检查'],
 'inspect-stairs.csx':['architecture.stairs','楼梯系统构件与参数'],
 'inspect-symbols.csx':['families.audit','当前族类型检查'],
 'inspect-titleblocks.csx':['architecture.documentation','图框族类型检查'],
 'inspect-types.csx':['families.audit','当前模型系统与族类型'],
 'inspect-views.csx':['architecture.documentation','当前模型视图检查'],
 'inspect-wire.csx':['diagnostics.query','当前导线类型和配置检查'],
 'probe.csx':['diagnostics.query','API或原生属性探针']
};
const tests={
 'inspect-connectors.csx':['pump_room.connect','临时实例的连接器探针'],
 'inspect-electrical.csx':['electrical.circuit','临时电气回路探针'],
 'test-220-system.csx':['electrical.circuit','220V配电类型事务探针'],
 'test-a1-sheet.csx':['electrical.sheet','A1图纸事务验收参考'],
 'test-circuit.csx':['electrical.circuit','电气回路事务验收参考'],
 'test-copy-types.csx':['lighting.full','族类型复制事务探针'],
 'test-electrical-placement.csx':['lighting.place','电气设备放置事务探针'],
 'test-load-window.csx':['families.load','外部族加载事务探针'],
 'test-panels.csx':['electrical.circuit','配电盘类型事务探针'],
 'test-schedule.csx':['electrical.sheet','配电盘明细表事务探针'],
 'test-stair-repair.csx':['architecture.stairs','楼梯修复事务参考'],
 'test-three-phase-panel.csx':['electrical.circuit','三相配电盘与类型复制参考'],
 'test-wall-hosting.csx':['lighting.place','墙面宿主事务探针'],
 'test-wire.csx':['electrical.wire','导线事务验收参考']
};
const special={
 'export-plan.csx':['architecture.documentation','local-export','视图图像导出'],
 'export-sheets.csx':['electrical.sheet','local-export','图纸图像导出'],
 'save-as.csx':['verification.saved','manual-save-only','旧固定路径自动另存为不得作为AI写入'],
 'verify-saved.csx':['verification.saved','external-document-query','保存后独立重开核验参考']
};
const rows=[];
for(const source of fs.readdirSync(root).filter(p=>p.endsWith('.csx')).sort()){
 const text=fs.readFileSync(path.join(root,source),'utf8');
 const descriptor=production[source]||catalog[source]||tests[source]||special[source];
 if(!descriptor)throw Error('Unclassified legacy source: '+source);
 const workflow=descriptor[0];
 const productionPort=Boolean(production[source])&&source!=='stairs.csx'&&source!=='load-families.csx';
 const exactCatalog=source==='check-families.csx';
 const status=source==='save-as.csx'?'intentionally-not-exposed':exactCatalog?'implemented-and-accepted':productionPort?'implemented-not-accepted':'legacy-source-needs-redesign';
 rows.push({legacyFeature:production[source]?descriptor[1]:descriptor.at(-1),legacyScript:source,newWorkflow:workflow,sourceRole:production[source]?'production':tests[source]?'test-reference':special[source]?descriptor[1]:'query-reference',
   supportedInputs:exactCatalog?'explicit exact family names, reviewed document/revision':productionPort?'explicit current-document type/host/level/geometry and parameters':'pending adapter-specific structured inputs',
   generatedOperations:production[source]?production[source][2]:[],readOnlyQueries:exactCatalog?['revit.context.get','revit.search']:['revit.context.get','revit.inspect'],
   writeCategories:production[source]?'adapter-declared affectedCategories':'none in current source port',
   rollbackScope:production[source]?'single approved TransactionGroup, original baseline and receipt':'not-applicable-reference-or-read',acceptanceStatus:status,
   runtimeExecutionAllowed:false,sideEffectReview:{originalUsesTransaction:/new Transaction|StairsEditScope/.test(text),originalContainsRollback:/\.RollBack\(|\.Rollback\(/.test(text),originalAutoSaves:/\.Save\(|\.SaveAs\(/.test(text),originalUsesFixedWindowsPath:/[A-Za-z]:\\/.test(text)},
   acceptanceEvidence:exactCatalog?'Native current-document catalog and real stdio workflow/direct-tool equality; 12 read-only checks passed on 2026-10-07. See docs/legacy-feature-matrix.md.':null,
   migrationNotes:source==='openings.csx'?'Door/window families only. This source does not implement wall or shaft Opening API.':source==='save-as.csx'?'Manual save by user; future verification is read-only. No silent SaveAs port.':tests[source]?'Reference regression scenario, never executable through MCP.':source==='audit-template.csx'||source==='audit-windows.csx'?'External template/RFA inspection not covered by active-document family catalog; keep pending.':source==='stairs.csx'?'StairsEditScope needs dedicated transaction integration; do not pretend a family placement is an equivalent port.':'Native result, rollback and manual-save acceptance remains required.'});
}
rows.push({legacyFeature:'Preflight族提取与Build占位',legacyScript:'ModelBuilder.cs',newWorkflow:'families.load',sourceRole:'prototype',supportedInputs:'pending explicit file provenance and template family source',generatedOperations:[],readOnlyQueries:['revit.context.get'],writeCategories:['Family','FamilySymbol'],rollbackScope:'pending controlled native adapter',acceptanceStatus:'legacy-source-needs-redesign',runtimeExecutionAllowed:false,sideEffectReview:{originalUsesTransaction:false,originalContainsRollback:false,originalAutoSaves:true,originalUsesFixedWindowsPath:true},migrationNotes:'Preflight exports template families; Build throws NotImplementedException in this checkout. It is not proof of a working legacy pipe/duct builder.'});
fs.writeFileSync(path.join(root,'mcp/legacy-source-matrix.json'),JSON.stringify({schemaVersion:1,generatedFrom:'Reviewed root .csx sources and ModelBuilder.cs; metadata only, no runtime script execution.',statuses:{'implemented-and-accepted':'已迁移并验收','implemented-not-accepted':'已迁移但未验收','implemented-needs-safe-adapter':'已实现但新版缺失安全适配','legacy-source-needs-redesign':'旧版存在但需要重新设计','intentionally-not-exposed':'明确不再支持（仅此自动执行行为）'},sources:rows},null,2)+'\n');
console.log(JSON.stringify({scripts:rows.length-1,allSources:rows.length,counts:Object.fromEntries([...new Set(rows.map(r=>r.acceptanceStatus))].map(s=>[s,rows.filter(r=>r.acceptanceStatus===s).length]))},null,2));
