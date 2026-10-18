import { parse, derivative, rationalize, fraction, evaluate, simplify, FunctionNode } from 'mathjs';

const g = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
g.math = {
  ...(g.math || {}),
  parse,
  derivative,
  rationalize,
  fraction,
  evaluate,
  simplify,
  FunctionNode,
};
export default g.math;
