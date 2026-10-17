import { parse, derivative, rationalize, fraction, evaluate, simplify } from 'mathjs';

const g = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
g.math = {
  ...(g.math || {}),
  parse,
  derivative,
  rationalize,
  fraction,
  evaluate,
  simplify,
};
export default g.math;
