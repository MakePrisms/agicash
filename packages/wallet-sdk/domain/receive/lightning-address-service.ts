import { getCashuWallet } from '@agicash/cashu';
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '@agicash/lnurl';
import { Money } from '@agicash/money';
import {
  decryptXChaCha20Poly1305,
  encryptXChaCha20Poly1305,
} from '@agicash/utils';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { base64url } from '@scure/base';
import { z } from 'zod/mini';
import type { AgicashDb } from '../../db/database';
import type { SparkNetwork } from '../../db/json-models/spark-account-details-db-data';
import { NotFoundError } from '../../lib/error';
import { type SparkWalletConfig, getSparkWallet } from '../../lib/spark/wallet';
import { ExchangeRateService } from '../exchange-rate';
import {
  ReadUserDefaultAccountRepository,
  ReadUserRepository,
} from '../user/user-repository';
import { getLightningQuote } from './cashu-receive-quote-core';
import { CashuReceiveQuoteRepositoryServer } from './cashu-receive-quote-repository.server';
import { CashuReceiveQuoteServiceServer } from './cashu-receive-quote-service.server';
import { SparkReceiveQuoteRepositoryServer } from './spark-receive-quote-repository.server';
import { SparkReceiveQuoteServiceServer } from './spark-receive-quote-service.server';

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

export type LightningAddressServiceConfig = {
  db: AgicashDb;
  spark: {
    apiKey: string;
    network: SparkNetwork;
    mnemonic: string;
    storageDir: string;
  };
  /** Hex. `hexToBytes` runs in the constructor. */
  quoteEncryptionKey: string;
};

export type LightningAddressDeps = {
  userRepository?: Pick<ReadUserRepository, 'get' | 'getByUsername'>;
  exchangeRateService?: Pick<ExchangeRateService, 'getRate'>;
  createDefaultAccountRepository?: (
    db: AgicashDb,
    getSparkWalletMnemonic: () => Promise<string>,
    sparkConfig: SparkWalletConfig,
  ) => Pick<ReadUserDefaultAccountRepository, 'getDefaultAccount'>;
  getCashuLightningQuote?: typeof getLightningQuote;
  createCashuReceiveQuote?: (
    params: Parameters<CashuReceiveQuoteServiceServer['createReceiveQuote']>[0],
  ) => Promise<unknown>;
  getSparkLightningQuote?: (
    params: Parameters<SparkReceiveQuoteServiceServer['getLightningQuote']>[0],
  ) => ReturnType<SparkReceiveQuoteServiceServer['getLightningQuote']>;
  createSparkReceiveQuote?: (
    params: Parameters<SparkReceiveQuoteServiceServer['createReceiveQuote']>[0],
  ) => Promise<unknown>;
  getCashuWallet?: typeof getCashuWallet;
  getSparkWallet?: typeof getSparkWallet;
};

const defaultCreateDefaultAccountRepository = (
  db: AgicashDb,
  getSparkWalletMnemonic: () => Promise<string>,
  sparkConfig: SparkWalletConfig,
) =>
  new ReadUserDefaultAccountRepository(db, getSparkWalletMnemonic, sparkConfig);

export class LightningAddressService {
  private db: AgicashDb;
  private userRepository: Pick<ReadUserRepository, 'get' | 'getByUsername'>;
  private minSendable: Money<'BTC'>;
  private maxSendable: Money<'BTC'>;
  private exchangeRateService: Pick<ExchangeRateService, 'getRate'>;
  private apiKey: string;
  private network: SparkNetwork;
  private mnemonic: string;
  private storageDir: string;
  private encryptionKeyBytes: Uint8Array;
  private deps: LightningAddressDeps;

