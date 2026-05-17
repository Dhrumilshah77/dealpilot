import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.WEB_PORT ?? 3001);
const html = readFileSync(join(__dirname, 'public/dealpilot.html'), 'utf8');

createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

  if (pathname !== '/' && pathname !== '/dealpilot') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}).listen(port, '127.0.0.1', () => {
  console.log(`DealPilot web listening on http://127.0.0.1:${port}/dealpilot`);
});
