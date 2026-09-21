import { key, ruleLabel, type Puzzle, type Placement, type Model, type GraphFactor, type Snapshot, type Region } from './types';

const INF = 1e12;
const BETA = 5;
const bits = (n: number): number => { let c = 0; for (; n; n &= n - 1) c++; return c; };
const filled = (n: number, v = INF) => new Float64Array(n).fill(v);

export function regionValid(r: Region, values: number[], complete = false): boolean {
  const known = values.filter(v => v >= 0);
  const left = values.length - known.length;
  const sum = known.reduce((a, b) => a + b, 0);
  if (complete && left) return false;
  switch (r.type) {
    case 'sum': return sum <= r.target! && sum + left * 6 >= r.target!;
    case 'less': return sum < r.target!;
    case 'greater': return sum + left * 6 > r.target!;
    case 'equals': return new Set(known).size <= 1;
    case 'unequal': return new Set(known).size === known.length && values.length <= 7;
    default: return true;
  }
}

export function buildModel(puzzle: Puzzle): Model {
  const cells = puzzle.regions.flatMap(r => r.indices).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const index = new Map(cells.map((c, i) => [key(c), i]));
  const regions = puzzle.regions.map(r => r.indices.map(c => index.get(key(c))!));
  const edges: [number, number][] = [];
  cells.forEach(([r, c], i) => { for (const neighbor of [[r + 1, c], [r, c + 1]]) { const j = index.get(neighbor.join(',')); if (j !== undefined) edges.push([i, j]); } });
  const domains = puzzle.dominoes.map(([a, b], domino) => edges.flatMap(([i, j]) => {
    const options: Placement[] = [{ domino, cells: [i, j], values: [a, b] }];
    if (a !== b) options.push({ domino, cells: [i, j], values: [b, a] });
    return options.filter(p => puzzle.regions.every((r, k) => regionValid(r, regions[k].map(c => c === i ? p.values[0] : c === j ? p.values[1] : -1))));
  }));
  const factors: GraphFactor[] = cells.map((_, cell) => ({ id: `c${cell}`, kind: 'cover', label: `C${cell + 1}`, cell, variables: domains.flatMap((d, i) => d.some(p => p.cells.includes(cell)) ? [i] : []) }));
  puzzle.regions.forEach((r, region) => {
    if (r.type !== 'empty') factors.push({ id: `r${region}`, kind: 'region', label: ruleLabel(r), region, variables: domains.flatMap((d, i) => d.some(p => p.cells.some(c => regions[region].includes(c))) ? [i] : []) });
  });
  return { cells, domains, factors };
}

interface Contribution { sum: number; mask: number; count: number; values: number[] }
interface Edge { variable: number; values: Contribution[]; message: Float64Array }
interface Factor { graph: GraphFactor; edges: Edge[]; rule: Region['type'] | 'cover'; target: number }
interface Options { iterations?: number; damping?: number; maxNodes?: number; timeoutMs?: number }

