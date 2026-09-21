import { solve } from './solver';
self.onmessage = ({ data }) => {
  try { solve(data.puzzle, snapshot => self.postMessage({ type: 'snapshot', snapshot }), data.options); }
  catch (error) { self.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'The solver could not finish.' }); }
};
