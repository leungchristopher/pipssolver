import { useEffect, useMemo, useRef, useState } from 'react';
import { buildModel } from './solver';
import { parsePuzzle, type Puzzle, type Snapshot } from './types';
import { BeliefView, Board, Domino, FactorGraph, ResidualChart } from './visuals';

const finished = (s?: Snapshot) => ['solved', 'unsatisfiable', 'limit'].includes(s?.phase ?? '');

export default function App() {
  const [puzzle, setPuzzle] = useState<Puzzle>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'board' | 'graph' | 'beliefs'>('board');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [region, setRegion] = useState<number | null>(null);
  const [domino, setDomino] = useState<number | null>(null);
  const [heat, setHeat] = useState(false);
  const worker = useRef<Worker | null>(null);
  const queue = useRef<Snapshot[]>([]);
  const stepPending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const model = useMemo(() => puzzle ? buildModel(puzzle) : undefined, [puzzle]);

  function reset() {
    worker.current?.terminate(); worker.current = null;
    queue.current = []; stepPending.current = false;
    setSnapshot(undefined); setPlaying(false); setStarted(false);
    setDomino(null); setRegion(null);
  }

  async function loadToday() {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    reset(); setPuzzle(undefined); setLoading(true); setError('');
    try {
      const response = await fetch('/api/puzzle', { signal: request.signal });
      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();
      let data: Record<string, unknown> = {};
      if (body && contentType.includes('application/json')) {
        try { data = JSON.parse(body) as Record<string, unknown>; } catch { /* handled below */ }
      }
      if (!contentType.includes('application/json')) {
        throw new Error(`Puzzle service returned an unexpected response (${response.status}).`);
      }
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Today’s puzzle is unavailable.');
      if (!request.signal.aborted) setPuzzle(parsePuzzle(data));
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load today’s puzzle.');
    } finally { if (!request.signal.aborted) setLoading(false); }
  }

  useEffect(() => {
    void loadToday();
    return () => { worker.current?.terminate(); controller.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const next = queue.current.shift();
      if (next) { setSnapshot(next); if (finished(next)) setPlaying(false); }
    }, 65);
    return () => clearInterval(timer);
  }, [playing]);

  function begin(autoplay: boolean) {
    if (!puzzle || loading) return;
    setPlaying(autoplay);
    if (started && !finished(snapshot)) return;
    reset(); setStarted(true); setPlaying(autoplay); setError('');
    stepPending.current = !autoplay;
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const fail = (message: string) => {
      w.terminate(); worker.current = null; queue.current = [];
      setError(message); setPlaying(false); setStarted(false);
    };
    w.onmessage = ({ data }) => {
      if (data.type === 'error') { fail(data.error); return; }
      const next = data.snapshot as Snapshot;
      if (stepPending.current) { setSnapshot(next); stepPending.current = false; }
      else queue.current.push(next);
      if (finished(next)) { w.terminate(); worker.current = null; }
    };
    w.onerror = () => fail('Solver unavailable. Reload and try again.');
    w.postMessage({ puzzle });
  }

  function step() {
    setPlaying(false);
    if (!started) { begin(false); return; }
    const next = queue.current.shift();
    if (next) setSnapshot(next); else if (worker.current) stepPending.current = true;
  }

  const solved = snapshot?.phase === 'solved';
  const status = solved ? 'Solved' : snapshot?.phase === 'limit' ? 'Search limit reached' : snapshot?.phase === 'unsatisfiable' ? 'No solution' : playing ? 'Solving' : started ? 'Paused' : 'Ready';

  return <main className="solver">
    <header>
      <h1>bayesian pips<span>.</span></h1>
      <span className="difficulty">Hard</span>
      {puzzle && <time dateTime={puzzle.date}>{new Date(`${puzzle.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</time>}
      <button className="import-button" onClick={() => void loadToday()} disabled={loading}>{loading ? 'Loading…' : 'Import today'}</button>
    </header>

    {error && <div className="error" role="alert">{error}</div>}

    {puzzle && model && <section className="workspace" aria-label="Bayesian Pips solver">
      <div className="view-bar">
        <div className="tabs" role="tablist" aria-label="Views">
          {([{ id: 'board', label: 'Board' }, { id: 'graph', label: 'Factor graph' }, { id: 'beliefs', label: 'Beliefs' }] as const).map(({ id, label }) =>
            <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <span className="status" role="status">{status}</span>
      </div>

      <div className={`visual-stage ${tab === 'beliefs' ? 'belief-stage' : ''}`} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'board' ? <Board puzzle={puzzle} model={model} snapshot={snapshot} heat={heat} selected={region} onSelect={setRegion}/>
          : tab === 'graph' ? <FactorGraph model={model} puzzle={puzzle} snapshot={snapshot} chosen={domino} onChoose={setDomino}/>
          : <BeliefView model={model} snapshot={snapshot}/>}
      </div>

      <div className="domino-tray">{puzzle.dominoes.map((values, i) => <Domino key={i} values={values}
        used={snapshot?.placements.some(p => p.domino === i)} selected={domino === i}
        onClick={() => { setDomino(domino === i ? null : i); setTab('graph'); }}
        label={`Domino ${i + 1}: ${values.join('–')}`}/>)}</div>

      <div className="controls">
        <button className="primary" disabled={solved} onClick={() => playing ? setPlaying(false) : begin(true)}>{solved ? 'Solved' : playing ? 'Pause' : started && !finished(snapshot) ? 'Resume' : 'Solve'}</button>
        <button onClick={step} disabled={playing || finished(snapshot)}>Step</button>
        <button onClick={reset} disabled={!started}>Reset</button>
        <button className="heat-toggle" aria-pressed={heat} onClick={() => { setHeat(!heat); setTab('board'); }}>Heatmap</button>
      </div>

      <div className="metrics">
        <span><b>{snapshot?.iteration ?? 0}</b> iterations</span>
        <span><b>{snapshot?.placements.length ?? 0}/{puzzle.dominoes.length}</b> placed</span>
        <span><b>{snapshot ? snapshot.residual.toFixed(3) : '—'}</b> residual</span>
        <ResidualChart history={snapshot?.history ?? []}/>
      </div>
    </section>}
    <footer>
      <span>Pips by <a href="https://www.nytimes.com/games/pips" target="_blank" rel="noreferrer">The New York Times</a></span>
      <span>by <a href="https://leungchristopher.com" target="_blank" rel="noreferrer">Chris Leung</a></span>
      <a href="https://leungchristopher.com/" target="_blank" rel="noreferrer">Writeup</a>
    </footer>
  </main>;
}
