import { SparkWallet } from '@buildonspark/spark-sdk';
import { getCashuWallet } from '~/lib/cashu';
import { ExchangeRateService } from '~/lib/exchange-rate/exchange-rate-service';
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '~/lib/lnurl/types';
import { Money } from '~/lib/money';
import { getQueryClient } from '~/query-client';
import { AccountRepository } from '../accounts/account-repository';
import type { AgicashDb } from '../agicash-db/database';
import type { CashuCryptography } from '../shared/cashu';
import {
  type Encryption,
  encryptBatchToPublicKey,
  encryptToPublicKey,
} from '../shared/encryption';
import { UserRepository } from '../user/user-repository';
import { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import { SparkLightningReceiveService } from './spark-lightning-receive-service';
import { getSparkWalletFromCache } from '../shared/spark';

const fakeEncryption: Encryption = {
  encrypt: async <T = unknown>(_data: T): Promise<string> => {
    throw new Error('encrypt is not supported in this context');
  },
  decrypt: async <T = unknown>(data: string): Promise<T> => data as T,
  encryptBatch: async <T extends readonly unknown[] = unknown[]>(
    _data: T,
  ): Promise<string[]> => {
    throw new Error('encryptBatch is not supported in this context');
  },
  decryptBatch: async <T extends readonly unknown[] = unknown[]>(
    _data: readonly [...{ [K in keyof T]: string }],
  ): Promise<T> => _data as T,
};

const fakeCryptography: CashuCryptography = {
  getSeed: (): Promise<Uint8Array> => {
    throw new Error('getSeed is not supported in this context');
  },
  getXpub: (): Promise<string> => {
    throw new Error('getXpub is not supported in this context');
  },
  getPrivateKey: (): Promise<string> => {
    throw new Error('getPrivateKey is not supported in this context');
  },
};

const sparkMnemonic = process.env.LNURL_SERVER_SPARK_MNEMONIC || '';
if (!sparkMnemonic) {
  throw new Error('LNURL_SERVER_SPARK_MNEMONIC is not set');
}

const queryClient = getQueryClient();

/**
 * Initializes the singleton Spark wallet for server-side receives.
 * This should only be called once when the module is first loaded.
 */
async function initializeServerSparkWallet() {
  try {
    // TODO: see about how we want to handle networks
    const existingWallet = getSparkWalletFromCache(queryClient, 'MAINNET');
    if (existingWallet) {
      return;
    }

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: sparkMnemonic,
      options: { network: 'MAINNET' },
    });

    queryClient.setQueryData(['spark-wallet', 'MAINNET'], wallet);
    console.log('Initialized server-side Spark wallet singleton');
  } catch (error) {
    console.error('Failed to initialize server-side Spark wallet', error);
    throw error;
  }
}

initializeServerSparkWallet();

export class LightningAddressService {
  private baseUrl: string;
  private db: AgicashDb;
  private userRepository: UserRepository;
  private accountRepository: AccountRepository;
  private minSendable: Money<'BTC'>;
  private maxSendable: Money<'BTC'>;
  private cryptography: CashuCryptography = fakeCryptography;
  private encryption: Encryption = fakeEncryption;
  private exchangeRateService: ExchangeRateService;
  /**
   * A client can flag that they will not validate the invoice amount.
   * This is useful for agicash <-> agicash payments so that the receiver can receive into their default currency
   * and we do not have to worry about exchange rate mismatches.
   */
  private bypassAmountValidation: boolean;

