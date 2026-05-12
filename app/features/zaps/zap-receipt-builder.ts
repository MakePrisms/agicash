import type { EventTemplate } from 'nostr-tools/pure';
import type { ValidatedZapRequest } from './zap-request-validator';

const ZAP_RECEIPT_KIND = 9735;

export type BuildZapReceiptParams = {
  zapRequest: ValidatedZapRequest;
  bolt11: string;
  paidAtUnixSec: number;
  preimage?: string;
};

/**
 * Builds an unsigned NIP-57 kind:9735 zap receipt template.
 *
 * `created_at` is the invoice paid timestamp so retries produce a
 * stable event id; the `description` tag is the EXACT raw zap-request
 * JSON string (verifiers compute SHA256 of these bytes).
 */
export function buildZapReceiptTemplate(
  params: BuildZapReceiptParams,
): EventTemplate {
  const { zapRequest, bolt11, paidAtUnixSec, preimage } = params;

  const tags: string[][] = [
    ['p', zapRequest.pTag],
    ['bolt11', bolt11],
    ['description', zapRequest.rawJson],
  ];

  if (zapRequest.eTag) {
    tags.push(['e', zapRequest.eTag]);
  }
  if (zapRequest.aTag) {
    tags.push(['a', zapRequest.aTag]);
  }
  if (zapRequest.PTag) {
    tags.push(['P', zapRequest.PTag]);
  }
  if (zapRequest.kTag) {
    tags.push(['k', zapRequest.kTag]);
  }
  if (preimage) {
    tags.push(['preimage', preimage]);
  }

  return {
    kind: ZAP_RECEIPT_KIND,
    created_at: paidAtUnixSec,
    tags,
    content: '',
  };
}
