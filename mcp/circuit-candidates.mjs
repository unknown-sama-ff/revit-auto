const CATEGORY_IDS = {
  OST_LightingFixtures: -2001120,
  OST_LightingDevices: -2008087,
  OST_ElectricalEquipment: -2001040
};

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

async function searchCategory(category, call, signal) {
  const rows = [];
  const ids = new Set();
  let offset = 0;
  while (true) {
    signal?.throwIfAborted();
    const page = await call('revit_search', { category, limit: 500, offset }, signal);
    if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean' || page.offset !== offset || page.limit !== 500 || page.truncated === true || page.complete === false)
      fail('circuit_candidate_scope_unknown', `Native ${category} search returned malformed pagination evidence.`);
    if (page.items.length > 500 || (page.hasMore && page.items.length === 0))
      fail('circuit_candidate_scope_unknown', `Native ${category} search made no safe pagination progress.`);
    for (const item of page.items) {
      const id = item?.id;
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id) || item.categoryId !== CATEGORY_IDS[category] || typeof item.className !== 'string' || !item.className.trim())
        fail('circuit_candidate_scope_unknown', `Native ${category} search returned an invalid or duplicate element ID.`, { elementId: id });
      ids.add(id);
      rows.push(item);
    }
    if (rows.length > 10000) fail('circuit_candidate_scope_too_large', `Native ${category} candidate scope exceeds 10000 elements.`);
    offset += page.items.length;
    if (!page.hasMore) return rows;
  }
}

function inspectMap(report, requestedIds) {
  if (!Array.isArray(report?.items) || report.items.length !== requestedIds.length)
    fail('circuit_candidate_scope_unknown', 'Native inspection omitted or added circuit candidate elements.');
  const requested = new Set(requestedIds);
  const map = new Map();
  for (const item of report.items) {
    const id = item?.summary?.id ?? item?.id;
    if (!Number.isSafeInteger(id) || id <= 0 || !requested.has(id) || map.has(id) || item.exists === false || !item.summary)
      fail('circuit_candidate_scope_unknown', 'Native inspection contains missing, duplicate or unexpected circuit candidate evidence.', { elementId: id });
    map.set(id, item);
  }
  return map;
}

function candidateRows(items, role) {
  return items.map(item => {
    const rawSystems = item.electrical?.systemIds;
    const membershipKnown = Array.isArray(rawSystems) && rawSystems.every(id => Number.isSafeInteger(id) && id > 0) && new Set(rawSystems).size === rawSystems.length;
    const membershipState = !membershipKnown ? 'unknown' : rawSystems.length ? 'assigned' : 'unassigned';
    const connectorIds = new Set();
    const electricalConnectors = [];
    const connectorDiagnostics = [];
    if (!Array.isArray(item.connectors)) connectorDiagnostics.push({ reason: 'connector-collection-unavailable' });
    else for (const connector of item.connectors) {
      const valid = connector && Number.isSafeInteger(connector.connectorId) && connector.connectorId >= 0 && connector.connectorId <= 2147483647 &&
        !connectorIds.has(connector.connectorId) && (connector.elementId === undefined || connector.elementId === item.summary.id) &&
        connector.domainSupported === true && typeof connector.domain === 'string' && connector.domain.trim() &&
        connector.connectorsSupported !== false && connector.connectorsError === undefined && connector.connectorReadStatus === undefined;
      if (!valid) {
        connectorDiagnostics.push({ reason: 'connector-evidence-unknown', evidence: connector ?? null });
        continue;
      }
      connectorIds.add(connector.connectorId);
      if (connector.domain === 'DomainElectrical') electricalConnectors.push(connector.connectorId);
    }
    const exclusionReasons = [];
    if (item.summary.className !== 'FamilyInstance') exclusionReasons.push('not-family-instance');
    if (!membershipKnown) exclusionReasons.push('electrical-membership-unknown');
    else if (role !== 'panel' && membershipState === 'assigned') exclusionReasons.push('already-assigned');
    if (connectorDiagnostics.length) exclusionReasons.push('electrical-connector-evidence-unknown');
    if (electricalConnectors.length === 0 && connectorDiagnostics.length === 0) exclusionReasons.push('electrical-connector-missing');
    return {
      role, id: item.summary.id, className: item.summary.className, categoryId: item.summary.categoryId,
      family: item.summary.family ?? null, type: item.summary.type ?? null, mark: item.summary.mark ?? null,
      systemIds: membershipKnown ? [...rawSystems] : null,
      membershipState,
      ...(!membershipKnown ? { electricalEvidence: item.electrical ?? null } : {}),
      electricalConnectors, connectorEvidenceComplete: connectorDiagnostics.length === 0, connectorDiagnostics, exclusionReasons
    };
  });
}

