import http from 'http';
import https from 'https';
import { URL } from 'url';

const PORT = process.env.PORT || 3000;
const GHL_CONTACT_UPSERT_URL = process.env.GHL_CONTACT_UPSERT_URL;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_ACCOUNT_TYPE_FIELD_ID = process.env.GHL_ACCOUNT_TYPE_FIELD_ID || 'account_type__customFieldId';

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function forwardToGhl(payload) {
  return new Promise((resolve, reject) => {
    if (!GHL_CONTACT_UPSERT_URL || !GHL_API_KEY) {
      return reject(new Error('Missing GHL env vars'));
    }
    const u = new URL(GHL_CONTACT_UPSERT_URL);
    const body = JSON.stringify(payload);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Version': '2021-07-28'
      }
    };

    const req = (u.protocol === 'https:' ? https : http).request(opts, (resp) => {
      let data = '';
      resp.on('data', (chunk) => (data += chunk));
      resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Webhook relay is running');
    return;
  }

  if (req.method === 'POST' && req.url === '/webhook/jadely') {
    try {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        const b = raw ? JSON.parse(raw) : {};
        const payload = {
          email: b.email,
          firstName: b.first_name || '',
          lastName: b.last_name || '',
          phone: b.phone || '',
          customFields: b.account_type ? [{ id: GHL_ACCOUNT_TYPE_FIELD_ID, value: b.account_type }] : [],
          tags: ['jadely']
        };
        try {
          const r = await forwardToGhl(payload);
          sendJson(res, 200, {
            ok: r.status >= 200 && r.status < 300,
            ghl_status: r.status,
            ghl_response_preview: (r.body || '').slice(0, 800)
          });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err) });
        }
      });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e) });
    }
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, () => console.log(`Relay running on ${PORT}`));
