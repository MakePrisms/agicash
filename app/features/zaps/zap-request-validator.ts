import { type Event, verifyEvent } from 'nostr-tools/pure';
import { z } from 'zod';
import { safeJsonParse } from '~/lib/json';

const ZAP_REQUEST_KIND = 9734;

export type ValidatedZapRequest = {
  pubkey: string;
  content: string;
  pTag: string;
  eTag?: string;
  aTag?: string;
  kTag?: string;
  PTag?: string;
  amountTag?: string;
  relays: string[];
  rawJson: string;
};

export type ZapRequestValidationError = { error: string };

const TagSchema = z.array(z.string());

const ZapRequestEventSchema = z.object({
  id: z.string(),
  pubkey: z.string(),
  created_at: z.number(),
  kind: z.literal(ZAP_REQUEST_KIND),
  tags: z.array(TagSchema),
  content: z.string(),
  sig: z.string(),
});

/**
 * Decodes, parses, and validates a NIP-57 kind:9734 zap request received via the
 * `nostr` query parameter of an LNURL-pay callback.
 *
 * Returns the parsed shape with `rawJson` preserved exactly as received -
 * required so the resulting kind:9735 receipt's `description` tag matches
 * the bolt11 `h` tag hash.
 */
export function parseAndValidateZapRequest(
  nostrParam: string,
  amountMsat: number,
): ValidatedZapRequest | ZapRequestValidationError {
  let decoded: string;
  try {
    decoded = decodeURIComponent(nostrParam);
  } catch {
    return { error: 'Invalid URL-encoded zap request' };
  }

  const jsonResult = safeJsonParse(decoded);
  if (!jsonResult.success) {
    return { error: 'Invalid JSON in zap request' };
  }

  const parsed = ZapRequestEventSchema.safeParse(jsonResult.data);
  if (!parsed.success) {
    return { error: 'Malformed zap request event' };
  }

  const event = parsed.data as Event;

  if (!verifyEvent(event)) {
    return { error: 'Invalid zap request signature' };
  }

  const pTags = event.tags.filter((t) => t[0] === 'p');
  if (pTags.length !== 1) {
    return { error: 'Zap request must have exactly one p tag' };
  }
  const pTag = pTags[0]?.[1];
  if (!pTag) {
    return { error: 'Zap request p tag is missing pubkey' };
  }

  const eTags = event.tags.filter((t) => t[0] === 'e');
  if (eTags.length > 1) {
    return { error: 'Zap request must have at most one e tag' };
  }

  const aTags = event.tags.filter((t) => t[0] === 'a');
  if (aTags.length > 1) {
    return { error: 'Zap request must have at most one a tag' };
  }

  const PTags = event.tags.filter((t) => t[0] === 'P');
  if (PTags.length > 1) {
    return { error: 'Zap request must have at most one P tag' };
  }

  const amountTags = event.tags.filter((t) => t[0] === 'amount');
  if (amountTags.length > 1) {
    return { error: 'Zap request must have at most one amount tag' };
  }
  const amountTagValue = amountTags[0]?.[1];
  if (amountTagValue !== undefined && amountTagValue !== String(amountMsat)) {
    return { error: 'Zap request amount does not match callback amount' };
  }

  const relaysTag = event.tags.find((t) => t[0] === 'relays');
  if (!relaysTag || relaysTag.length < 2) {
    return { error: 'Zap request must have a relays tag with at least one url' };
  }
  const relays = relaysTag.slice(1).filter((r) => r.length > 0);
  if (relays.length === 0) {
    return { error: 'Zap request relays tag must contain at least one url' };
  }

  const kTag = event.tags.find((t) => t[0] === 'k')?.[1];

  return {
    pubkey: event.pubkey,
    content: event.content,
    pTag,
    eTag: eTags[0]?.[1],
    aTag: aTags[0]?.[1],
    kTag,
    PTag: PTags[0]?.[1],
    amountTag: amountTagValue,
    relays,
    rawJson: decoded,
  };
}
