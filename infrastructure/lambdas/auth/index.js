'use strict';
const crypto = require('crypto');

// Unlock hash is injected by CDK at deploy time (see infrastructure/lib/cert-stack.ts).
const UNLOCK_HASH = '__UNLOCK_HASH__';

function getCookies(request) {
  const raw = (request.headers['cookie'] || []).map(h => h.value).join('; ');
  const result = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) result[k] = v;
  }
  return result;
}

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const cookies = getCookies(request);

  // Valid auth cookie — pass through
  if (cookies['htok'] === UNLOCK_HASH) {
    if (request.querystring && request.querystring.includes('unlock=')) {
      const params = new URLSearchParams(request.querystring);
      params.delete('unlock');
      request.querystring = params.toString();
    }
    return request;
  }

  // Unlock via querystring: ?unlock=<token>
  if (request.querystring) {
    const params = new URLSearchParams(request.querystring);
    const tok = params.get('unlock');
    if (tok) {
      const tokHash = crypto.createHash('sha256').update(tok).digest('hex');
      if (tokHash === UNLOCK_HASH) {
        params.delete('unlock');
        const qs = params.toString();
        const dest = request.uri + (qs ? '?' + qs : '');
        return {
          status: '302',
          statusDescription: 'Found',
          headers: {
            location: [{ key: 'Location', value: dest }],
            'set-cookie': [{
              key: 'Set-Cookie',
              value: 'htok=' + UNLOCK_HASH + '; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict',
            }],
            'cache-control': [{ key: 'Cache-Control', value: 'no-store, no-cache' }],
          },
        };
      }
    }
  }

  return {
    status: '403',
    statusDescription: 'Forbidden',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
    body: '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>private</title><style>body{background:#0a0a0b;color:#4a4a55;font-family:ui-monospace,monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:13px;letter-spacing:0.1em}</style></head><body>private</body></html>',
  };
};

