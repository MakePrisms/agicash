import { hexToBytes } from '@noble/hashes/utils';
import { base64url } from '@scure/base';
import type { QueryClient } from '@tanstack/react-query';
import { finalizeEvent } from 'nostr-tools/pure';
import { z } from 'zod';
import { getCashuWallet } from '~/lib/cashu';
import { ExchangeRateService } from '~/lib/exchange-rate/exchange-rate-service';
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '~/lib/lnurl/types';
import { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import {
  decryptXChaCha20Poly1305,
  encryptXChaCha20Poly1305,
} from '~/lib/xchacha20poly1305';
import {
  getServerNostrPubkey,
  getServerNostrSecret,
} from '../zaps/nostr-keys.server';
import { publishZapReceipt } from '../zaps/zap-publisher.server';
import { buildZapReceiptTemplate } from '../zaps/zap-receipt-builder';
import {
  NostrZapRequestRepositoryServer,
  type NostrZapRequestRow,
  type ZapQuoteType,
} from '../zaps/zap-request-repository.server';
import {
  parseAndValidateZapRequest,
  type ValidatedZapRequest,
  validateDecodedZapRequest,
} from '../zaps/zap-request-validator';
import type { AgicashDb } from '../agicash-db/database';
import { NotFoundError } from '../shared/error';
import { sparkWalletQueryOptions } from '../shared/spark';
import {
  ReadUserDefaultAccountRepository,
  ReadUserRepository,
} from '../user/user-repository';
import { getLightningQuote } from './cashu-receive-quote-core';
import { CashuReceiveQuoteRepositoryServer } from './cashu-receive-quote-repository.server';
import { CashuReceiveQuoteServiceServer } from './cashu-receive-quote-service.server';
import { SparkReceiveQuoteRepositoryServer } from './spark-receive-quote-repository.server';
import { SparkReceiveQuoteServiceServer } from './spark-receive-quote-service.server';

const sparkMnemonic = process.env.LNURL_SERVER_SPARK_MNEMONIC || '';
if (!sparkMnemonic) {
  throw new Error('LNURL_SERVER_SPARK_MNEMONIC is not set');
}

const getSparkWalletMnemonic = (): Promise<string> => {
  return Promise.resolve(sparkMnemonic);
};

const encryptionKey = process.env.LNURL_SERVER_ENCRYPTION_KEY || '';
if (!encryptionKey) {
  throw new Error('LNURL_SERVER_ENCRYPTION_KEY is not set');
}
const encryptionKeyBytes = hexToBytes(encryptionKey);

/**
 * This data needed to verify the status of lnurl-pay request is encrypted
 * to improve user privacy by obfuscating the quote data from the LNURL client
 */
const LnurlVerifyQuoteDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('spark'),
    quoteId: z.string(),
    receiveQuoteId: z.string().optional(),
  }),
  z.object({
    type: z.literal('cashu'),
    quoteId: z.string(),
    mintUrl: z.string(),
    receiveQuoteId: z.string().optional(),
  }),
]);

type LnurlVerifyQuoteData = z.infer<typeof LnurlVerifyQuoteDataSchema>;

export type QuoteStatusResult = {
  settled: boolean;
  pr: string;
  preimage?: string;
  /**
   * Unix seconds the invoice was observed paid. Used as `created_at` for
   * the kind:9735 receipt so retries produce stable event ids.
   * Cashu mint quotes do not expose a server-side paid_at, so we capture
   * the first-detection timestamp.
   */
  paidAtUnixSec?: number;
};

export type PublishOutcome =
  | { status: 'published'; relays: string[] }
  | { status: 'skipped' }
  | { status: 'failed' };

