import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const today = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export async function puzzleApi(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/puzzle') return next?.();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (url.search) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Only today’s puzzle is available.' }));
  }
  const date = today();
  try {
    const upstream = await fetch(`https://www.nytimes.com/svc/pips/v1/${date}.json`, {
      signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' },
    });
    if (!upstream.ok) throw new Error(`NYT returned ${upstream.status}`);
    const daily = await upstream.json();
    if (!daily.hard || daily.printDate !== date) throw new Error('The daily puzzle is not available yet');
    const { dominoes, regions } = daily.hard;
    res.end(JSON.stringify({ date, dominoes, regions }));
  } catch {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Today’s puzzle is unavailable. Try again.' }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve('dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
  createServer((req, res) => puzzleApi(req, res, async () => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + '/')) { res.writeHead(403); return res.end(); }
      const data = await readFile(file);
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  })).listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('Pips is ready on http://localhost:3000'));
}