  constructor(
    config: LightningAddressServiceConfig,
    deps?: LightningAddressDeps,
  ) {
    this.deps = deps ?? {};
    this.exchangeRateService =
      this.deps.exchangeRateService ?? new ExchangeRateService();
    this.db = config.db;
    this.userRepository =
      this.deps.userRepository ?? new ReadUserRepository(config.db);
    this.apiKey = config.spark.apiKey;
    this.network = config.spark.network;
    this.mnemonic = config.spark.mnemonic;
    this.storageDir = config.spark.storageDir;
    this.encryptionKeyBytes = hexToBytes(config.quoteEncryptionKey);
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
  async handleLud16Request(params: {
    username: string;
    baseUrl: string;
  }): Promise<LNURLPayParams | LNURLError> {
    const { username, baseUrl } = params;
    try {
      const user = await this.userRepository.getByUsername(username);

      if (!user) {
        return {
          status: 'ERROR',
          reason: 'not found',
        };
      }

      const callback = `${baseUrl}/api/lnurlp/callback/${user.id}`;
      const metadata = this.buildLnurlpMetadata(user.username, baseUrl);

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
  async handleLnurlpCallback(params: {
    userId: string;
    amount: Money<'BTC'>;
    baseUrl: string;
    /**
     * A client can flag that they will not validate the invoice amount.
     * This is useful for agicash <-> agicash payments so that the receiver can receive into their default currency
     * and we do not have to worry about exchange rate mismatches.
     */
    bypassAmountValidation?: boolean;
  }): Promise<LNURLPayResult | LNURLError> {
    const { userId, amount, baseUrl } = params;
    const bypassAmountValidation = params.bypassAmountValidation ?? false;
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

      const userDefaultAccountRepository = (
        this.deps.createDefaultAccountRepository ??
        defaultCreateDefaultAccountRepository
      )(this.db, () => Promise.resolve(this.mnemonic), {
        storageDir: this.storageDir,
        apiKey: this.apiKey,
      });

      // For external lightning address requests, we only support BTC to avoid exchange rate mismatches.
      // However, if bypassAmountValidation is enabled, we can use the user's default currency
      // and perform exchange rate conversion to create an invoice in their preferred currency.
      const account = await userDefaultAccountRepository.getDefaultAccount(
        userId,
        bypassAmountValidation ? undefined : 'BTC',
      );

      let amountToReceive = amount as Money;
      if (amount.currency !== account.currency) {
        const rate = await this.exchangeRateService.getRate(
          `${amount.currency}-${account.currency}`,
        );
        amountToReceive = amount.convert(account.currency, rate) as Money;
      }

      if (account.type === 'cashu') {
        // cashu does not support setting the description_hash of an invoice.
        // Read more here: https://github.com/cashubtc/nuts/issues/110#issuecomment-2062898765
        const lightningQuote = await (
          this.deps.getCashuLightningQuote ?? getLightningQuote
        )({
          wallet: account.wallet,
          amount: amountToReceive,
          xPub: user.cashuLockingXpub,
        });

        const cashuReceiveQuoteService = this.deps.createCashuReceiveQuote
          ? { createReceiveQuote: this.deps.createCashuReceiveQuote }
          : new CashuReceiveQuoteServiceServer(
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
          verify: `${baseUrl}/api/lnurlp/verify/${encryptedQuoteData}`,
          routes: [],
        };
      }

      const { getSparkLightningQuote, createSparkReceiveQuote } = this.deps;
      const sparkReceiveQuoteService =
        getSparkLightningQuote && createSparkReceiveQuote
          ? {
              getLightningQuote: getSparkLightningQuote,
              createReceiveQuote: createSparkReceiveQuote,
            }
          : new SparkReceiveQuoteServiceServer(
              new SparkReceiveQuoteRepositoryServer(this.db),
            );

      const metadata = this.buildLnurlpMetadata(user.username, baseUrl);
      const descriptionHash = bytesToHex(
        sha256(new TextEncoder().encode(metadata)),
      );

      const lightningQuote = await sparkReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount: amountToReceive,
        receiverIdentityPublicKey: user.sparkIdentityPublicKey,
        descriptionHash,
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
        pr: lightningQuote.invoice.paymentRequest,
        verify: `${baseUrl}/api/lnurlp/verify/${encryptedQuoteData}`,
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
  async handleLnurlpVerify(params: {
    encryptedQuoteData: string;
  }): Promise<LNURLVerifyResult | LNURLError> {
    const { encryptedQuoteData } = params;
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
    const wallet = (this.deps.getCashuWallet ?? getCashuWallet)(mintUrl);
    const mintQuote = await wallet.checkMintQuoteBolt11(mintQuoteId);

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
    const wallet = await (this.deps.getSparkWallet ?? getSparkWallet)({
      network: this.network,
      mnemonic: this.mnemonic,
      storageDir: this.storageDir,
      apiKey: this.apiKey,
    });

    const receiveRequest = await wallet.getLightningReceiveRequest({
      requestId: receiveRequestId,
    });

    if (!receiveRequest) {
      throw new NotFoundError(
        `Spark lightning receive request ${receiveRequestId} not found`,
      );
    }

    const settled = receiveRequest.status === 'transferCompleted';

    return {
      status: 'OK',
      settled,
      preimage: receiveRequest.paymentPreimage ?? null,
      pr: receiveRequest.invoice,
    };
  }

  private buildLnurlpMetadata(username: string, baseUrl: string): string {
    const address = `${username}@${new URL(baseUrl).host}`;
    return JSON.stringify([
      ['text/plain', `Pay to ${address}`],
      ['text/identifier', address],
    ]);
  }

  private encryptLnurlVerifyQuoteData(payload: LnurlVerifyQuoteData): string {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = encryptXChaCha20Poly1305(data, this.encryptionKeyBytes);
    return base64url.encode(encrypted);
  }

  private decryptLnurlVerifyQuoteData(
    encryptedQuoteData: string,
  ): LnurlVerifyQuoteData {
    const encrypted = base64url.decode(encryptedQuoteData);
    const decrypted = decryptXChaCha20Poly1305(
      encrypted,
      this.encryptionKeyBytes,
    );
    return LnurlVerifyQuoteDataSchema.parse(
      JSON.parse(new TextDecoder().decode(decrypted)),
    );
  }
}
