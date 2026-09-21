import { useState } from 'react';
import { key, ruleLabel, type Puzzle, type Model, type Snapshot } from './types';

export const palette = ['#e1dfcb', '#e5d8cc', '#d9dfd0', '#dfd4c8', '#dedbcf', '#d5dcd8', '#e4d9c6', '#d6ddcc', '#ded4c9', '#dcdcc9', '#ddd3c7', '#d2dad0', '#e3d8c5', '#dcd3c9', '#d6ddce', '#e0d7cf'];
const dots: Record<number, [number, number][]> = {
  0: [], 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

export function Pip({ value, x = 0, y = 0, size = 8 }: { value: number; x?: number; y?: number; size?: number }) {
  return <g>{(dots[value] ?? []).map(([dx, dy], i) => <circle key={i} cx={x + dx * size} cy={y + dy * size} r={size * 0.29} fill="currentColor" />)}</g>;
}

export function Domino({ values, used, selected, onClick, label }: { values: [number, number]; used?: boolean; selected?: boolean; onClick: () => void; label: string }) {
  return <button className={`domino ${used ? 'is-used' : ''} ${selected ? 'is-selected' : ''}`} onClick={onClick} aria-label={label} aria-pressed={selected}>
    <svg viewBox="0 0 70 35" aria-hidden="true"><Pip value={values[0]} x={17.5} y={17.5} size={7.5}/><path d="M35 8V27" stroke="currentColor" strokeOpacity=".22"/><Pip value={values[1]} x={52.5} y={17.5} size={7.5}/></svg>
    {used && <span className="domino-check">✓</span>}
  </button>;
}

export function Board({ puzzle, model, snapshot, heat, selected, onSelect }: { puzzle: Puzzle; model: Model; snapshot?: Snapshot; heat: boolean; selected: number | null; onSelect: (r: number | null) => void }) {
  const unit = 60, pad = 17;
  const rows = Math.max(...model.cells.map(c => c[0])) + 1, cols = Math.max(...model.cells.map(c => c[1])) + 1;
  const regions = new Map(puzzle.regions.flatMap((r, i) => r.indices.map(c => [key(c), i] as const)));
  const cellIds = new Map(model.cells.map((c, i) => [key(c), i]));
  const vals = new Map(snapshot?.placements.flatMap(p => p.cells.map((c, i) => [c, p.values[i]] as const)) ?? []);
  const active = new Set(snapshot?.placements.flatMap(p => p.cells) ?? []);
  return <svg className="board-svg" viewBox={`0 0 ${cols * unit + pad * 2} ${rows * unit + pad * 2}`} role="img" aria-label={`Pips board: ${rows} rows, ${cols} columns, ${model.cells.length} cells. ${snapshot?.placements.length ?? 0} dominoes placed.`}>
    <defs><filter id="tile-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity=".08"/></filter></defs>
    <g transform={`translate(${pad} ${pad})`}>
      {puzzle.regions.map((r, i) => <g key={i} opacity={selected === null || selected === i ? 1 : .3} className="region-group" role="button" tabIndex={0} aria-label={`Region ${i + 1}: ${r.type} ${r.target ?? ''}, ${r.indices.length} cells`} onClick={() => onSelect(selected === i ? null : i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selected === i ? null : i); } }}>
        {r.indices.map(([row, col]) => {
          const id = cellIds.get(`${row},${col}`)!;
          const confidence = snapshot ? Math.max(...snapshot.beliefs[id]) : 0;
          const fill = heat && snapshot ? `hsl(86 17% ${93 - confidence * 43}%)` : palette[i % palette.length];
          return <g key={`${row},${col}`}>
            <rect x={col * unit + 2} y={row * unit + 2} width={unit - 4} height={unit - 4} rx="8" fill={fill}/>
            {[[0, 1], [1, 0]].map(([dr, dc]) => regions.get(`${row + dr},${col + dc}`) === i ? <rect key={`${dr}${dc}`} x={col * unit + (dc ? unit - 8 : 2)} y={row * unit + (dr ? unit - 8 : 2)} width={dc ? 16 : unit - 4} height={dr ? 16 : unit - 4} fill={fill}/> : null)}
            {!active.has(id) && <circle cx={col * unit + unit / 2} cy={row * unit + unit / 2} r="2" fill="#6d7162" opacity=".24"/>}
          </g>;
        })}
      </g>)}
      {snapshot?.placements.map(p => {
        const a = model.cells[p.cells[0]], b = model.cells[p.cells[1]];
        const x = Math.min(a[1], b[1]) * unit, y = Math.min(a[0], b[0]) * unit;
        const vertical = a[0] !== b[0];
        return <g key={p.domino} className="placed-tile" pointerEvents="none" opacity={selected === null || p.cells.some(c => regions.get(key(model.cells[c])) === selected) ? 1 : .25}>
          <rect x={x + 6} y={y + 6} width={(vertical ? 1 : 2) * unit - 12} height={(vertical ? 2 : 1) * unit - 12} rx="7" fill="#faf9f3" fillOpacity=".82" stroke="#777765" strokeOpacity=".4" filter="url(#tile-shadow)"/>
          {vertical ? <path d={`M${x + 16},${y + unit}h28`} stroke="#a6a496"/> : <path d={`M${x + unit},${y + 16}v28`} stroke="#a6a496"/>}
          {p.cells.map(c => <Pip key={c} value={vals.get(c)!} x={model.cells[c][1] * unit + unit / 2} y={model.cells[c][0] * unit + unit / 2} size={10}/>)}
        </g>;
      })}
      {puzzle.regions.map((r, i) => {
        if (r.type === 'empty') return null;
        const [row, col] = [...r.indices].sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
        const label = ruleLabel(r), w = Math.max(21, label.length * 8 + 8);
        return <g key={i} pointerEvents="none" opacity={selected === null || selected === i ? 1 : .3}><rect x={col * unit + unit - w - 1} y={row * unit + unit - 18} width={w} height="19" rx="5" fill="#faf8f2" stroke={palette[i % palette.length]} strokeWidth="1.5"/><text x={col * unit + unit - w / 2 - 1} y={row * unit + unit - 4.5} textAnchor="middle" className="rule-label">{label}</text></g>;
      })}
    </g>
  </svg>;
}

