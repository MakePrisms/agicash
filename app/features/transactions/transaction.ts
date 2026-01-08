import type { Money } from '~/lib/money';
import type {
  LightningCashuReceiveQuoteDetails,
  TokenCashuReceiveQuoteDetails,
} from '../receive/cashu-receive-quote';
import type { CashuTokenSwapDetails } from '../receive/cashu-token-swap';
import type {
  CompletedLightningSparkReceiveQuoteDetails,
  CompletedTokenSparkReceiveQuoteDetails,
  LightningSparkReceiveQuoteDetails,
  TokenSparkReceiveQuoteDetails,
} from '../receive/spark-receive-quote';
import type {
  CashuSendQuoteDetailsBase,
  CompletedCashuSendQuoteDetails,
} from '../send/cashu-send-quote';
import type { CashuSendSwapDetails } from '../send/cashu-send-swap';
import type {
  CompletedSparkSendQuoteDetails,
  SparkSendQuoteDetailsBase,
} from '../send/spark-send-quote';

/**
 * Additional details related to the transaction destination.
 */
export type DestinationDetails =
  | {
      sendType: 'AGICASH_CONTACT';
      /** The ID of the contact that the invoice was fetched from. */
      contactId: string;
    }
  | {
      sendType: 'LN_ADDRESS';
      /** The lightning address that the invoice was fetched from. */
      lnAddress: string;
    };
export type Transaction = {
  /**
   * ID of the transaction.
   */
  id: string;
  /**
   * ID of the user that the transaction belongs to.
   */
  userId: string;
  /**
   * Direction of the transaction.
   */
  direction: 'SEND' | 'RECEIVE';
  /**
   * Type of the transaction.
   */
  type: 'CASHU_LIGHTNING' | 'CASHU_TOKEN' | 'SPARK_LIGHTNING';
  /**
   * State of the transaction.
   * Transaction states are:
   * - DRAFT: The transaction is drafted but might never be initiated and thus completed.
   * - PENDING: The transaction was initiated and is being processed.
   * - COMPLETED: The transaction has been completed. At this point the sender cannot reverse the transaction.
   * - FAILED: The transaction has failed.
   * - REVERSED: The transaction was reversed and money was returned to the account.
   */
  state: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  /**
   * ID of the account that the transaction was sent from or received to.
   * For SEND transactions, it is the account that the transaction was sent from.
   * For RECEIVE transactions, it is the account that the transaction was received to.
   */
  accountId: string;
  /**
   * Amount of the transaction.
   */
  amount: Money;
  /**
   * Transaction details.
   */
  details: object;
  /**
   * ID of the transaction that is reversed by this transaction.
   */
  reversedTransactionId?: string | null;
  /**
   * Whether or not the transaction has been acknowledged by the user.
   *
   * - `null`: There is nothing to acknowledge.
   * - `pending`: The transaction has entered a state where the user should acknowledge it.
   * - `acknowledged`: The transaction has been acknowledged by the user.
   */
  acknowledgmentStatus: null | 'pending' | 'acknowledged';
  /**
   * Date and time the transaction was created in ISO 8601 format.
   */
  createdAt: string;
  /**
   * Date and time the transaction was set to pending in ISO 8601 format.
   */
  pendingAt?: string | null;
  /**
   * Date and time the transaction was completed in ISO 8601 format.
   */
  completedAt?: string | null;
  /**
   * Date and time the transaction failed in ISO 8601 format.
   */
  failedAt?: string | null;
  /**
   * Date and time the transaction was reversed in ISO 8601 format.
   */
  reversedAt?: string | null;
} & (
  | {
      type: 'CASHU_TOKEN';
      direction: 'SEND';
      details: CashuSendSwapDetails;
    }
  | {
      type: 'CASHU_TOKEN';
      direction: 'RECEIVE';
      state: 'DRAFT' | 'PENDING' | 'FAILED';
      details:
        | TokenCashuReceiveQuoteDetails
        | CashuTokenSwapDetails
        | TokenSparkReceiveQuoteDetails;
    }
  | {
      type: 'CASHU_TOKEN';
      direction: 'RECEIVE';
      state: 'COMPLETED';
      details:
        | TokenCashuReceiveQuoteDetails
        | CashuTokenSwapDetails
        | CompletedTokenSparkReceiveQuoteDetails;
    }
  | {
      type: 'CASHU_LIGHTNING';
      direction: 'SEND';
      state: 'PENDING' | 'FAILED';
      details: CashuSendQuoteDetailsBase;
    }
  | {
      type: 'CASHU_LIGHTNING';
      direction: 'SEND';
      state: 'COMPLETED';
      details: CompletedCashuSendQuoteDetails;
    }
  | {
      type: 'CASHU_LIGHTNING';
      direction: 'RECEIVE';
      details: LightningCashuReceiveQuoteDetails;
    }
  | {
      type: 'SPARK_LIGHTNING';
      direction: 'RECEIVE';
      state: 'DRAFT' | 'PENDING' | 'FAILED';
      details: LightningSparkReceiveQuoteDetails;
    }
  | {
      type: 'SPARK_LIGHTNING';
      direction: 'RECEIVE';
      state: 'COMPLETED';
      details: CompletedLightningSparkReceiveQuoteDetails;
    }
  | {
      type: 'SPARK_LIGHTNING';
      direction: 'SEND';
      state: 'PENDING' | 'FAILED';
      details: SparkSendQuoteDetailsBase;
    }
  | {
      type: 'SPARK_LIGHTNING';
      direction: 'SEND';
      state: 'COMPLETED';
      details: CompletedSparkSendQuoteDetails;
    }
);
