import type { ScanDomain } from '../../domains';
import { DomainError } from '../../errors';
import { parseBolt11Invoice } from '../../internal/lib/bolt11';
import { extractCashuToken } from '../../internal/lib/cashu';
import { buildLightningAddressFormatValidator } from '../../internal/lib/lnurl';
import type { ParsedDestination } from '../../types/scan';
import type { DomainContext } from '../context';

/** Build the scan domain. `parse` classifies raw input into a ParsedDestination. */
export function createScanDomain(ctx: DomainContext): ScanDomain {
  const validateLnAddressFormat = buildLightningAddressFormatValidator({
    message: 'invalid',
    allowLocalhost: ctx.config.allowLocalhostLightningAddress ?? false,
  });

  return {
    async parse(input: string): Promise<ParsedDestination> {
      const trimmed = input.trim();

      const cashu = extractCashuToken(trimmed);
      if (cashu) {
        return { kind: 'cashu-token', token: cashu };
      }

      const bolt11 = parseBolt11Invoice(trimmed);
      if (bolt11.valid) {
        return { kind: 'bolt11', invoice: bolt11.decoded };
      }

      const lowered = trimmed.toLowerCase();
      if (validateLnAddressFormat(lowered) === true) {
        return { kind: 'ln-address', address: lowered };
      }

      throw new DomainError(
        'Unrecognized payment destination',
        'UNRECOGNIZED_DESTINATION',
      );
    },
  };
}