export class LightningAddressService {
  private baseUrl: string;
  private db: AgicashDb;
  private userRepository: ReadUserRepository;
  private minSendable: Money<'BTC'>;
  private maxSendable: Money<'BTC'>;
  private exchangeRateService: ExchangeRateService;
  private queryClient: QueryClient;
  /**
   * A client can flag that they will not validate the invoice amount.
   * This is useful for agicash <-> agicash payments so that the receiver can receive into their default currency
   * and we do not have to worry about exchange rate mismatches.
   */
  private bypassAmountValidation: boolean;

  constructor(
    request: Request,
    db: AgicashDb,
    queryClient: QueryClient,
    options?: {
      bypassAmountValidation?: boolean;
    },
  ) {
    this.queryClient = queryClient;
    this.exchangeRateService = new ExchangeRateService();
    this.db = db;
    this.userRepository = new ReadUserRepository(db);
    this.bypassAmountValidation = options?.bypassAmountValidation ?? false;
    this.baseUrl = new URL(request.url).origin;
    this.minSendable = new Money({
      amount: 1,
      currency: 'BTC',
      unit: 'sat',
    });
    this.maxSendable = new Money({
      amount: 1_000_000,
      currency: 'BTC',
      unit: 'sat',
    });
  }

  /**
   * Returns the LNURL-p params for the given username or
   * returns an error if the user is not found.
   */
  async handleLud16Request(
    username: string,
  ): Promise<LNURLPayParams | LNURLError> {
    try {
      const user = await this.userRepository.getByUsername(username);

      if (!user) {
        return {
          status: 'ERROR',
          reason: 'not found',
        };
      }

      const callback = `${this.baseUrl}/api/lnurlp/callback/${user.id}`;
      const address = `${user.username}@${new URL(this.baseUrl).host}`;
      const metadata = JSON.stringify([
        ['text/plain', `Pay to ${address}`],
        ['text/identifier', address],
      ]);

      return {
        callback,
        maxSendable: this.maxSendable.toNumber('msat'),
        minSendable: this.minSendable.toNumber('msat'),
        metadata,
        tag: 'payRequest',
        allowsNostr: true,
        nostrPubkey: getServerNostrPubkey(),
      };
    } catch (error) {
      console.error('Error processing LNURL-pay request', { cause: error });
      return {
        status: 'ERROR',
        reason: 'Internal server error',
      };
    }
  }

