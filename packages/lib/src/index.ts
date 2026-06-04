/**
 * `@agicash/lib` — pure, framework-free cross-cutting utilities shared by the web app and
 * the wallet SDK independently of any wallet-domain concern.
 *
 * This is a leaf package at the bottom of the dependency graph: it depends only on external
 * primitives (`big.js`, `zod`) and never on `@agicash/wallet-sdk`, the web app, or any
 * feature-domain code. Money formatting, JSON parsing, and the zod preprocessing helper all
 * live here so that the web UI can format a `Money` without pulling in the wallet SDK, and the
 * SDK can use `Money` / `Currency` without pulling in the web app.
 */

export { Money } from './money';
export type { Currency, CurrencyUnit } from './money/types';
export { safeJsonParse } from './json';
export { nullToUndefined } from './zod';
