export type Coord = [number, number];
export type Rule = 'sum' | 'equals' | 'unequal' | 'less' | 'greater' | 'empty';
export interface Region { indices: Coord[]; type: Rule; target?: number }
export interface Puzzle { date: string; dominoes: [number, number][]; regions: Region[] }
export interface Placement { domino: number; cells: [number, number]; values: [number, number] }
export interface GraphFactor { id: string; kind: 'cover' | 'region'; label: string; variables: number[]; region?: number; cell?: number }
export interface Snapshot { phase: 'messages' | 'search' | 'solved' | 'unsatisfiable' | 'limit'; iteration: number; residual: number; beliefs: number[][]; placements: Placement[]; nodes: number; backtracks: number; elapsed: number; history: number[] }
export interface Model { cells: Coord[]; domains: Placement[][]; factors: GraphFactor[] }
export const key = (c: Coord) => c.join(',');
export const ruleLabel = (r: Region) => ({ sum: String(r.target), equals: '=', unequal: '≠', less: `<${r.target}`, greater: `>${r.target}`, empty: '·' })[r.type];
export function parsePuzzle(input: unknown): Puzzle {
  const p = input as Record<string, any>;
  if (!p || typeof p !== 'object') throw new Error('Invalid puzzle.');
  if (!Array.isArray(p.dominoes) || !p.dominoes.length || p.dominoes.length > 30 || !p.dominoes.every((d: unknown) => Array.isArray(d) && d.length === 2 && d.every(v => Number.isInteger(v) && v >= 0 && v <= 6))) throw new Error('Dominoes must be pairs of pip values from 0 to 6 (at most 30 tiles).');
  if (!Array.isArray(p.regions) || !p.regions.length) throw new Error('This puzzle has no regions.');
  const seen = new Set<string>();
  for (const r of p.regions) {
    if (!['sum', 'equals', 'unequal', 'less', 'greater', 'empty'].includes(r.type) || !Array.isArray(r.indices) || !r.indices.length) throw new Error('A region has an invalid rule or no cells.');
    if (['sum', 'less', 'greater'].includes(r.type) && (!Number.isInteger(r.target) || Math.abs(r.target) > 360)) throw new Error('Arithmetic regions need an integer target between −360 and 360.');
    for (const c of r.indices) {
      if (!Array.isArray(c) || c.length !== 2 || !c.every(v => Number.isInteger(v) && v >= 0 && v < 30) || seen.has(key(c as Coord))) throw new Error('Cells must have unique coordinates between 0 and 29.');
      seen.add(key(c as Coord));
    }
  }
  if (seen.size !== p.dominoes.length * 2) throw new Error('The board must contain exactly two cells per domino.');
  return { date: typeof p.date === 'string' ? p.date : '', dominoes: p.dominoes, regions: p.regions };
}