  /**
   * Creates a new cashu receive quote for the given user and amount.
   * Optionally persists a NIP-57 zap request so a kind:9735 receipt can be
   * published when the invoice is paid.
   * @returns the bolt11 invoice from the receive quote and the verify callback url.
   */
  async handleLnurlpCallback(
    userId: string,
    amount: Money<'BTC'>,
    nostrParam?: string,
  ): Promise<LNURLPayResult | LNURLError> {
    if (
      amount.lessThan(this.minSendable) ||
      amount.greaterThan(this.maxSendable)
    ) {
      return {
        status: 'ERROR',
        reason: `Amount out of range. Min: ${this.minSendable.toNumber('sat')} sats, Max: ${this.maxSendable.toNumber('sat').toLocaleString()} sats.`,
      };
    }

    let zapRequest: ValidatedZapRequest | undefined;
    if (nostrParam) {
      const result = parseAndValidateZapRequest(
        nostrParam,
        amount.toNumber('msat'),
      );
      if ('error' in result) {
        return { status: 'ERROR', reason: result.error };
      }
      zapRequest = result;
    }

    try {
      const user = await this.userRepository.get(userId);

      if (!user) {
        return {
          status: 'ERROR',
          reason: 'not found',
        };
      }

      const userDefaultAccountRepository = new ReadUserDefaultAccountRepository(
        this.db,
        this.queryClient,
        getSparkWalletMnemonic,
        '/tmp/.spark-data',
      );

      // For external lightning address requests, we only support BTC to avoid exchange rate mismatches.
      // However, if bypassAmountValidation is enabled, we can use the user's default currency
      // and perform exchange rate conversion to create an invoice in their preferred currency.
      const account = await userDefaultAccountRepository.getDefaultAccount(
        userId,
        this.bypassAmountValidation ? undefined : 'BTC',
      );

      let amountToReceive = amount as Money;
      if (amount.currency !== account.currency) {
        const rate = await this.exchangeRateService.getRate(
          `${amount.currency}-${account.currency}`,
        );
        amountToReceive = amount.convert(account.currency, rate) as Money;
      }

      if (account.type === 'cashu') {
        const lightningQuote = await getLightningQuote({
          wallet: account.wallet,
          amount: amountToReceive,
          xPub: user.cashuLockingXpub,
        });

        const cashuReceiveQuoteService = new CashuReceiveQuoteServiceServer(
          new CashuReceiveQuoteRepositoryServer(this.db),
        );

        const created = await cashuReceiveQuoteService.createReceiveQuote({
          userId,
          userEncryptionPublicKey: user.encryptionPublicKey,
          account,
          receiveType: 'LIGHTNING',
          lightningQuote,
        });

        if (zapRequest) {
          await this.persistZapRequest({
            quoteId: created.id,
            quoteType: 'cashu',
            paymentHash: lightningQuote.paymentHash,
            backendId: lightningQuote.mintQuote.quote,
            mintUrl: account.mintUrl,
            zapRequest,
          });
        }

        const encryptedQuoteData = this.encryptLnurlVerifyQuoteData({
          type: 'cashu',
          quoteId: lightningQuote.mintQuote.quote,
          mintUrl: account.mintUrl,
          receiveQuoteId: created.id,
        });

        return {
          pr: lightningQuote.mintQuote.request,
          verify: `${this.baseUrl}/api/lnurlp/verify/${encryptedQuoteData}`,
          routes: [],
        };
      }

      const sparkReceiveQuoteService = new SparkReceiveQuoteServiceServer(
        new SparkReceiveQuoteRepositoryServer(this.db),
      );

      const lightningQuote = await sparkReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount: amountToReceive,
        receiverIdentityPubkey: user.sparkIdentityPublicKey,
      });

      const created = await sparkReceiveQuoteService.createReceiveQuote({
        userId,
        userEncryptionPublicKey: user.encryptionPublicKey,
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
      });

      if (zapRequest) {
        await this.persistZapRequest({
          quoteId: created.id,
          quoteType: 'spark',
          paymentHash: lightningQuote.invoice.paymentHash,
          backendId: lightningQuote.id,
          zapRequest,
        });
      }

      const encryptedQuoteData = this.encryptLnurlVerifyQuoteData({
        type: 'spark',
        quoteId: lightningQuote.id,
        receiveQuoteId: created.id,
      });

