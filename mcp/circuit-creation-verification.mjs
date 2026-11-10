function fail(message,details){const error=new Error(message);error.code='circuit_creation_not_verified';error.details=details;throw error;}
function itemMap(items){
  if(!Array.isArray(items))fail('Native inspection items are missing.');
  const map=new Map();
  for(const item of items){const id=item?.summary?.id;if(!Number.isSafeInteger(id)||id<=0||map.has(id)||!item.summary)fail('Native inspection contains missing or duplicate element evidence.',{elementId:id});map.set(id,item);}
  return map;
}
function requiredReference(receipt,id){
  const value=receipt?.references?.[id];
  if(!Number.isSafeInteger(value)||value<=0)fail(`Receipt lacks a stable native reference for ${id}.`,{operationId:id});
  return value;
}
function parameter(item,id){return (item.parameters??[]).filter(p=>p.id===id);}
function assertParameter(item,id,predicate,label){
  const values=parameter(item,id);if(values.length!==1||!predicate(values[0]))fail(`Native ${label} parameter is missing or ambiguous.`,{elementId:item.summary.id,parameterId:id});return values[0];
}
function pointDistance(actual,expected){return ['xMm','yMm','zMm'].map(key=>Math.abs((actual?.[key]??NaN)-expected[key]));}
function validIds(ids){return Array.isArray(ids)&&ids.every(id=>Number.isSafeInteger(id)&&id>0)&&new Set(ids).size===ids.length;}
function exactIds(actual,expected){return validIds(actual)&&actual.length===expected.length&&expected.every(id=>actual.includes(id));}

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function exactMemberParameters(before,after,labels,elementId){
  const left=[...(before??[])].sort((a,b)=>a.id-b.id),right=[...(after??[])].sort((a,b)=>a.id-b.id);
  if(left.length!==right.length)fail('Circuit member parameter coverage changed.',{elementId});
  const fields=new Map([[-1140104,'panelName'],[-1140103,'circuitNumber']]);
  for(const id of fields.keys())if(left.filter(p=>p.id===id).length>1||right.filter(p=>p.id===id).length>1)
    fail('Circuit member labels are ambiguous.',{elementId,parameterId:id});
  for(let index=0;index<left.length;index++){
    const a=left[index],b=right[index],field=fields.get(a.id);
    if(!field){
      if(JSON.stringify(stable(a))!==JSON.stringify(stable(b)))fail('An existing circuit member parameter changed outside the reviewed membership.',{elementId,parameterId:a.id});
      continue;
    }
    const expected=labels?.[field];
    const knownEmpty=a.hasValue===true?a.value==='':a.hasValue===false&&(a.value===undefined||a.value===null||a.value==='');
    if(b.id!==a.id||typeof expected!=='string'||!expected.trim()||!knownEmpty||
        a.storageType!=='String'||b.storageType!=='String'||a.readOnly!==true||b.readOnly!==true||
        a.valueSupported!==true||b.valueSupported!==true||b.hasValue!==true||b.value!==expected||
        (Object.hasOwn(a,'formattedValue')&&a.formattedValue!==''&&a.formattedValue!==null)||
        (Object.hasOwn(b,'formattedValue')&&b.formattedValue!==expected))
      fail('Circuit member label does not match the native panel name or circuit number.',{elementId,parameterId:a.id});
    // Only these two native derived strings may change; retain every other metadata field.
    const metadata=({value,formattedValue,hasValue,...rest})=>rest;
    if(JSON.stringify(stable(metadata(a)))!==JSON.stringify(stable(metadata(b))))
      fail('Circuit member label metadata changed.',{elementId,parameterId:a.id});
  }
}
function exactEvidence(beforeItems,afterItems,expectedIds,labels){
  const before=itemMap(beforeItems),after=itemMap(afterItems);
  if(!exactIds([...before.keys()],expectedIds)||!exactIds([...after.keys()],expectedIds))fail('Existing circuit member evidence is incomplete or contains unexpected elements.');
  for(const id of expectedIds){
    const left=before.get(id),right=after.get(id);
    if(JSON.stringify(stable(left?.summary))!==JSON.stringify(stable(right?.summary)))
      fail('An existing circuit member changed outside the reviewed electrical membership.',{elementId:id});
    exactMemberParameters(left?.parameters,right?.parameters,labels,id);
  }
  return {before,after};
}