export function FactorGraph({ model, puzzle, snapshot, chosen, onChoose }: { model: Model; puzzle: Puzzle; snapshot?: Snapshot; chosen: number | null; onChoose: (v: number | null) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const n = model.domains.length;
  const covers = model.factors.filter(f => f.kind === 'cover');
  const regions = model.factors.filter(f => f.kind === 'region');
  const variablePoint = (i: number) => ({ x: 275 + Math.cos(Math.PI / 2 + 2 * Math.PI * i / n) * 105, y: 180 + Math.sin(Math.PI / 2 + 2 * Math.PI * i / n) * 105 });
  const factorPoint = (id: string) => {
    const c = covers.findIndex(f => f.id === id);
    if (c >= 0) { const angle = Math.PI + (c / Math.max(1, covers.length - 1)) * Math.PI; return { x: 275 + Math.cos(angle) * 205, y: 183 + Math.sin(angle) * 155 }; }
    const r = regions.findIndex(f => f.id === id);
    const angle = (r + .5) / regions.length * Math.PI;
    return { x: 275 + Math.cos(angle) * 205, y: 190 + Math.sin(angle) * 155 };
  };
  const picked = chosen !== null;
  const activeFactors = new Set(picked ? model.factors.filter(f => f.variables.includes(chosen)).map(f => f.id) : []);
  const linkActive = (id: string, v: number) => picked ? v === chosen : hover ? hover === id : false;
  return <div className="graph-wrap"><svg viewBox="0 0 550 375" className="factor-svg" role="img" aria-label="Factor graph. Circular nodes are domino placement variables. Square nodes enforce cell coverage and region constraints. Select a domino to inspect its connections.">
    {model.factors.flatMap(f => f.variables.map(v => {
      const a = variablePoint(v), b = factorPoint(f.id), active = linkActive(f.id, v);
      return <path key={`${f.id}-${v}`} d={`M${a.x} ${a.y}Q275 180 ${b.x} ${b.y}`} fill="none" stroke={active ? '#778365' : '#c6c7b9'} strokeWidth={active ? 1.4 : .55} opacity={active ? .8 : picked || hover ? .035 : .17} className={active && snapshot?.phase === 'messages' ? 'message-edge' : ''}/>;
    }))}
    {model.factors.map(f => {
      const p = factorPoint(f.id), active = !picked || activeFactors.has(f.id);
      return <g key={f.id} onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)} opacity={active ? 1 : .25}><title>{f.kind === 'cover' ? `Cell ${f.cell! + 1}: covered exactly once` : `Region ${f.region! + 1}: ${puzzle.regions[f.region!].type} ${puzzle.regions[f.region!].target ?? ''}`}. Connected to {f.variables.length} dominoes.</title><rect x={p.x - 8} y={p.y - 8} width="16" height="16" rx={f.kind === 'region' ? 3 : 1} fill={f.kind === 'region' ? palette[f.region! % palette.length] : '#f7f5ef'} stroke={f.kind === 'region' ? '#a8ad97' : '#c4c4b5'}/><text x={p.x} y={p.y + 3} textAnchor="middle" className="factor-label">{f.kind === 'region' ? f.label : ''}</text></g>;
    })}
    {model.domains.map((_, i) => {
      const p = variablePoint(i), isChosen = chosen === i, used = snapshot?.placements.some(p => p.domino === i);
      return <g key={i} className="variable-node" role="button" tabIndex={0} aria-label={`Domino ${i + 1}: ${puzzle.dominoes[i].join('–')}`} aria-pressed={isChosen} onClick={() => onChoose(isChosen ? null : i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoose(isChosen ? null : i); } }}><circle cx={p.x} cy={p.y} r={isChosen ? 16 : 13} fill={isChosen || used ? '#5f6c50' : '#f5f3eb'} stroke={isChosen || used ? '#5f6c50' : '#9b9f8d'}/><text x={p.x} y={p.y + 3.5} fill={isChosen || used ? '#fff' : '#60644e'} textAnchor="middle" className="variable-label">{i + 1}</text></g>;
    })}
  </svg><div className="graph-legend"><span><i className="circle-key"/>Domino variable</span><span><i className="square-key"/>Cell factor</span><span><i className="square-key filled"/>Region factor</span></div></div>;
}