      return {
        pr: lightningQuote.invoice.paymentRequest,
        verify: `${this.baseUrl}/api/lnurlp/verify/${encryptedQuoteData}`,
        routes: [],
      };
    } catch (error) {
      console.error('Error processing LNURL-pay callback', { cause: error });
      return {
        status: 'ERROR',
        reason: 'Internal server error',
      };
    }
  }

  private async persistZapRequest({
    quoteId,
    quoteType,
    paymentHash,
    backendId,
    mintUrl,
    zapRequest,
  }: {
    quoteId: string;
    quoteType: ZapQuoteType;
    paymentHash: string;
    backendId: string;
    mintUrl?: string;
    zapRequest: ValidatedZapRequest;
  }): Promise<void> {
    try {
      const repo = new NostrZapRequestRepositoryServer(this.db);
      await repo.create({
        quoteId,
        quoteType,
        paymentHash,
        backendId,
        mintUrl,
        zapRequestJson: zapRequest.rawJson,
        relays: zapRequest.relays,
      });
    } catch (error) {
      console.error('Failed to persist zap request', { cause: error });
    }
  }

  /**
   * Checks if an LNURL-pay request has been settled.
   * @param encryptedQuoteData the encrypted data containing quote info
   * @return the lnurl-verify result or error
   */
  async handleLnurlpVerify(
    encryptedQuoteData: string,
  ): Promise<LNURLVerifyResult | LNURLError> {
    try {
      const payload = this.decryptLnurlVerifyQuoteData(encryptedQuoteData);

      const status =
        payload.type === 'cashu'
          ? await this.checkCashuQuoteStatus(payload.quoteId, payload.mintUrl)
          : await this.checkSparkQuoteStatus(payload.quoteId);

      if (status.settled && payload.receiveQuoteId) {
        const publishBudgetMs = 5000;
        const receiveQuoteId = payload.receiveQuoteId;
        const quoteType = payload.type;
        await Promise.race([
          this.tryPublishZapReceipt({
            receiveQuoteId,
            quoteType,
            prefetched: status,
          }),
          new Promise<void>((resolve) =>
            setTimeout(resolve, publishBudgetMs),
          ),
        ]).catch((err) => {
          console.error('Zap receipt publish (verify piggyback) failed', {
            cause: err,
          });
        });
      }

      return {
        status: 'OK',
        settled: status.settled,
        preimage: status.preimage ?? (status.settled ? '' : null),
        pr: status.pr,
      };
    } catch (error) {
      console.error('Error processing LNURL-pay verify', { cause: error });
      const errorMessage =
        error instanceof NotFoundError ? 'Not found' : 'Internal server error';
      return {
        status: 'ERROR',
        reason: errorMessage,
      };
    }
  }

  /**
   * Checks the status of a quote on its source backend (cashu mint or Spark).
   * Used by both the verify endpoint and the zap-receipt publish cron, which
   * has only the backend identifier and never sees the verify URL payload.
   */
  async checkQuoteStatus(params: {
    quoteType: ZapQuoteType;
    backendId: string;
    mintUrl?: string;
  }): Promise<QuoteStatusResult> {
    if (params.quoteType === 'cashu') {
      if (!params.mintUrl) {
        throw new Error('mintUrl is required for cashu quote status check');
      }
      return this.checkCashuQuoteStatus(params.backendId, params.mintUrl);
    }
    return this.checkSparkQuoteStatus(params.backendId);
  }

  private async checkCashuQuoteStatus(
    mintQuoteId: string,
    mintUrl: string,
  ): Promise<QuoteStatusResult> {
    const wallet = getCashuWallet(mintUrl);
    const mintQuote = await wallet.checkMintQuoteBolt11(mintQuoteId);
    const settled = ['PAID', 'ISSUED'].includes(mintQuote.state);
    return {
      settled,
      pr: mintQuote.request,
      paidAtUnixSec: settled ? Math.floor(Date.now() / 1000) : undefined,
    };
  }

  private async checkSparkQuoteStatus(
    receiveRequestId: string,
  ): Promise<QuoteStatusResult> {
    const wallet = await this.queryClient.fetchQuery(
      sparkWalletQueryOptions({
        network: 'MAINNET',
        mnemonic: sparkMnemonic,
        storageDir: '/tmp/.spark-data',
      }),
    );

    const receiveRequest = await measureOperation(
      'BreezSdk.getLightningReceiveRequest',
      () => wallet.getLightningReceiveRequest({ requestId: receiveRequestId }),
      { receiveRequestId },
    );

    if (!receiveRequest) {
      throw new NotFoundError(
        `Spark lightning receive request ${receiveRequestId} not found`,
      );
    }

    const settled = receiveRequest.status === 'transferCompleted';

    return {
      settled,
      pr: receiveRequest.invoice,
      preimage: receiveRequest.paymentPreimage,
      paidAtUnixSec: settled ? receiveRequest.updatedAt : undefined,
    };
  }

  /**
   * Attempts to publish a kind:9735 zap receipt for a paid invoice. Idempotent:
   * does nothing if the row was already marked published. Captures
   * paid_at_unix_sec on first observation so cron retries produce the
   * same event_id.
   *
   * Called from both the verify endpoint (after determining settled=true) and
   * the cron route. The optional `prefetched` lets verify pass status it
   * already fetched, avoiding a duplicate backend call.
   */
  async tryPublishZapReceipt(params: {
    receiveQuoteId: string;
    quoteType: ZapQuoteType;
    prefetched?: QuoteStatusResult;
  }): Promise<PublishOutcome> {
    const repo = new NostrZapRequestRepositoryServer(this.db);
    const row = await repo.findByQuote(params.receiveQuoteId, params.quoteType);

    if (!row || row.publishedAt) {
      return { status: 'skipped' };
    }

    return this.publishForRow(row, repo, params.prefetched);
  }

  /**
   * Publishes a zap receipt for a known nostr_zap_requests row. Used by the
   * cron route, which iterates rows directly.
   */
  async publishZapReceiptForRow(
    row: NostrZapRequestRow,
  ): Promise<PublishOutcome> {
    const repo = new NostrZapRequestRepositoryServer(this.db);
    if (row.publishedAt) {
      return { status: 'skipped' };
    }
    return this.publishForRow(row, repo);
  }

  private async publishForRow(
    row: NostrZapRequestRow,
    repo: NostrZapRequestRepositoryServer,
    prefetched?: QuoteStatusResult,
  ): Promise<PublishOutcome> {
    let status = prefetched;
    if (!status) {
      try {
        status = await this.checkQuoteStatus({
          quoteType: row.quoteType,
          backendId: row.backendId,
          mintUrl: row.mintUrl ?? undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await repo.markFailedAttempt(row.id, `status check failed: ${message}`);
        return { status: 'failed' };
      }
    }

    if (!status.settled) {
      return { status: 'skipped' };
    }

    const paidAtUnixSec = row.paidAtUnixSec ?? status.paidAtUnixSec;
    if (!paidAtUnixSec) {
      return { status: 'skipped' };
    }
    if (row.paidAtUnixSec === null) {
      await repo.setPaidAt(row.id, paidAtUnixSec);
    }

    const validationResult = validateDecodedZapRequest(row.zapRequestJson, 0, {
      skipAmountCheck: true,
    });
    if ('error' in validationResult) {
      await repo.markFailedAttempt(
        row.id,
        `stored zap request failed re-validation: ${validationResult.error}`,
      );
      return { status: 'failed' };
    }
    const zapRequest = validationResult;

    try {
      const template = buildZapReceiptTemplate({
        zapRequest,
        bolt11: status.pr,
        paidAtUnixSec,
        preimage: status.preimage,
      });
      const signed = finalizeEvent(template, getServerNostrSecret());
      const publishResult = await publishZapReceipt(signed, row.relays);

      if (publishResult.ok) {
        await repo.markPublished(row.id, new Date());
        return { status: 'published', relays: publishResult.accepted };
      }

      const errorSummary = publishResult.rejected
        .map((r) => `${r.relay}: ${r.reason}`)
        .join('; ');
      await repo.markFailedAttempt(
        row.id,
        errorSummary || 'no relays accepted',
      );
      return { status: 'failed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repo.markFailedAttempt(row.id, message);
      return { status: 'failed' };
    }
  }

  private encryptLnurlVerifyQuoteData(payload: LnurlVerifyQuoteData): string {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = encryptXChaCha20Poly1305(data, encryptionKeyBytes);
    return base64url.encode(encrypted);
  }

  private decryptLnurlVerifyQuoteData(
    encryptedQuoteData: string,
  ): LnurlVerifyQuoteData {
    const encrypted = base64url.decode(encryptedQuoteData);
    const decrypted = decryptXChaCha20Poly1305(encrypted, encryptionKeyBytes);
    return LnurlVerifyQuoteDataSchema.parse(
      JSON.parse(new TextDecoder().decode(decrypted)),
    );
  }
}
