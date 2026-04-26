'use strict';
const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;
const CF_SECRET = process.env.CF_SECRET;
const PK = 'state';

exports.handler = async (event) => {
  // Verify the CloudFront shared secret — blocks direct Lambda URL access
  const headers = event.headers || {};
  if (!CF_SECRET || headers['x-cf-secret'] !== CF_SECRET) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';

  if (method === 'GET') {
    const result = await client.send(new GetItemCommand({
      TableName: TABLE,
      Key: { pk: { S: PK } },
    }));
    const data = (result.Item && result.Item.data && result.Item.data.S) || null;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: data || 'null',
    };
  }

  if (method === 'POST') {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : (event.body || '{}');

    // Validate it's parseable JSON before storing
    try { JSON.parse(body); } catch {
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    await client.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: PK },
        data: { S: body },
        updatedAt: { S: new Date().toISOString() },
      },
    }));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}',
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