export function solve(puzzle: Puzzle, emit: (s: Snapshot) => void = () => {}, options: Options = {}): Snapshot {
  const start = performance.now();
  const model = buildModel(puzzle);
  const { cells, domains } = model;
  const cellIndex = new Map(cells.map((c, i) => [key(c), i]));
  const regionCells = puzzle.regions.map(r => r.indices.map(c => cellIndex.get(key(c))!));
  const factors: Factor[] = model.factors.map(graph => {
    const scope = graph.kind === 'cover' ? [graph.cell!] : regionCells[graph.region!];
    return { graph, rule: graph.kind === 'cover' ? 'cover' : puzzle.regions[graph.region!].type, target: graph.kind === 'cover' ? 1 : puzzle.regions[graph.region!].target ?? 0,
      edges: graph.variables.map(variable => ({ variable, message: filled(domains[variable].length, 0), values: domains[variable].map(p => {
        const values = p.cells.flatMap((c, j) => scope.includes(c) ? [p.values[j]] : []);
        return { sum: graph.kind === 'cover' ? values.length : values.reduce((a, b) => a + b, 0), mask: values.reduce((m, v) => m | (1 << v), 0), count: values.length, values };
      }) })) };
  });
  const assignments = new Array<number>(cells.length).fill(-1);
  const used = new Set<number>();
  const placed: Placement[] = [];
  let iteration = 0, residual = 0, nodes = 0, backtracks = 0, lastEmit = 0;
  const history: number[] = [];
  let costs = domains.map(d => filled(d.length, 0));
  let limited = false;
  const damping = Math.max(0, Math.min(0.95, options.damping ?? 0.45));
  const timeout = options.timeoutMs ?? 60000;

  function beliefs(): number[][] {
    const result = cells.map(() => new Array<number>(7).fill(0));
    domains.forEach((d, i) => {
      const min = Math.min(...costs[i]);
      const weights = d.map((_, j) => Math.exp(-Math.min(700, costs[i][j] - min)));
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      d.forEach((p, j) => p.cells.forEach((c, k) => { result[c][p.values[k]] += weights[j] / total; }));
    });
    return result.map((b, c) => assignments[c] >= 0 ? b.map((_, v) => Number(v === assignments[c])) : b.map(v => v / (b.reduce((a, x) => a + x, 0) || 1)));
  }
  function snapshot(phase: Snapshot['phase']): Snapshot {
    return { phase, iteration, residual, beliefs: beliefs(), placements: [...placed], nodes, backtracks, elapsed: performance.now() - start, history: [...history] };
  }
  function feasible(p: Placement) {
    if (used.has(p.domino) || p.cells.some(c => assignments[c] >= 0)) return false;
    return puzzle.regions.every((r, k) => regionValid(r, regionCells[k].map(c => c === p.cells[0] ? p.values[0] : c === p.cells[1] ? p.values[1] : assignments[c])));
  }
  function totals(active?: boolean[][]) {
    const out = domains.map((d, i) => Float64Array.from(d, (_, j) => active && !active[i][j] ? INF / 2 : j * 1e-7));
    for (const f of factors) for (const e of f.edges) for (let j = 0; j < e.message.length; j++) out[e.variable][j] += e.message[j];
    return out;
  }

  function runBP(rounds: number, active?: boolean[][]) {
    for (let round = 0; round < rounds; round++) {
      if (performance.now() - start > timeout) { limited = true; return; }
      const total = totals(active);
      residual = 0;
      for (const f of factors) {
        const incoming = f.edges.map(e => Float64Array.from(e.message, (m, j) => total[e.variable][j] - m));
        let outgoing: Float64Array[];
        if (f.rule === 'equals') {
          const minima = f.edges.map((e, i) => Array.from({ length: 7 }, (_, v) => Math.min(...e.values.map((q, j) => incoming[i][j] + BETA * q.values.filter(x => x !== v).length))));
          const sums = Array.from({ length: 7 }, (_, v) => minima.reduce((s, m) => s + m[v], 0));
          outgoing = f.edges.map(e => filled(e.message.length, 0));
          f.edges.forEach((e, i) => e.values.forEach((q, j) => { outgoing[i][j] = Math.min(...sums.map((s, v) => s - minima[i][v] + BETA * q.values.filter(x => x !== v).length)); }));
        } else {
          const maskMode = f.rule === 'unequal';
          const groups = f.edges.map((e, i) => {
            const group = new Map<number, number>();
            e.values.forEach((q, j) => {
              const state = maskMode ? q.mask : q.sum;
              const cost = incoming[i][j] + (maskMode ? BETA * (q.count - bits(q.mask)) : 0);
              group.set(state, Math.min(group.get(state) ?? INF, cost));
            });
            return [...group.entries()];
          });
          const size = maskMode ? 128 : 1 + groups.reduce((s, g) => s + Math.max(0, ...g.map(([q]) => q)), 0);
          const transition = (s: number, q: number) => maskMode ? s | q : s + q;
          const penalty = (s: number, q: number) => maskMode ? BETA * bits(s & q) : 0;
          const forward = [filled(size)];
          forward[0][0] = 0;
          groups.forEach((g, i) => {
            const next = filled(size);
            for (let s = 0; s < size; s++) if (forward[i][s] < INF) for (const [q, cost] of g) {
              const t = transition(s, q);
              if (t < size) next[t] = Math.min(next[t], forward[i][s] + cost + penalty(s, q));
            }
            forward.push(next);
          });
          const end = Float64Array.from({ length: size }, (_, s) => BETA * (maskMode ? 0 : f.rule === 'less' ? Math.max(0, s - f.target + 1) : f.rule === 'greater' ? Math.max(0, f.target + 1 - s) : Math.abs(s - f.target)));
          const backward = new Array<Float64Array>(groups.length + 1);
          backward[groups.length] = end;
          for (let i = groups.length - 1; i >= 0; i--) {
            backward[i] = filled(size);
            for (let s = 0; s < size; s++) for (const [q, cost] of groups[i]) {
              const t = transition(s, q);
              if (t < size) backward[i][s] = Math.min(backward[i][s], cost + penalty(s, q) + backward[i + 1][t]);
            }
          }
          outgoing = f.edges.map((e, i) => {
            const byState = new Map<number, number>();
            for (const [q] of groups[i]) {
              let best = INF;
              for (let s = 0; s < size; s++) {
                const t = transition(s, q);
                if (t < size) best = Math.min(best, forward[i][s] + penalty(s, q) + backward[i + 1][t]);
              }
              byState.set(q, best);
            }
            return Float64Array.from(e.values, q => byState.get(maskMode ? q.mask : q.sum)! + (maskMode ? BETA * (q.count - bits(q.mask)) : 0));
          });
        }
        f.edges.forEach((e, i) => {
          const min = Math.min(...outgoing[i]);
          e.message.forEach((old, j) => {
            const value = damping * old + (1 - damping) * Math.min(1000, outgoing[i][j] - min);
            residual = Math.max(residual, Math.abs(old - value));
            e.message[j] = value;
          });
        });
      }
      costs = totals(active);
      iteration++;
      history.push(residual);
      emit(snapshot('messages'));
      if (residual < 1e-5 && round >= 5) break;
    }
  }

  if (domains.some(d => !d.length)) { const s = snapshot('unsatisfiable'); emit(s); return s; }
  runBP(options.iterations ?? 28);
  let deepestBP = 0;
  function search(): boolean {
    if (++nodes > (options.maxNodes ?? 500000) || performance.now() - start > timeout) { limited = true; return false; }
    if (placed.length === domains.length) return validateSolution(puzzle, placed);
    const available = domains.map(d => d.filter(feasible));
    if (domains.some((_, i) => !used.has(i) && !available[i].length)) return false;
    const candidates = cells.flatMap((_, c) => assignments[c] < 0 ? [available.flat().filter(p => p.cells.includes(c))] : []);
    if (candidates.some(d => !d.length)) return false;
    for (let k = 0; k < puzzle.regions.length; k++) {
      const r = puzzle.regions[k];
      const valueSets = regionCells[k].map(c => assignments[c] >= 0 ? [assignments[c]] : [...new Set(available.flat().filter(p => p.cells.includes(c)).map(p => p.values[p.cells.indexOf(c)]))]);
      if (r.type === 'equals' && !valueSets[0].some(v => valueSets.every(s => s.includes(v)))) return false;
      if (['sum', 'less', 'greater'].includes(r.type)) {
        const min = valueSets.reduce((s, v) => s + Math.min(...v), 0), max = valueSets.reduce((s, v) => s + Math.max(...v), 0);
        if (r.type === 'sum' && (min > r.target! || max < r.target!) || r.type === 'less' && min >= r.target! || r.type === 'greater' && max <= r.target!) return false;
      }
    }
    if (placed.length >= deepestBP + 4) {
      deepestBP = placed.length;
      const active = domains.map((d, i) => d.map(p => used.has(i) ? placed.includes(p) : feasible(p)));
      runBP(6, active);
    }
    const score = (p: Placement) => costs[p.domino][domains[p.domino].indexOf(p)];
    for (let i = 0; i < domains.length; i++) if (!used.has(i)) candidates.push(available[i]);
    candidates.sort((a, b) => a.length - b.length);
    const choice = candidates[0].sort((a, b) => score(a) - score(b));
    const signatures = new Set<string>();
    for (const p of choice) {
      const sig = `${p.cells.join(',')}:${p.values.join(',')}`;
      if (signatures.has(sig)) continue;
      signatures.add(sig);
      placed.push(p); used.add(p.domino);
      p.cells.forEach((c, j) => { assignments[c] = p.values[j]; });
      if (performance.now() - lastEmit > 45) { emit(snapshot('search')); lastEmit = performance.now(); }
      if (search()) return true;
      placed.pop(); used.delete(p.domino);
      p.cells.forEach(c => { assignments[c] = -1; });
      backtracks++;
      if (limited) return false;
    }
    return false;
  }
  const success = !limited && search();
  const result = snapshot(success ? 'solved' : limited ? 'limit' : 'unsatisfiable');
  emit(result);
  return result;
}

export function validateSolution(puzzle: Puzzle, placements: Placement[]): boolean {
  const cells = puzzle.regions.flatMap(r => r.indices).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const values = new Map<string, number>();
  const used = new Set<number>();
  if (placements.length !== puzzle.dominoes.length) return false;
  for (const p of placements) {
    const d = puzzle.dominoes[p.domino], a = cells[p.cells[0]], b = cells[p.cells[1]];
    if (!d || !a || !b || used.has(p.domino) || Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1 || [...d].sort().join() !== [...p.values].sort().join()) return false;
    if (values.has(key(a)) || values.has(key(b))) return false;
    used.add(p.domino); values.set(key(a), p.values[0]); values.set(key(b), p.values[1]);
  }
  return values.size === cells.length && puzzle.regions.every(r => regionValid(r, r.indices.map(c => values.get(key(c)) ?? -1), true));
}
