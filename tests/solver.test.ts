import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, validateSolution, regionValid, buildModel } from '../src/solver';
import { parsePuzzle } from '../src/types';

const small = (type: string, target?: number) => parsePuzzle({ dominoes: [[1, 2], [3, 3]], regions: [{ indices: [[0, 0], [0, 1]], type, target }, { indices: [[1, 0], [1, 1]], type: 'equals' }] });

test('solves with real messages and verified beliefs', () => {
  const puzzle = small('sum', 3);
  const snapshots: number[] = [];
  const result = solve(puzzle, s => snapshots.push(s.residual));
  assert.equal(result.phase, 'solved');
  assert.ok(validateSolution(puzzle, result.placements));
  assert.ok(snapshots.some(r => r > 0));
  assert.ok(result.iteration >= 6);
  assert.ok(result.beliefs.every(b => b.filter(v => v === 1).length === 1));
});

for (const [type, target] of [['sum', 3], ['less', 4], ['greater', 2], ['unequal', undefined], ['empty', undefined]] as const) {
  test(`solves ${type} constraints and equality`, () => {
    const puzzle = small(type, target);
    const result = solve(puzzle);
    assert.equal(result.phase, 'solved');
    assert.ok(validateSolution(puzzle, result.placements));
  });
}

test('reports an impossible regional sum without claiming success', () => {
  const result = solve(small('sum', 13));
  assert.equal(result.phase, 'unsatisfiable');
});

test('treats identical dominoes as separate physical pieces', () => {
  const puzzle = parsePuzzle({ dominoes: [[2, 2], [2, 2]], regions: [{ indices: [[0, 0], [0, 1], [1, 0], [1, 1]], type: 'sum', target: 8 }] });
  const result = solve(puzzle);
  assert.equal(result.phase, 'solved');
  assert.equal(new Set(result.placements.map(p => p.domino)).size, 2);
});

test('strict inequalities and distinctness are checked exactly', () => {
  assert.equal(regionValid({ type: 'less', target: 3, indices: [] }, [1, 2], true), false);
  assert.equal(regionValid({ type: 'greater', target: 3, indices: [] }, [1, 2], true), false);
  assert.equal(regionValid({ type: 'unequal', indices: [] }, [2, 2], true), false);
});

test('rejects overlapping input cells and malformed dominoes', () => {
  assert.throws(() => parsePuzzle({ dominoes: [[1, 2]], regions: [{ type: 'empty', indices: [[0, 0], [0, 0]] }] }));
  assert.throws(() => parsePuzzle({ dominoes: [[7, 2]], regions: [] }));
});

test('validator rejects reused tiles and disconnected placements', () => {
  const puzzle = small('sum', 3);
  const result = solve(puzzle);
  assert.equal(validateSolution(puzzle, [result.placements[0], result.placements[0]]), false);
  assert.equal(validateSolution(puzzle, [{ domino: 0, cells: [0, 3], values: [1, 2] }, result.placements[1]]), false);
});

test('graph expresses tray uniqueness by one placement variable per domino', () => {
  const model = buildModel(small('sum', 3));
  assert.equal(model.domains.length, 2);
  assert.equal(model.factors.filter(f => f.kind === 'cover').length, 4);
  assert.equal(model.factors.filter(f => f.kind === 'region').length, 2);
});

test('timeout is a limit, not an unsatisfiability claim', () => {
  const result = solve(small('sum', 3), () => {}, { timeoutMs: -1 });
  assert.equal(result.phase, 'limit');
});