/**
 * Verify the standalone electrical.circuit path for existing, explicitly
 * selected loads/switches. This only checks frozen native evidence; it never
 * submits a plan or saves the document.
 */
export function verifyExistingElectricalCircuitCreation({plan,receipt,beforeItems,afterItems,afterCircuit,beforePanel,afterPanel,beforeCounts,afterCounts}){
  if(receipt?.status!=='committed'||receipt.completedOperationCount!==1||receipt.saved!==false||receipt.automaticSave===true)
    fail('Receipt does not prove one unsaved existing-member circuit commit.',{receipt});
  if(!Array.isArray(plan?.operations)||plan.operations.length!==1||plan.operations[0]?.operationType!=='create_circuit')
    fail('Plan is not the reviewed standalone existing-member circuit operation.');
  const operation=plan.operations[0];
  const loads=operation.elementIds,switches=operation.switchIds??[],selected=[...loads,...switches];
  if(!validIds(loads)||!validIds(switches)||new Set(selected).size!==selected.length||selected.includes(operation.panelId))
    fail('The reviewed circuit scope contains invalid or overlapping native IDs.');
  const circuitId=requiredReference(receipt,operation.id);
  if(!exactIds(receipt.createdElementIds,[circuitId]))fail('Receipt does not contain exactly the new circuit reference.',{circuitId});
  const evidence=exactEvidence(beforeItems,afterItems,selected,afterCircuit?.electrical);
  const circuit=afterCircuit;
  if(circuit?.summary?.id!==circuitId||circuit.summary.className!=='ElectricalSystem'||circuit.summary.categoryId!==-2008037)
    fail('Created element is not the reviewed native ElectricalSystem.',{circuitId,summary:circuit?.summary});
  if(circuit.electrical?.panelId!==operation.panelId)fail('Created circuit is assigned to a different panel.',{circuitId});
  if(operation.name!==undefined&&circuit.electrical?.loadName!==operation.name)fail('Created circuit load name differs from the reviewed name.',{circuitId});
  if(!exactIds(circuit.electrical?.memberIds,selected))fail('Created circuit membership differs from the reviewed loads and switches.',{circuitId});
  const panelBefore=beforePanel?.electrical?.systemIds,panelAfter=afterPanel?.electrical?.systemIds;
  if(beforePanel?.summary?.id!==operation.panelId||afterPanel?.summary?.id!==operation.panelId||!validIds(panelBefore)||!exactIds(panelAfter,[...panelBefore,circuitId]))
    fail('Panel circuit membership changed outside the reviewed new circuit.',{circuitId});
  for(const id of loads){const before=evidence.before.get(id),after=evidence.after.get(id);if(!Array.isArray(before.electrical?.systemIds)||before.electrical.systemIds.length!==0||!exactIds(after.electrical?.systemIds,[circuitId]))fail('A circuit load does not show the exact reviewed membership transition.',{elementId:id});}
  for(const id of switches){const before=evidence.before.get(id),after=evidence.after.get(id);if(!Array.isArray(before.electrical?.systemIds)||before.electrical.systemIds.length!==0||!exactIds(after.electrical?.systemIds,[circuitId]))fail('A circuit switch does not show the exact reviewed membership transition.',{elementId:id});}
  if(!beforeCounts||!afterCounts||!Number.isSafeInteger(beforeCounts.OST_ElectricalCircuit)||!Number.isSafeInteger(afterCounts.OST_ElectricalCircuit))fail('Native category counts are missing or unknown.');
  const expected={...beforeCounts,OST_ElectricalCircuit:beforeCounts.OST_ElectricalCircuit+1};
  if(Object.keys(expected).length!==Object.keys(afterCounts).length||Object.entries(expected).some(([key,value])=>afterCounts[key]!==value))fail('Native category counts do not match one existing-member circuit creation.',{beforeCounts,afterCounts,expected});
  return {status:'EXISTING_ELECTRICAL_CIRCUIT_CREATION_VERIFIED',circuitId,panelId:operation.panelId,loadName:circuit.electrical.loadName??null,memberIds:[...circuit.electrical.memberIds],createdElementIds:[circuitId],automaticSave:false};
}