export function BeliefView({ model, snapshot }: { model: Model; snapshot?: Snapshot }) {
  return <div className="belief-grid"><div className="belief-heading"><span>Cell</span>{[0, 1, 2, 3, 4, 5, 6].map(v => <span key={v}>{v}</span>)}</div>{model.cells.map(([r, c], i) => <div className="belief-row" key={i}><span>{r + 1},{c + 1}</span>{[0, 1, 2, 3, 4, 5, 6].map(v => {
    const b = snapshot?.beliefs[i]?.[v] ?? 1 / 7;
    return <span key={v} style={{ background: `rgba(96, 112, 76, ${b * .85 + .03})`, color: b > .55 ? '#fff' : '#6f7464' }} title={`Cell (${r + 1}, ${c + 1}), ${v} pips: ${(b * 100).toFixed(1)}%`}>{b > .01 ? `${Math.round(b * 100)}%` : '·'}</span>;
  })}</div>)}</div>;
}

export function ResidualChart({ history }: { history: number[] }) {
  const max = Math.max(1, ...history);
  const points = history.map((v, i) => `${8 + i / Math.max(1, history.length - 1) * 228},${63 - v / max * 49}`).join(' ');
  return <svg viewBox="0 0 244 78" role="img" aria-label={history.length ? `Message residual across ${history.length} iterations, latest ${history.at(-1)?.toFixed(4)}` : 'Message residual chart. Run the solver to begin.'} className="residual-chart"><path d="M8 14H236M8 39H236M8 64H236" stroke="#dddcd2" strokeWidth=".7" strokeDasharray="2 4"/>{history.length > 0 ? <><polygon points={`8,64 ${points} ${history.length > 1 ? '236' : '8'},64`} fill="#74815d" opacity=".08"/><polyline points={points} stroke="#73805b" strokeWidth="1.6" fill="none" strokeLinejoin="round"/></> : <path d="M8 63H236" stroke="#acaf9c" strokeWidth="1"/>}</svg>;
}
