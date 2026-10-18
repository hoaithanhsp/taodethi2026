// Mirrors services/engine/initMath.ts: expose only the same mathjs subset the app exposes,
// so tests fail if an engine starts depending on something the app does not provide.
import { parse, derivative, rationalize, fraction, evaluate, simplify, FunctionNode } from 'mathjs';
globalThis.math = { parse, derivative, rationalize, fraction, evaluate, simplify, FunctionNode };
await import('../services/engine/bbt.js');
await import('../services/engine/graph.js');
await import('../services/engine/geo3d.js');
await import('../services/engine/geo2d.js');
export const { BBT, Graph, Geo3D, Geo2D } = globalThis;
