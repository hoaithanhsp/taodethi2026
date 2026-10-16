import { parse, derivative } from 'mathjs';

const g = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
if (!g.math) {
  g.math = { parse, derivative };
}
export default g.math;
