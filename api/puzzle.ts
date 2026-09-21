const today = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(now);

export default async function puzzle(request: { method?: string; url?: string }, response: {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}) {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');

  const url = new URL(request.url ?? '/api/puzzle', 'http://localhost');
  if (request.method && request.method !== 'GET') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET');
    response.end(JSON.stringify({ error: 'Only GET is supported.' }));
    return;
  }
  if (url.search) {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: 'Only today’s puzzle is available.' }));
    return;
  }

  const date = today();
  try {
    const upstream = await fetch(`https://www.nytimes.com/svc/pips/v1/${date}.json`, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });
    if (!upstream.ok) throw new Error(`NYT returned ${upstream.status}`);
    const daily = await upstream.json() as { printDate?: string; hard?: { dominoes?: unknown; regions?: unknown } };
    if (!daily.hard || daily.printDate !== date) throw new Error('The daily puzzle is not available yet');
    response.end(JSON.stringify({ date, dominoes: daily.hard.dominoes, regions: daily.hard.regions }));
  } catch {
    response.statusCode = 502;
    response.end(JSON.stringify({ error: 'Today’s puzzle is unavailable. Try again.' }));
  }
}
