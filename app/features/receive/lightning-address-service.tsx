import { SparkWallet } from '@buildonspark/spark-sdk';
import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types';
import { QueryClient } from '@tanstack/react-query';
import { getCashuWallet } from '~/lib/cashu';
import { ExchangeRateService } from '~/lib/exchange-rate/exchange-rate-service';
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '~/lib/lnurl/types';
import { Money } from '~/lib/money';
import { AccountRepository } from '../accounts/account-repository';
import type { AgicashDb } from '../agicash-db/database';
import type { CashuCryptography } from '../shared/cashu';
import { encryptToPublicKey, type useEncryption } from '../shared/encryption';
import { getSparkWalletFromCache } from '../shared/spark';
import { UserRepository } from '../user/user-repository';
import { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import { SparkReceiveLightningService } from './spark-receive-lightning-service';

const fakeEncryption = {
  encrypt: async <T = unknown>(_data: T): Promise<string> => {
    throw new Error('encrypt is not supported in this context');
  },
  decrypt: async <T = unknown>(data: string): Promise<T> => data as T,
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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    },
  },
});

/**
 * Initializes the singleton Spark wallet for server-side receives.
 * This is called once when the module is first loaded.
 */
async function initializeServerSparkWallet() {
  try {
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
  private encryption: ReturnType<typeof useEncryption> = fakeEncryption;
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
    // Use the singleton server query client
    this.accountRepository = new AccountRepository(
      db,
      {
        encrypt: this.encryption.encrypt,
        decrypt: this.encryption.decrypt,
      },
      queryClient,
      undefined,
      // We use the same mnemonic for all receives because we are receiving on
      // behalf of the user. If we use a different mnemonic, then we will not be
      // able to lookup the receive request by invoice id.
      () => Promise.resolve(sparkMnemonic),
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
          verify: `${this.baseUrl}/api/lnurlp/verify/${quote.id}`,
          routes: [],
        };
      }

      if (account.type === 'spark') {
        if (!user.sparkPublicKey) {
          return {
            status: 'ERROR',
            reason: 'Internal server error',
          };
        }

        const sparkReceiveLightningService = new SparkReceiveLightningService(
          (network) => getSparkWalletFromCache(queryClient, network),
        );
        const sparkQuote = await sparkReceiveLightningService.getLightningQuote(
          {
            account,
            amount: amountToReceive,
            receiverIdentityPubkey: user.sparkPublicKey,
          },
        );

        return {
          pr: sparkQuote.paymentRequest,
          verify: `${this.baseUrl}/api/lnurlp/verify/spark:${account.id}:${sparkQuote.id}`,
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
   * Checks if the payment of a receive quote has been settled.
   * @param receiveQuoteId the id of the receive quote to check. For Spark invoices, use format "spark:{accountId}:{invoiceId}"
   * @return the lnurl-verify result
   */
  // TODO: update the verify route to not just be for cashu.
  async handleLnurlpVerify(
    receiveQuoteId: string,
  ): Promise<LNURLVerifyResult | LNURLError> {
    try {
      if (receiveQuoteId.startsWith('spark:')) {
        const parts = receiveQuoteId.slice('spark:'.length).split(':');
        if (parts.length < 2) {
          return {
            status: 'ERROR',
            reason: 'Invalid Spark invoice ID format',
          };
        }
        const accountId = parts[0];
        const invoiceId = parts.slice(1).join(':');
        return await this.handleSparkLnurlpVerify(accountId, invoiceId);
      }

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

      if (quoteState.state === 'PAID') {
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
      console.error('Error processing LNURL-pay verify', { cause: error });
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
  private async handleSparkLnurlpVerify(
    accountId: string,
    invoiceId: string,
  ): Promise<LNURLVerifyResult | LNURLError> {
    try {
      const account = await this.accountRepository.get(accountId);

      if (account.type !== 'spark') {
        return {
          status: 'ERROR',
          reason: 'Invalid account type',
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

      const receiveRequest = await wallet.getLightningReceiveRequest(invoiceId);
      if (!receiveRequest) {
        return {
          status: 'ERROR',
          reason: 'Payment not found',
        };
      }
      const status = receiveRequest?.status;

      if (status === LightningReceiveRequestStatus.TRANSFER_COMPLETED) {
        return {
          status: 'OK',
          settled: true,
          preimage: receiveRequest?.paymentPreimage ?? null,
          pr: receiveRequest?.invoice.encodedInvoice ?? '',
        };
      }

      if (status === LightningReceiveRequestStatus.TRANSFER_FAILED) {
        return {
          status: 'ERROR',
          reason: 'Payment failed',
        };
      }

      return {
        status: 'OK',
        settled: false,
        preimage: null,
        pr: receiveRequest?.invoice.encodedInvoice ?? '',
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
