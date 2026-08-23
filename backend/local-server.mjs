// Lightweight local dev server for the CloudMentor Lambda handler.
//
// Replaces `sam local start-api`, which relied on the CloudFormation/SAM
// template that this project no longer uses. It wraps the same `handler`
// export from src/app.mjs with a minimal HTTP server that fakes the
// API Gateway HTTP API (payload format 2.0) event shape.
//
// Usage:
//   cp env.local.example.json env.json   (values are read from process.env,
//                                          see "Environment variables" below)
//   node local-server.mjs
//
// Environment variables (export these, or use a tool like `dotenv-cli`):
//   AI_MODE, OPENAI_API_KEY, OPENAI_MODEL, TABLE_NAME, MATERIALS_BUCKET,
//   CORS_ORIGIN, STORAGE_MODE, LOCAL_DEV, PORT (default 3000)

import http from 'node:http';
import { handler } from './src/app.mjs';

const PORT = process.env.PORT || 3000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bodyBuffer = await readBody(req);
    const isBinary = !(req.headers['content-type'] || '').includes('json') &&
      !(req.headers['content-type'] || '').includes('text');

    const event = {
      version: '2.0',
      rawPath: url.pathname,
      rawQueryString: url.search.replace(/^\?/, ''),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])
      ),
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      requestContext: {
        http: {
          method: req.method,
          path: url.pathname,
        },
      },
      body: bodyBuffer.length
        ? (isBinary ? bodyBuffer.toString('base64') : bodyBuffer.toString('utf8'))
        : undefined,
      isBase64Encoded: bodyBuffer.length ? isBinary : false,
    };

    const result = await handler(event);

    res.writeHead(result.statusCode || 200, result.headers || {});
    if (result.body) {
      res.end(result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Local server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`CloudMentor local API listening on http://localhost:${PORT}`);
  console.log('Try: curl http://localhost:' + PORT + '/health');
});
