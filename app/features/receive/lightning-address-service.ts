import type { Cache } from '@agicash/core/interfaces/cache';
import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types';
import { hexToBytes } from '@noble/hashes/utils';
import { base64url } from '@scure/base';
import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { queryClientAsCache } from '~/lib/cache-adapter';
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
  z.object({ type: z.literal('spark'), quoteId: z.string() }),
  z.object({
    type: z.literal('cashu'),
    quoteId: z.string(),
    mintUrl: z.string(),
  }),
]);

type LnurlVerifyQuoteData = z.infer<typeof LnurlVerifyQuoteDataSchema>;

export class LightningAddressService {
  private baseUrl: string;
  private db: AgicashDb;
  private userRepository: ReadUserRepository;
  private minSendable: Money<'BTC'>;
  private maxSendable: Money<'BTC'>;
  private exchangeRateService: ExchangeRateService;
  private queryClient: QueryClient;
  private cache: Cache;
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
    this.cache = queryClientAsCache(queryClient);
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
   * @returns the bolt11 invoice from the receive quote and the verify callback url.
   */
  async handleLnurlpCallback(
    userId: string,
    amount: Money<'BTC'>,
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
        this.cache,
        getSparkWalletMnemonic,
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

        await cashuReceiveQuoteService.createReceiveQuote({
          userId,
          userEncryptionPublicKey: user.encryptionPublicKey,
          account,
          receiveType: 'LIGHTNING',
          lightningQuote,
        });

        const encryptedQuoteData = this.encryptLnurlVerifyQuoteData({
          type: 'cashu',
          quoteId: lightningQuote.mintQuote.quote,
          mintUrl: account.mintUrl,
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

      await sparkReceiveQuoteService.createReceiveQuote({
        userId,
        userEncryptionPublicKey: user.encryptionPublicKey,
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
      });

      const encryptedQuoteData = this.encryptLnurlVerifyQuoteData({
        type: 'spark',
        quoteId: lightningQuote.id,
      });

      return {
        pr: lightningQuote.invoice.encodedInvoice,
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

      if (payload.type === 'cashu') {
        return await this.handleCashuLnurlpVerify(
          payload.quoteId,
          payload.mintUrl,
        );
      }
      return await this.handleSparkLnurlpVerify(payload.quoteId);
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

  private async handleCashuLnurlpVerify(
    mintQuoteId: string,
    mintUrl: string,
  ): Promise<LNURLVerifyResult> {
    const wallet = getCashuWallet(mintUrl);
    const mintQuote = await wallet.checkMintQuote(mintQuoteId);

    if (['PAID', 'ISSUED'].includes(mintQuote.state)) {
      return {
        status: 'OK',
        settled: true,
        preimage: '',
        pr: mintQuote.request,
      };
    }

    return {
      status: 'OK',
      settled: false,
      preimage: null,
      pr: mintQuote.request,
    };
  }

  private async handleSparkLnurlpVerify(
    receiveRequestId: string,
  ): Promise<LNURLVerifyResult> {
    const wallet = await this.queryClient.fetchQuery(
      sparkWalletQueryOptions({ network: 'MAINNET', mnemonic: sparkMnemonic }),
    );

    const receiveRequest = await measureOperation(
      'SparkWallet.getLightningReceiveRequest',
      () => wallet.getLightningReceiveRequest(receiveRequestId),
      { receiveRequestId },
    );

    if (!receiveRequest) {
      throw new NotFoundError(
        `Spark lightning receive request ${receiveRequestId} not found`,
      );
    }

    const settled =
      receiveRequest.status ===
      LightningReceiveRequestStatus.TRANSFER_COMPLETED;

    return {
      status: 'OK',
      settled,
      preimage: receiveRequest.paymentPreimage ?? null,
      pr: receiveRequest.invoice.encodedInvoice,
    };
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
