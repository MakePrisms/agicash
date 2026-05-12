import type { AgicashDb } from '../agicash-db/database';

export type ZapQuoteType = 'cashu' | 'spark';

export type NostrZapRequestRow = {
  id: string;
  quoteId: string;
  quoteType: ZapQuoteType;
  paymentHash: string;
  zapRequestJson: string;
  relays: string[];
  paidAtUnixSec: number | null;
  createdAt: string;
  lastAttemptAt: string | null;
  publishedAt: string | null;
  publishError: string | null;
};

export type CreateNostrZapRequestParams = {
  quoteId: string;
  quoteType: ZapQuoteType;
  paymentHash: string;
  zapRequestJson: string;
  relays: string[];
};

type DbRow = {
  id: string;
  quote_id: string;
  quote_type: string;
  payment_hash: string;
  zap_request_json: string;
  relays: string[];
  paid_at_unix_sec: number | null;
  created_at: string;
  last_attempt_at: string | null;
  published_at: string | null;
  publish_error: string | null;
};

function toRow(row: DbRow): NostrZapRequestRow {
  return {
    id: row.id,
    quoteId: row.quote_id,
    quoteType: row.quote_type as ZapQuoteType,
    paymentHash: row.payment_hash,
    zapRequestJson: row.zap_request_json,
    relays: row.relays,
    paidAtUnixSec: row.paid_at_unix_sec,
    createdAt: row.created_at,
    lastAttemptAt: row.last_attempt_at,
    publishedAt: row.published_at,
    publishError: row.publish_error,
  };
}

/**
 * Server-side repository for NIP-57 zap requests persisted on LNURL-pay
 * callback so kind:9735 receipts can be published after the invoice is paid.
 */
export class NostrZapRequestRepositoryServer {
  constructor(private readonly db: AgicashDb) {}

  async create(
    params: CreateNostrZapRequestParams,
  ): Promise<NostrZapRequestRow> {
    const { data, error } = await this.db
      .from('nostr_zap_requests')
      .insert({
        quote_id: params.quoteId,
        quote_type: params.quoteType,
        payment_hash: params.paymentHash,
        zap_request_json: params.zapRequestJson,
        relays: params.relays,
      })
      .select()
      .single();

    if (error) {
      throw new Error('Failed to create nostr zap request', { cause: error });
    }

    return toRow(data);
  }

  async findByQuote(
    quoteId: string,
    quoteType: ZapQuoteType,
  ): Promise<NostrZapRequestRow | null> {
    const { data, error } = await this.db
      .from('nostr_zap_requests')
      .select()
      .eq('quote_id', quoteId)
      .eq('quote_type', quoteType)
      .maybeSingle();

    if (error) {
      throw new Error('Failed to fetch nostr zap request', { cause: error });
    }

    return data ? toRow(data) : null;
  }

  async setPaidAt(id: string, paidAtUnixSec: number): Promise<void> {
    const { error } = await this.db
      .from('nostr_zap_requests')
      .update({ paid_at_unix_sec: paidAtUnixSec })
      .eq('id', id)
      .is('paid_at_unix_sec', null);

    if (error) {
      throw new Error('Failed to set nostr zap request paid_at', {
        cause: error,
      });
    }
  }

  async markPublished(id: string, publishedAt: Date): Promise<void> {
    const { error } = await this.db
      .from('nostr_zap_requests')
      .update({
        published_at: publishedAt.toISOString(),
        last_attempt_at: publishedAt.toISOString(),
        publish_error: null,
      })
      .eq('id', id);

    if (error) {
      throw new Error('Failed to mark nostr zap request published', {
        cause: error,
      });
    }
  }

  async markFailedAttempt(id: string, errorMessage: string): Promise<void> {
    const { error } = await this.db
      .from('nostr_zap_requests')
      .update({
        last_attempt_at: new Date().toISOString(),
        publish_error: errorMessage.slice(0, 500),
      })
      .eq('id', id);

    if (error) {
      throw new Error('Failed to mark nostr zap request failed attempt', {
        cause: error,
      });
    }
  }

  async findUnpublishedReadyToRetry(
    limit: number,
  ): Promise<NostrZapRequestRow[]> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.db
      .from('nostr_zap_requests')
      .select()
      .is('published_at', null)
      .gt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error('Failed to fetch unpublished nostr zap requests', {
        cause: error,
      });
    }

    return (data ?? []).map(toRow);
  }
}