  constructor(
    request: Request,
    db: AgicashDb,
    options: {
      bypassAmountValidation?: boolean;
    } = {},
  ) {
    this.exchangeRateService = new ExchangeRateService();
    this.db = db;
    this.accountRepository = new AccountRepository(
      db,
      {
        encrypt: this.encryption.encrypt,
        decrypt: this.encryption.decrypt,
        encryptBatch: this.encryption.encryptBatch,
        decryptBatch: this.encryption.decryptBatch,
      },
      queryClient,
      undefined,
    );
    this.userRepository = new UserRepository(
      db,
      this.encryption,
      this.accountRepository,
    );
    this.bypassAmountValidation = options.bypassAmountValidation ?? false;
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

      // For external lightning address requests, we only support BTC to avoid exchange rate mismatches.
      // However, if bypassAmountValidation is enabled, we can use the user's default currency
      // and perform exchange rate conversion to create an invoice in their preferred currency.
      const account = await this.userRepository.getDefaultAccount(
        userId,
        this.bypassAmountValidation ? undefined : 'BTC',
      );

      let amountToReceive: Money = amount as Money;
      if (amount.currency !== account.currency) {
        const rate = await this.exchangeRateService.getRate(
          `${amount.currency}-${account.currency}`,
        );
        amountToReceive = amount.convert(account.currency, rate) as Money;
      }

      if (account.type === 'cashu') {
        const cashuReceiveQuoteService = new CashuReceiveQuoteService(
          {
            ...this.cryptography,
            getXpub: () => Promise.resolve(user.cashuLockingXpub),
          },
          new CashuReceiveQuoteRepository(
            this.db,
            {
              encrypt: async (data) =>
                encryptToPublicKey(data, user.encryptionPublicKey),
              decrypt: this.encryption.decrypt,
              encryptBatch: async (data) =>
                encryptBatchToPublicKey(data, user.encryptionPublicKey),
              decryptBatch: this.encryption.decryptBatch,
            },
            this.accountRepository,
          ),
        );

        const lightningQuote = await cashuReceiveQuoteService.getLightningQuote(
          {
            account,
            amount: amountToReceive,
          },
        );

        const quote = await cashuReceiveQuoteService.createReceiveQuote({
          userId,
          account,
          receiveType: 'LIGHTNING',
          receiveQuote: lightningQuote,
        });

        return {
          pr: quote.paymentRequest,
          verify: `${this.baseUrl}/api/lnurlp/verify/cashu/${quote.id}`,
          routes: [],
        };
      }

      if (account.type === 'spark') {
        const sparkWallet = getSparkWalletFromCache(
          queryClient,
          account.network,
        );
        if (!sparkWallet) {
          console.error(
            'Spark wallet not initialized for network',
            account.network,
          );
          return {
            status: 'ERROR',
            reason: 'Internal server error',
          };
        }

        const sparkReceiveLightningService = new SparkLightningReceiveService(
          sparkWallet,
        );
        const request = await sparkReceiveLightningService.create({
          amount: amountToReceive,
          receiverIdentityPubkey: user.sparkPublicKey,
        });

        return {
          pr: request.paymentRequest,
          verify: `${this.baseUrl}/api/lnurlp/verify/spark/${account.id}/${request.id}`,
          routes: [],
        };
      }

      throw new Error(`Account type not supported. Got ${account.type}`);
    } catch (error) {
      console.error('Error processing LNURL-pay callback', { cause: error });
      return {
        status: 'ERROR',
        reason: 'Internal server error',
      };
    }
  }

  /**
   * Checks if the payment of a Cashu receive quote has been settled.
   * @param receiveQuoteId the id of the Cashu receive quote to check
   * @return the lnurl-verify result
   */
  async handleCashuLnurlpVerify(
    receiveQuoteId: string,
  ): Promise<LNURLVerifyResult | LNURLError> {
    try {
      const cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
        this.db,
        this.encryption,
        this.accountRepository,
      );
      const quote = await cashuReceiveQuoteRepository.get(receiveQuoteId);

      if (!quote) {
        return {
          status: 'ERROR',
          reason: 'Not found',
        };
      }

      const account = await this.accountRepository.get(quote.accountId);
      if (account.type !== 'cashu') {
        throw new Error(`Account type not supported. Got ${account.type}`);
      }

      const wallet = getCashuWallet(account.mintUrl);
      const quoteState = await wallet.checkMintQuote(quote.quoteId);

      if (['PAID', 'ISSUED'].includes(quoteState.state)) {
        return {
          status: 'OK',
          settled: true,
          preimage: '',
          pr: quote.paymentRequest,
        };
      }

      return {
        status: 'OK',
        settled: false,
        preimage: null,
        pr: quote.paymentRequest,
      };
    } catch (error) {
      console.error('Error processing Cashu LNURL-pay verify', {
        cause: error,
      });
      return {
        status: 'ERROR',
        reason: 'Internal server error',
      };
    }
  }

  /**
   * Checks if a Spark lightning invoice has been settled.
   * @param accountId the Spark account ID
   * @param invoiceId the Spark invoice ID
   * @return the lnurl-verify result
   */
  async handleSparkLnurlpVerify(
    accountId: string,
    invoiceId: string,
  ): Promise<LNURLVerifyResult | LNURLError> {
    try {
      const account = await this.accountRepository.get(accountId);

      if (account.type !== 'spark') {
        return {
          status: 'ERROR',
          reason: 'Internal server error',
        };
      }

      const wallet = getSparkWalletFromCache(queryClient, account.network);
      if (!wallet) {
        console.error(
          'Spark wallet not initialized for network',
          account.network,
        );
        return {
          status: 'ERROR',
          reason: 'Internal server error',
        };
      }

      const receiveService = new SparkLightningReceiveService(wallet);
      const receiveRequest = await receiveService.get(invoiceId);

      if (receiveRequest.state === 'COMPLETED') {
        return {
          status: 'OK',
          settled: true,
          preimage: receiveRequest.preimage ?? null,
          pr: receiveRequest.paymentRequest,
        };
      }

      // TODO: check with Josip if this seems right to return errors based on payment state. Or should
      // failed and expired payments just return as not settled and they will never settle.

      if (receiveRequest.state === 'FAILED') {
        return {
          status: 'ERROR',
          reason: 'Payment failed',
        };
      }

      if (receiveRequest.state === 'EXPIRED') {
        return {
          status: 'ERROR',
          reason: 'Payment expired',
        };
      }

      return {
        status: 'OK',
        settled: false,
        preimage: null,
        pr: receiveRequest.paymentRequest,
      };
    } catch (error) {
      console.error('Error processing Spark LNURL-pay verify', {
        cause: error,
      });
      return {
        status: 'ERROR',
        reason: 'Internal server error',
      };
    }
  }
}
