import { z } from 'zod';

/**
 * Mapping of mint description strings to mint URLs.
 *
 * @example
 * ```json
 * {
 *   "Minibits": "https://mint.minibits.cash/Bitcoin"
 * }
 * ```
 */
export const MintDescriptionMapSchema = z.record(z.string(), z.url());
export type MintDescriptionMap = z.infer<typeof MintDescriptionMapSchema>;

export const JsonMintDescriptionMapSchema = z
  .string()
  .transform((str) => JSON.parse(str))
  .pipe(MintDescriptionMapSchema);
