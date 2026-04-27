'use strict';
const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
} = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({});
const CYCLES_TABLE = process.env.CYCLES_TABLE_NAME;
const CHECKINS_TABLE = process.env.CHECKINS_TABLE_NAME;
const CF_SECRET = process.env.CF_SECRET;
const CYCLES_ROW_ID = 'main';
const CHECKIN_PK = 'DAY';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseQuery(qs) {
  const o = {};
  if (!qs) return o;
  for (const part of String(qs).split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = decodeURIComponent(part.slice(0, i));
    const v = decodeURIComponent(part.slice(i + 1));
    o[k] = v;
  }
  return o;
}

function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000);
  return t.toISOString().slice(0, 10);
}

async function queryCheckinsBetween(from, to) {
  const checkinsByDate = {};
  let ExclusiveStartKey;
  do {
    const out = await client.send(
      new QueryCommand({
        TableName: CHECKINS_TABLE,
        KeyConditionExpression: '#p = :p AND #d BETWEEN :f AND :t',
        ExpressionAttributeNames: { '#p': 'pk', '#d': 'dateKey' },
        ExpressionAttributeValues: {
          ':p': { S: CHECKIN_PK },
          ':f': { S: from },
          ':t': { S: to },
        },
        ProjectionExpression: 'dateKey, habitValuesJson',
        ExclusiveStartKey,
      }),
    );
    for (const it of out.Items || []) {
      const dk = it.dateKey && it.dateKey.S;
      if (!dk) continue;
      let habitValuesById = {};
      if (it.habitValuesJson && it.habitValuesJson.S) {
        try {
          habitValuesById = JSON.parse(it.habitValuesJson.S);
          if (!habitValuesById || typeof habitValuesById !== 'object') habitValuesById = {};
        } catch {
          habitValuesById = {};
        }
      }
      checkinsByDate[dk] = { habitValuesById };
    }
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return checkinsByDate;
}

/** All date keys under CHECKIN_PK (for bounds + full replace cleanup). */
async function queryAllCheckinDateKeys() {
  const keys = [];
  let ExclusiveStartKey;
  do {
    const out = await client.send(
      new QueryCommand({
        TableName: CHECKINS_TABLE,
        KeyConditionExpression: '#p = :p AND #d BETWEEN :lo AND :hi',
        ExpressionAttributeNames: { '#p': 'pk', '#d': 'dateKey' },
        ExpressionAttributeValues: {
          ':p': { S: CHECKIN_PK },
          ':lo': { S: '1970-01-01' },
          ':hi': { S: '2099-12-31' },
        },
        ProjectionExpression: 'dateKey',
        ExclusiveStartKey,
      }),
    );
    for (const it of out.Items || []) {
      if (it.dateKey && it.dateKey.S) keys.push(it.dateKey.S);
    }
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return keys;
}

/** Returns { min, max } ISO date strings or nulls. */
async function computeCheckinBounds() {
  const keys = await queryAllCheckinDateKeys();
  keys.sort();
  return {
    min: keys.length ? keys[0] : null,
    max: keys.length ? keys[keys.length - 1] : null,
  };
}

async function batchWriteCheckins(puts) {
  for (let i = 0; i < puts.length; i += 25) {
    let batch = puts.slice(i, i + 25);
    for (let attempt = 0; attempt < 12; attempt++) {
      const res = await client.send(
        new BatchWriteItemCommand({
          RequestItems: { [CHECKINS_TABLE]: batch },
        }),
      );
      const un = res.UnprocessedItems && res.UnprocessedItems[CHECKINS_TABLE];
      if (!un || un.length === 0) break;
      batch = un;
      await sleep(40 * (attempt + 1));
    }
  }
}

exports.handler = async (event) => {
  const headers = event.headers || {};
  if (!CF_SECRET || headers['x-cf-secret'] !== CF_SECRET) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  const method =
    (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';
  const rawQuery = event.rawQueryString || '';

  if (method === 'GET') {
    const progRes = await client.send(
      new GetItemCommand({
        TableName: CYCLES_TABLE,
        Key: { id: { S: CYCLES_ROW_ID } },
      }),
    );
    if (!progRes.Item || !progRes.Item.cyclesJson) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      };
    }
    let cycles;
    try {
      cycles = JSON.parse(progRes.Item.cyclesJson.S);
      if (!Array.isArray(cycles)) throw new Error('bad cycles');
    } catch {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      };
    }
    const _lastModified = progRes.Item._lastModified ? Number(progRes.Item._lastModified.N) : 0;
    const q = parseQuery(rawQuery);
    let from = q.from;
    let to = q.to;
    if (!from || !to) {
      to = todayIsoUtc();
      from = addDaysIso(to, -730);
    }
    if (from > to) {
      const x = from;
      from = to;
      to = x;
    }
    const checkinsByDate = await queryCheckinsBetween(from, to);
    const checkinBounds = {
      min: progRes.Item.checkinDateMin ? progRes.Item.checkinDateMin.S : null,
      max: progRes.Item.checkinDateMax ? progRes.Item.checkinDateMax.S : null,
    };
    const body = JSON.stringify({
      checkinsByDate,
      cycles,
      _lastModified,
      checkinBounds,
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body,
    };
  }

  if (method === 'POST') {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body || '{}';
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      return { statusCode: 400, body: 'Invalid JSON' };
    }
    if (!Array.isArray(doc.cycles)) {
      return { statusCode: 400, body: 'Invalid payload' };
    }
    const _lastModified = Number(doc._lastModified) || Date.now();
    const updatedAt = new Date().toISOString();
    const partial = !!doc.partial;
    const checkinsByDate =
      doc.checkinsByDate && typeof doc.checkinsByDate === 'object' ? doc.checkinsByDate : {};
    const deletedCheckinDates = Array.isArray(doc.deletedCheckinDates)
      ? doc.deletedCheckinDates.filter((x) => typeof x === 'string')
      : [];

    for (const dk of deletedCheckinDates) {
      await client.send(
        new DeleteItemCommand({
          TableName: CHECKINS_TABLE,
          Key: { pk: { S: CHECKIN_PK }, dateKey: { S: dk } },
        }),
      );
    }

    const puts = [];
    for (const dateKey of Object.keys(checkinsByDate)) {
      const entry = checkinsByDate[dateKey];
      const hv =
        entry && entry.habitValuesById && typeof entry.habitValuesById === 'object'
          ? entry.habitValuesById
          : {};
      puts.push({
        PutRequest: {
          Item: {
            pk: { S: CHECKIN_PK },
            dateKey: { S: dateKey },
            habitValuesJson: { S: JSON.stringify(hv) },
            updatedAt: { S: updatedAt },
          },
        },
      });
    }
    if (puts.length) await batchWriteCheckins(puts);

    if (!partial) {
      const keysInPayload = new Set(Object.keys(checkinsByDate));
      const allKeys = await queryAllCheckinDateKeys();
      for (const dk of allKeys) {
        if (!keysInPayload.has(dk)) {
          await client.send(
            new DeleteItemCommand({
              TableName: CHECKINS_TABLE,
              Key: { pk: { S: CHECKIN_PK }, dateKey: { S: dk } },
            }),
          );
        }
      }
    }

    const { min, max } = await computeCheckinBounds();
    const cyclesItem = {
      id: { S: CYCLES_ROW_ID },
      cyclesJson: { S: JSON.stringify(doc.cycles) },
      _lastModified: { N: String(_lastModified) },
      updatedAt: { S: updatedAt },
    };
    if (min) cyclesItem.checkinDateMin = { S: min };
    if (max) cyclesItem.checkinDateMax = { S: max };
    await client.send(new PutItemCommand({ TableName: CYCLES_TABLE, Item: cyclesItem }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}',
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
