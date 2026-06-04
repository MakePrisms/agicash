/**
 * `ScanDomain` implementation — §3 of the contract, Slice 2 (reactive overlay, design B).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/scan/classify-input.ts#classifyInput`. `parse(input)`
 * classifies a raw scanned/pasted string into a {@link ParsedDestination} — the KIND only
 * (`bolt11` | `ln-address` | `cashu-token`), with NO merchant/contact resolution (decision
 * 3: gift-card/contact matching is the separate `suggestFor` step, not part of parse).
 *
 * REACTIVE OVERLAY: `parse` is a one-shot, connection-free decode ACTION (not an observable
 * read), so it stays a `Promise<ParsedDestination>` (NOT a `Query`) — there is nothing to
 * subscribe to. The body is identical to the no-cache impl.
 *
 * Re-housing notes:
 *  - The three decode libs (`parseBolt11Invoice`, `extractCashuToken`,
 *    `buildLightningAddressFormatValidator`) are SDK-internal (§12); imported via
 *    `internal/lib-scan`.
 *  - Master gates the ln-address `allowLocalhost` flag on `import.meta.env.MODE ===
 *    'development'`. The SDK is framework-free, so that becomes a constructor option
 *    (`allowLocalhost`, default `false` = production behaviour).
 *  - ln-address → invoice resolution (LNURL-pay) is NOT done here — it folds into
 *    `createLightningQuote` (Slice 3/PR5) where the amount is known (§3). So `parse` only
 *    surfaces the address.
 *  - `parse` REJECTS (throws) on an unclassifiable input. Master's `classifyInput` returns
 *    `null`; the contract types `parse` as `Promise<ParsedDestination>` (no null), so an
 *    unrecognised string is a {@link DomainError} the caller surfaces.
 *
 * @module
 */
import type { ScanDomain } from '../domains';
import { DomainError } from '../errors';
import {
  buildLightningAddressFormatValidator,
  extractCashuToken,
  parseBolt11Invoice,
} from '../internal/lib-scan';
import type { ParsedDestination, ParsedToken } from '../types/scan';

/**
 * The scan domain. Construct with `{ allowLocalhost }` controlling whether a
 * `user@localhost` Lightning address is accepted (development convenience; default `false`,
 * matching production). Re-houses master `classifyInput`.
 */
export class ScanDomainImpl implements ScanDomain {
  /** The ln-address FORMAT validator, built once with the localhost policy. */
  private readonly validateLnAddressFormat: (
    value: string | null | undefined,
  ) => string | boolean;

  /**
   * @param options - `{ allowLocalhost }` — accept `user@localhost(:port)` addresses
   *   (development only); defaults to `false`.
   */
  constructor(options?: { allowLocalhost?: boolean }) {
    this.validateLnAddressFormat = buildLightningAddressFormatValidator({
      message: 'invalid',
      allowLocalhost: options?.allowLocalhost ?? false,
    });
  }

  /**
   * Classify a raw string into a {@link ParsedDestination}. Priority (verbatim from master):
   * cashu token → BOLT11 invoice → Lightning address. A one-shot decode → `Promise`.
   *
   * @param input - the scanned/pasted string (may carry a `cashu:` / `lightning:` prefix, a
   *   wrapping URL, or surrounding whitespace).
   * @returns the parsed destination (kind only).
   * @throws DomainError if the input is not a recognised destination.
   */
  async parse(input: string): Promise<ParsedDestination> {
    const trimmed = input.trim();

    // 1. Cashu token (works on URLs, raw tokens, `cashu:`-prefixed, etc.).
    const cashuResult = extractCashuToken(trimmed);
    if (cashuResult) {
      const token: ParsedToken = {
        encoded: cashuResult.encoded,
        metadata: cashuResult.metadata,
      };
      return { kind: 'cashu-token', token };
    }

    // 2. BOLT11 invoice (accepts an optional, case-insensitive `lightning:` prefix).
    const bolt11Result = parseBolt11Invoice(trimmed);
    if (bolt11Result.valid) {
      return { kind: 'bolt11', invoice: bolt11Result.decoded };
    }

    // 3. Lightning address — lowercase before validation (the format validator's local-part
    // regex only accepts lowercase).
    const lowered = trimmed.toLowerCase();
    if (this.validateLnAddressFormat(lowered) === true) {
      return { kind: 'ln-address', address: lowered };
    }

    throw new DomainError(
      'Unrecognised input: not a Lightning invoice, Lightning address, or cashu token',
      'UNRECOGNISED_DESTINATION',
    );
  }
}