export async function discoverElectricalCircuitCandidates(call, signal, expectedCounts) {
  const searched = new Map();
  for (const category of Object.keys(CATEGORY_IDS)) searched.set(category, await searchCategory(category, call, signal));
  const ids = [...searched.values()].flat().map(item => item.id);
  if (new Set(ids).size !== ids.length) fail('circuit_candidate_scope_unknown', 'A candidate ID occurred in more than one native category.');
  if (expectedCounts !== undefined) for (const category of Object.keys(CATEGORY_IDS)) {
    if (!Number.isSafeInteger(expectedCounts?.[category]) || expectedCounts[category] < 0)
      fail('circuit_candidate_scope_unknown', 'Candidate discovery requires verified native category counts.', { category });
    if (searched.get(category).length !== expectedCounts[category])
      fail('circuit_candidate_scope_mismatch', 'Search membership does not match the reviewed native category count.', { category, expected: expectedCounts[category], actual: searched.get(category).length });
  }
  const inspected = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    signal?.throwIfAborted();
    const batch = ids.slice(offset, offset + 100);
    const rows = inspectMap(await call('revit_inspect', { elementIds: batch }, signal), batch);
    for (const [id, item] of rows) inspected.set(id, item);
  }

  const itemsFor = category => searched.get(category).map(row => {
    const id = row.id;
    const item = inspected.get(id);
    if (!item) fail('circuit_candidate_scope_unknown', 'A searched circuit candidate disappeared before inspection.', { elementId: id });
    if (item.summary.categoryId !== CATEGORY_IDS[category] || item.summary.className !== row.className)
      fail('circuit_candidate_scope_mismatch', 'An inspected circuit candidate changed category.', { elementId: id, categoryId: item.summary.categoryId });
    return item;
  });

  const fixtures = candidateRows(itemsFor('OST_LightingFixtures'), 'load');
  const switches = candidateRows(itemsFor('OST_LightingDevices'), 'switch');
  const panels = candidateRows(itemsFor('OST_ElectricalEquipment'), 'panel');
  const available = row => row.exclusionReasons.length === 0;
  return {
    status: 'READ_ONLY_CIRCUIT_CANDIDATES',
    scannedCounts: {
      lightingFixtures: fixtures.length,
      lightingDevices: switches.length,
      electricalEquipment: panels.length
    },
    availableCounts: {
      fixtures: fixtures.filter(available).length,
      switches: switches.filter(available).length,
      panels: panels.filter(available).length
    },
    fixtures: fixtures.filter(available),
    switches: switches.filter(available),
    panels: panels.filter(available),
    excludedPanels: panels.filter(row => !available(row)),
    excludedFixtures: fixtures.filter(row => !available(row)),
    excludedSwitches: switches.filter(row => !available(row)),
    modelWritesRequested: false,
    planCreationRequested: false,
    categoryCountsVerified: expectedCounts !== undefined,
    note: 'Candidates are read-only evidence. Select exact IDs and confirm engineering intent before prepare; no automatic grouping or panel selection was performed.'
  };
}