export function verifySavedExistingElectricalCircuit({beforeContext,afterContext,savedVerification,expectedDocumentIdentity,expectedRevision}){
  if(typeof expectedDocumentIdentity!=='string'||!expectedDocumentIdentity.trim()||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('Saved verification requires an explicit valid document identity/revision.');
  const before=beforeContext?.document,after=afterContext?.document;
  if(beforeContext?.active!==true||afterContext?.active!==true||!before||!after)fail('Saved verification is missing active before/after document context.');
  if(before.identity!==expectedDocumentIdentity||after.identity!==expectedDocumentIdentity||before.revision!==expectedRevision||after.revision!==expectedRevision)fail('Saved verification belongs to a different document.',{expectedDocumentIdentity,expectedRevision});
  if(typeof before.path!=='string'||!before.path.trim()||before.path!==after.path)fail('Document path is missing or changed during saved verification.');
  if(before.isModified!==false||after.isModified!==false||savedVerification?.saved!==true||savedVerification?.isModified!==false)fail('Manual-save current-session verification did not prove a stable clean saved state.',{savedVerification});
  if(savedVerification.documentIdentity!==expectedDocumentIdentity||savedVerification.revision!==expectedRevision||savedVerification.automaticSave!==false||savedVerification.persistenceVerified!==false)fail('Saved verification does not preserve the reviewed identity or persistence boundary.',{savedVerification});
  return {status:'EXISTING_ELECTRICAL_CIRCUIT_POSTSAVE_VERIFIED',documentIdentity:expectedDocumentIdentity,revision:expectedRevision,saved:true,isModified:false,closeReopenPersistenceVerified:false,automaticSave:false};
}

/**
 * Verify the narrow lighting.full creation scenario used by the Revit 2027
 * acceptance fixture. This is readback-only: it never submits a plan or saves.
 */
export function verifyLightingCircuitCreation({plan,receipt,items,beforePanel,afterPanel,beforeCounts,afterCounts}){
  if(receipt?.status!=='committed'||receipt.completedOperationCount!==2||receipt.saved!==false)fail('Receipt does not prove the two-operation unsaved commit.',{receipt});
  if(!Array.isArray(plan?.operations)||plan.operations.length!==2||plan.operations[0]?.operationType!=='create_family_instance'||plan.operations[1]?.operationType!=='create_circuit')fail('Plan is not the reviewed one-light, one-circuit scenario.');
  const circuitOperation=plan.operations[1];
  const lightReference=circuitOperation?.elementIds?.length===1?circuitOperation.elementIds[0]:undefined;
  const lightOperation=typeof lightReference==='string'&&lightReference.startsWith('@')?(plan.operations??[]).find(op=>op.operationType==='create_family_instance'&&op.id===lightReference.slice(1)):undefined;
  if(!lightOperation||!circuitOperation||!Array.isArray(circuitOperation.elementIds)||circuitOperation.elementIds.length!==1)fail('Plan is not the reviewed one-light, one-circuit scenario.');
  const lightId=requiredReference(receipt,lightOperation.id),circuitId=requiredReference(receipt,circuitOperation.id);
  if(lightId===circuitId||!exactIds(receipt.createdElementIds,[lightId,circuitId]))fail('Receipt does not include exactly both reviewed created elements.',{lightId,circuitId});
  if((circuitOperation.switchIds??[]).length)fail('Plan is not the reviewed one-light, one-circuit scenario.');
  const map=itemMap(items),light=map.get(lightId),circuit=map.get(circuitId),panel=afterPanel;
  if(!light||!circuit||!panel)fail('Created light, circuit or panel readback is missing.',{lightId,circuitId});
  if(light.summary.className!=='FamilyInstance'||light.summary.categoryId!==-2001120||light.summary.typeId!==lightOperation.symbolId)fail('Created light native type/category does not match the reviewed operation.',{lightId,summary:light.summary});
  const distances=pointDistance(light.summary.location,lightOperation.point);if(distances.some(value=>!Number.isFinite(value)||value>1))fail('Created light location differs from the reviewed point by more than 1 mm.',{lightId,distances});
  const mark=assertParameter(light,-1001203,p=>p.storageType==='String'&&p.valueSupported===true&&p.value===lightOperation.mark,'light mark');
  if(circuit.summary.className!=='ElectricalSystem'||circuit.summary.categoryId!==-2008037)fail('Created element is not a native ElectricalSystem.',{circuitId,summary:circuit.summary});
  if(circuit.electrical?.panelId!==circuitOperation.panelId||circuit.electrical?.loadName!==circuitOperation.name)fail('Created circuit panel or load name does not match the reviewed operation.',{circuitId,electrical:circuit.electrical});
  if(!exactIds(circuit.electrical?.memberIds,[lightId]))fail('Created circuit does not report exactly the created light as its member.',{circuitId,memberIds:circuit.electrical?.memberIds});
  if(!exactIds(light.electrical?.systemIds,[circuitId]))fail('Created light does not report exactly the created circuit membership.',{lightId,systemIds:light.electrical?.systemIds});
  if(beforePanel?.summary?.id!==circuitOperation.panelId||panel.summary?.id!==circuitOperation.panelId)fail('Panel readback does not match the reviewed panel ID.');
  const panelSystemsBefore=beforePanel?.electrical?.systemIds,panelSystemsAfter=panel.electrical?.systemIds;
  if(!validIds(panelSystemsBefore)||panelSystemsBefore.includes(circuitId)||!exactIds(panelSystemsAfter,[...panelSystemsBefore,circuitId]))fail('Panel circuit membership changed outside the reviewed new circuit.',{panelSystemsBefore,panelSystemsAfter,circuitId});
  const requiredCounts=['OST_LightingFixtures','OST_ElectricalCircuit','OST_Wire'];
  if(!beforeCounts||!afterCounts||requiredCounts.some(key=>!Number.isSafeInteger(beforeCounts[key])||beforeCounts[key]<0||!Number.isSafeInteger(afterCounts[key])||afterCounts[key]<0))fail('Native category counts are missing or unknown.');
  const expectedCounts={...beforeCounts,OST_LightingFixtures:beforeCounts.OST_LightingFixtures+1,OST_ElectricalCircuit:beforeCounts.OST_ElectricalCircuit+1};
  if(Object.keys(expectedCounts).length!==Object.keys(afterCounts).length||Object.entries(expectedCounts).some(([key,value])=>!Number.isSafeInteger(value)||value<0||afterCounts[key]!==value))fail('Native category counts do not match one light and one circuit creation.',{beforeCounts,afterCounts,expectedCounts});
  return {status:'LIGHTING_CIRCUIT_CREATION_VERIFIED',lightId,circuitId,mark:mark.value,panelId:circuit.electrical.panelId,loadName:circuit.electrical.loadName,memberIds:[...circuit.electrical.memberIds],createdElementIds:[lightId,circuitId],wiresCreated:false,automaticSave:false};
}

/**
 * Verify the post-save portion of the same acceptance scope. This remains
 * current-session evidence: it does not claim close/reopen persistence.
 */
export function verifySavedLightingCircuitCreation({beforeContext,afterContext,savedVerification,expectedDocumentIdentity,expectedRevision}){
  if(typeof expectedDocumentIdentity!=='string'||!expectedDocumentIdentity.trim()||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('Saved verification requires an explicit valid document identity/revision.');
  const before=beforeContext?.document;
  const after=afterContext?.document;
  if(beforeContext?.active!==true||afterContext?.active!==true||!before||!after)fail('Saved verification is missing active before/after document context.');
  if(before.identity!==expectedDocumentIdentity||after.identity!==expectedDocumentIdentity)fail('Saved verification belongs to a different document.',{expectedDocumentIdentity,before:before.identity,after:after.identity});
  if(before.revision!==expectedRevision||after.revision!==expectedRevision)fail('Saved verification belongs to a different document revision.',{expectedRevision,before:before.revision,after:after.revision});
  if(typeof before.path!=='string'||!before.path.trim()||before.path!==after.path)fail('Document path is missing or changed during saved verification.',{before:before.path,after:after.path});
  if(before.isModified!==false||after.isModified!==false||savedVerification?.saved!==true||savedVerification?.isModified!==false)fail('Manual-save current-session verification did not prove a stable clean saved state.',{savedVerification,after});
  if(savedVerification.documentIdentity!==expectedDocumentIdentity||savedVerification.revision!==expectedRevision)fail('Saved verification identity/revision does not match the reviewed document.',{savedVerification});
  if(savedVerification.automaticSave!==false||savedVerification.persistenceVerified!==false)fail('Saved verification must disclose no automatic save and no unverified close/reopen claim.',{savedVerification});
  return {status:'LIGHTING_CIRCUIT_POSTSAVE_VERIFIED',documentIdentity:expectedDocumentIdentity,revision:expectedRevision,saved:true,isModified:false,closeReopenPersistenceVerified:false,automaticSave:false};
}
