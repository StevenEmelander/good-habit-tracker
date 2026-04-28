'use strict';
const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
} = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({});
const CYCLES_TABLE = process.env.CYCLES_TABLE_NAME;
const ENTRIES_TABLE = process.env.ENTRIES_TABLE_NAME;
const CF_SECRET = process.env.CF_SECRET;
const CYCLES_ROW_ID = 'main';
const ENTRY_PK = 'DAY';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: typeof obj === 'string' ? obj : JSON.stringify(obj),
  };
}
function plainResponse(statusCode, text) {
  return { statusCode, headers: { 'Content-Type': 'text/plain' }, body: text };
}

function getBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function safeJsonParseObject(s) {
  if (!s) return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

function isValidDateKey(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

// ── Cycles row (single DynamoDB item holding all cycle definitions) ─────

async function getCyclesRow() {
  const out = await client.send(new GetItemCommand({
    TableName: CYCLES_TABLE,
    Key: { id: { S: CYCLES_ROW_ID } },
  }));
  return out.Item || null;
}

function parseCycles(item) {
  if (!item || !item.cyclesJson) return [];
  try {
    const v = JSON.parse(item.cyclesJson.S);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function parseBounds(item) {
  return {
    min: item && item.entryDateMin ? item.entryDateMin.S : null,
    max: item && item.entryDateMax ? item.entryDateMax.S : null,
  };
}

async function writeCycles(cycles, bounds) {
  const item = {
    id: { S: CYCLES_ROW_ID },
    cyclesJson: { S: JSON.stringify(cycles) },
    updatedAt: { S: nowIso() },
  };
  if (bounds && bounds.min) item.entryDateMin = { S: bounds.min };
  if (bounds && bounds.max) item.entryDateMax = { S: bounds.max };
  await client.send(new PutItemCommand({ TableName: CYCLES_TABLE, Item: item }));
}

// ── Entries (one DynamoDB item per day) ─────────────────────────────────

async function getEntry(dateKey) {
  const out = await client.send(new GetItemCommand({
    TableName: ENTRIES_TABLE,
    Key: { pk: { S: ENTRY_PK }, dateKey: { S: dateKey } },
  }));
  if (!out.Item) return null;
  const raw = (out.Item.valuesJson && out.Item.valuesJson.S)
    || (out.Item.habitValuesJson && out.Item.habitValuesJson.S)
    || '';
  return { dateKey, habitValuesById: safeJsonParseObject(raw) };
}

async function putEntryRow(dateKey, habitValuesById) {
  await client.send(new PutItemCommand({
    TableName: ENTRIES_TABLE,
    Item: {
      pk: { S: ENTRY_PK },
      dateKey: { S: dateKey },
      valuesJson: { S: JSON.stringify(habitValuesById || {}) },
      updatedAt: { S: nowIso() },
    },
  }));
}

async function deleteEntryRow(dateKey) {
  await client.send(new DeleteItemCommand({
    TableName: ENTRIES_TABLE,
    Key: { pk: { S: ENTRY_PK }, dateKey: { S: dateKey } },
  }));
}

/** Query pk='DAY'. No SK condition → returns the entire entry set in one paginated call. */
async function queryAllEntries() {
  const out = {};
  let ExclusiveStartKey;
  do {
    const resp = await client.send(new QueryCommand({
      TableName: ENTRIES_TABLE,
      KeyConditionExpression: '#p = :p',
      ExpressionAttributeNames: { '#p': 'pk' },
      ExpressionAttributeValues: { ':p': { S: ENTRY_PK } },
      ProjectionExpression: 'dateKey, valuesJson, habitValuesJson',
      ExclusiveStartKey,
    }));
    for (const it of resp.Items || []) {
      const dk = it.dateKey && it.dateKey.S;
      if (!dk) continue;
      const raw = (it.valuesJson && it.valuesJson.S)
        || (it.habitValuesJson && it.habitValuesJson.S)
        || '';
      out[dk] = safeJsonParseObject(raw);
    }
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function findBoundEntry(direction) {
  const resp = await client.send(new QueryCommand({
    TableName: ENTRIES_TABLE,
    KeyConditionExpression: '#p = :p',
    ExpressionAttributeNames: { '#p': 'pk' },
    ExpressionAttributeValues: { ':p': { S: ENTRY_PK } },
    ProjectionExpression: 'dateKey',
    ScanIndexForward: direction === 'asc',
    Limit: 1,
  }));
  const it = (resp.Items || [])[0];
  return it && it.dateKey ? it.dateKey.S : null;
}

async function batchWriteEntries(requests) {
  for (let i = 0; i < requests.length; i += 25) {
    let batch = requests.slice(i, i + 25);
    for (let attempt = 0; attempt < 12; attempt++) {
      const res = await client.send(new BatchWriteItemCommand({
        RequestItems: { [ENTRIES_TABLE]: batch },
      }));
      const un = res.UnprocessedItems && res.UnprocessedItems[ENTRIES_TABLE];
      if (!un || un.length === 0) break;
      batch = un;
      await sleep(40 * (attempt + 1));
    }
  }
}

/** Update only entryDateMin/Max on the cycles row, leaving cyclesJson untouched. */
async function bumpBoundsOnPut(dateKey) {
  await client.send(new UpdateItemCommand({
    TableName: CYCLES_TABLE,
    Key: { id: { S: CYCLES_ROW_ID } },
    UpdateExpression:
      'SET entryDateMin = if_not_exists(entryDateMin, :d), entryDateMax = if_not_exists(entryDateMax, :d), updatedAt = :u',
    ExpressionAttributeValues: { ':d': { S: dateKey }, ':u': { S: nowIso() } },
  }));
  // Two follow-up updates extend the bounds outward only when needed.
  await client.send(new UpdateItemCommand({
    TableName: CYCLES_TABLE,
    Key: { id: { S: CYCLES_ROW_ID } },
    UpdateExpression: 'SET entryDateMin = :d',
    ConditionExpression: 'attribute_not_exists(entryDateMin) OR :d < entryDateMin',
    ExpressionAttributeValues: { ':d': { S: dateKey } },
  })).catch(() => {});
  await client.send(new UpdateItemCommand({
    TableName: CYCLES_TABLE,
    Key: { id: { S: CYCLES_ROW_ID } },
    UpdateExpression: 'SET entryDateMax = :d',
    ConditionExpression: 'attribute_not_exists(entryDateMax) OR :d > entryDateMax',
    ExpressionAttributeValues: { ':d': { S: dateKey } },
  })).catch(() => {});
}

async function recomputeBoundsAfterDelete(deletedDateKey) {
  const row = await getCyclesRow();
  const bounds = parseBounds(row);
  let { min, max } = bounds;
  let changed = false;
  if (deletedDateKey === min) { min = await findBoundEntry('asc'); changed = true; }
  if (deletedDateKey === max) { max = await findBoundEntry('desc'); changed = true; }
  if (!changed) return;
  const expr = [];
  const removeExpr = [];
  const vals = { ':u': { S: nowIso() } };
  if (min) { expr.push('entryDateMin = :mn'); vals[':mn'] = { S: min }; }
  else removeExpr.push('entryDateMin');
  if (max) { expr.push('entryDateMax = :mx'); vals[':mx'] = { S: max }; }
  else removeExpr.push('entryDateMax');
  expr.push('updatedAt = :u');
  let UpdateExpression = 'SET ' + expr.join(', ');
  if (removeExpr.length) UpdateExpression += ' REMOVE ' + removeExpr.join(', ');
  await client.send(new UpdateItemCommand({
    TableName: CYCLES_TABLE,
    Key: { id: { S: CYCLES_ROW_ID } },
    UpdateExpression,
    ExpressionAttributeValues: vals,
  }));
}

// ── Orphan-habit sweep ──────────────────────────────────────────────────

async function sweepOrphanHabits(cycles) {
  const liveIds = new Set();
  for (const c of cycles) {
    for (const h of (c.habitDefinitions || [])) if (h && h.id) liveIds.add(h.id);
  }
  const allEntries = await queryAllEntries();
  const requests = [];
  const removedIds = new Set();
  let boundsDirty = false;
  for (const dk of Object.keys(allEntries)) {
    const values = allEntries[dk];
    let changed = false;
    for (const k of Object.keys(values)) {
      if (!liveIds.has(k)) { delete values[k]; changed = true; removedIds.add(k); }
    }
    if (!changed) continue;
    if (Object.keys(values).length === 0) {
      requests.push({ DeleteRequest: { Key: { pk: { S: ENTRY_PK }, dateKey: { S: dk } } } });
      boundsDirty = true;
    } else {
      requests.push({ PutRequest: { Item: {
        pk: { S: ENTRY_PK },
        dateKey: { S: dk },
        valuesJson: { S: JSON.stringify(values) },
        updatedAt: { S: nowIso() },
      } } });
    }
  }
  if (requests.length) await batchWriteEntries(requests);
  if (boundsDirty) {
    const min = await findBoundEntry('asc');
    const max = await findBoundEntry('desc');
    const expr = [];
    const removeExpr = [];
    const vals = { ':u': { S: nowIso() } };
    if (min) { expr.push('entryDateMin = :mn'); vals[':mn'] = { S: min }; }
    else removeExpr.push('entryDateMin');
    if (max) { expr.push('entryDateMax = :mx'); vals[':mx'] = { S: max }; }
    else removeExpr.push('entryDateMax');
    expr.push('updatedAt = :u');
    let UpdateExpression = 'SET ' + expr.join(', ');
    if (removeExpr.length) UpdateExpression += ' REMOVE ' + removeExpr.join(', ');
    await client.send(new UpdateItemCommand({
      TableName: CYCLES_TABLE,
      Key: { id: { S: CYCLES_ROW_ID } },
      UpdateExpression,
      ExpressionAttributeValues: vals,
    }));
  }
  return [...removedIds];
}

// ── Route handlers ──────────────────────────────────────────────────────

async function handleListCycles() {
  const row = await getCyclesRow();
  const cycles = parseCycles(row);
  const entryBounds = parseBounds(row);
  return jsonResponse(200, { cycles, entryBounds });
}

async function handleGetCycle(cycleId) {
  if (!cycleId) return plainResponse(400, 'Invalid cycleId');
  const row = await getCyclesRow();
  const cycles = parseCycles(row);
  const found = cycles.find((c) => c && c.id === cycleId);
  if (!found) return plainResponse(404, 'Not Found');
  return jsonResponse(200, found);
}

async function handlePutCycle(cycleId, body) {
  if (!cycleId) return plainResponse(400, 'Invalid cycleId');
  if (!body || typeof body !== 'object') return plainResponse(400, 'Invalid body');
  const next = { ...body, id: cycleId };
  if (!isValidDateKey(next.startDate) || !isValidDateKey(next.endDate)) {
    return plainResponse(400, 'Invalid dates');
  }
  const row = await getCyclesRow();
  const cycles = parseCycles(row);
  const idx = cycles.findIndex((c) => c && c.id === cycleId);
  if (idx >= 0) cycles[idx] = next;
  else cycles.push(next);
  cycles.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  await writeCycles(cycles, parseBounds(row));
  const removedHabitIds = await sweepOrphanHabits(cycles);
  return jsonResponse(200, { ok: true, removedHabitIds });
}

async function handleDeleteCycle(cycleId) {
  if (!cycleId) return plainResponse(400, 'Invalid cycleId');
  const row = await getCyclesRow();
  const cycles = parseCycles(row).filter((c) => c && c.id !== cycleId);
  await writeCycles(cycles, parseBounds(row));
  const removedHabitIds = await sweepOrphanHabits(cycles);
  return jsonResponse(200, { ok: true, removedHabitIds });
}

async function handleListEntries() {
  const entries = await queryAllEntries();
  return jsonResponse(200, { entries });
}

async function handleGetEntry(dateKey) {
  if (!isValidDateKey(dateKey)) return plainResponse(400, 'Invalid dateKey');
  const e = await getEntry(dateKey);
  if (!e) return plainResponse(404, 'Not Found');
  return jsonResponse(200, e);
}

async function handlePutEntry(dateKey, body) {
  if (!isValidDateKey(dateKey)) return plainResponse(400, 'Invalid dateKey');
  if (!body || typeof body !== 'object') return plainResponse(400, 'Invalid body');
  const values = body.habitValuesById && typeof body.habitValuesById === 'object'
    ? body.habitValuesById
    : {};
  if (Object.keys(values).length === 0) {
    await deleteEntryRow(dateKey);
    await recomputeBoundsAfterDelete(dateKey);
    return jsonResponse(200, { ok: true, deleted: true });
  }
  await putEntryRow(dateKey, values);
  await bumpBoundsOnPut(dateKey);
  return jsonResponse(200, { ok: true });
}

async function handleDeleteEntry(dateKey) {
  if (!isValidDateKey(dateKey)) return plainResponse(400, 'Invalid dateKey');
  await deleteEntryRow(dateKey);
  await recomputeBoundsAfterDelete(dateKey);
  return jsonResponse(200, { ok: true });
}

// ── Router ──────────────────────────────────────────────────────────────

function matchPath(path) {
  if (!path) return null;
  if (path === '/api/cycles') return { kind: 'cycles-list' };
  if (path === '/api/entries') return { kind: 'entries-list' };
  let m = path.match(/^\/api\/cycles\/([^/]+)$/);
  if (m) return { kind: 'cycle-item', cycleId: decodeURIComponent(m[1]) };
  m = path.match(/^\/api\/entries\/([^/]+)$/);
  if (m) return { kind: 'entry-item', dateKey: decodeURIComponent(m[1]) };
  return null;
}

exports.handler = async (event) => {
  const headers = event.headers || {};
  if (!CF_SECRET || headers['x-cf-secret'] !== CF_SECRET) {
    return plainResponse(403, 'Forbidden');
  }
  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';
  const path = (event.requestContext && event.requestContext.http && event.requestContext.http.path) || event.rawPath || '';
  const route = matchPath(path);
  if (!route) return plainResponse(404, 'Not Found');

  try {
    if (route.kind === 'cycles-list' && method === 'GET') return await handleListCycles();
    if (route.kind === 'cycle-item') {
      if (method === 'GET') return await handleGetCycle(route.cycleId);
      if (method === 'PUT') return await handlePutCycle(route.cycleId, getBody(event));
      if (method === 'DELETE') return await handleDeleteCycle(route.cycleId);
    }
    if (route.kind === 'entries-list' && method === 'GET') return await handleListEntries();
    if (route.kind === 'entry-item') {
      if (method === 'GET') return await handleGetEntry(route.dateKey);
      if (method === 'PUT') return await handlePutEntry(route.dateKey, getBody(event));
      if (method === 'DELETE') return await handleDeleteEntry(route.dateKey);
    }
    return plainResponse(405, 'Method Not Allowed');
  } catch (err) {
    return jsonResponse(500, { error: 'internal', message: String(err && err.message || err) });
  }
};
