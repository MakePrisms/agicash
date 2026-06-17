import type { Account } from '../../domains/account-types';
import type { CashuReceiveQuote } from '../../domains/cashu-receive-quote';
import type { CashuReceiveSwap } from '../../domains/cashu-receive-swap';
import type { CashuSendQuote } from '../../domains/cashu-send-quote';
import type { CashuSendSwap } from '../../domains/cashu-send-swap';
import type { Contact } from '../../domains/contact';
import type { SparkReceiveQuote } from '../../domains/spark-receive-quote';
import type { SparkSendQuote } from '../../domains/spark-send-quote';
import type { Transaction } from '../../domains/transaction';
import type { User } from '../../domains/user-types';
import { ReadUserRepository } from '../db/user-repository';
import { ContactRepository } from '../db/contact-repository';
import type { AccountRepository } from '../db/account-repository';
import type { TransactionRepository } from '../db/transaction-repository';
import type { CashuSendQuoteRepository } from '../db/cashu-send-quote-repository';
import type { CashuSendSwapRepository } from '../db/cashu-send-swap-repository';
import type { CashuReceiveQuoteRepository } from '../db/cashu-receive-quote-repository';
import type { CashuReceiveSwapRepository } from '../db/cashu-receive-swap-repository';
import type { SparkSendQuoteRepository } from '../db/spark-send-quote-repository';
import type { SparkReceiveQuoteRepository } from '../db/spark-receive-quote-repository';
import type {
  AgicashDbAccountWithProofs,
  AgicashDbCashuProof,
  AgicashDbCashuReceiveQuote,
  AgicashDbCashuReceiveSwap,
  AgicashDbCashuSendQuote,
  AgicashDbCashuSendSwap,
  AgicashDbContact,
  AgicashDbSparkReceiveQuote,
  AgicashDbSparkSendQuote,
  AgicashDbTransaction,
  AgicashDbUser,
} from '../db/database';

export type ChangeFeedChange =
  | { kind: 'user'; operation: 'updated'; entity: User }
  | { kind: 'account'; operation: 'created' | 'updated'; entity: Account }
  | { kind: 'transaction'; operation: 'created' | 'updated'; entity: Transaction }
  | { kind: 'contact'; operation: 'created'; entity: Contact }
  | { kind: 'contact-deleted'; id: string }
  | { kind: 'cashu-send-quote'; operation: 'created' | 'updated'; entity: CashuSendQuote }
  | { kind: 'cashu-send-swap'; operation: 'created' | 'updated'; entity: CashuSendSwap }
  | { kind: 'cashu-receive-quote'; operation: 'created' | 'updated'; entity: CashuReceiveQuote }
  | { kind: 'cashu-receive-swap'; operation: 'created' | 'updated'; entity: CashuReceiveSwap }
  | { kind: 'spark-send-quote'; operation: 'created' | 'updated'; entity: SparkSendQuote }
  | { kind: 'spark-receive-quote'; operation: 'created' | 'updated'; entity: SparkReceiveQuote };

export type ChangeFeedRouterDeps = {
  accountRepository: Pick<AccountRepository, 'toAccount'>;
  transactionRepository: Pick<TransactionRepository, 'toTransaction'>;
  cashuSendQuoteRepository: Pick<CashuSendQuoteRepository, 'toQuote'>;
  cashuSendSwapRepository: Pick<CashuSendSwapRepository, 'toSwap'>;
  cashuReceiveQuoteRepository: Pick<CashuReceiveQuoteRepository, 'toQuote'>;
  cashuReceiveSwapRepository: Pick<CashuReceiveSwapRepository, 'toReceiveSwap'>;
  sparkSendQuoteRepository: Pick<SparkSendQuoteRepository, 'toQuote'>;
  sparkReceiveQuoteRepository: Pick<SparkReceiveQuoteRepository, 'toQuote'>;
  domain: string;
};

export async function routeChangeFeedEvent(
  event: string,
  payload: unknown,
  deps: ChangeFeedRouterDeps,
): Promise<ChangeFeedChange | undefined> {
  switch (event) {
    case 'USER_UPDATED': {
      const entity = ReadUserRepository.toUser(payload as AgicashDbUser);
      return { kind: 'user', operation: 'updated', entity };
    }

    case 'ACCOUNT_CREATED': {
      const entity = await deps.accountRepository.toAccount(payload as AgicashDbAccountWithProofs);
      return { kind: 'account', operation: 'created', entity };
    }

    case 'ACCOUNT_UPDATED': {
      const entity = await deps.accountRepository.toAccount(payload as AgicashDbAccountWithProofs);
      return { kind: 'account', operation: 'updated', entity };
    }

    case 'TRANSACTION_CREATED': {
      const entity = await deps.transactionRepository.toTransaction(payload as AgicashDbTransaction);
      return { kind: 'transaction', operation: 'created', entity };
    }

    case 'TRANSACTION_UPDATED': {
      const entity = await deps.transactionRepository.toTransaction(payload as AgicashDbTransaction);
      return { kind: 'transaction', operation: 'updated', entity };
    }

    case 'CONTACT_CREATED': {
      const entity = ContactRepository.toContact(payload as AgicashDbContact, deps.domain);
      return { kind: 'contact', operation: 'created', entity };
    }

    case 'CONTACT_DELETED': {
      const { id } = payload as AgicashDbContact;
      return { kind: 'contact-deleted', id };
    }

    case 'CASHU_RECEIVE_QUOTE_CREATED': {
      const entity = await deps.cashuReceiveQuoteRepository.toQuote(payload as AgicashDbCashuReceiveQuote);
      return { kind: 'cashu-receive-quote', operation: 'created', entity };
    }

    case 'CASHU_RECEIVE_QUOTE_UPDATED': {
      const entity = await deps.cashuReceiveQuoteRepository.toQuote(payload as AgicashDbCashuReceiveQuote);
      return { kind: 'cashu-receive-quote', operation: 'updated', entity };
    }

    case 'CASHU_RECEIVE_SWAP_CREATED': {
      const entity = await deps.cashuReceiveSwapRepository.toReceiveSwap(payload as AgicashDbCashuReceiveSwap);
      return { kind: 'cashu-receive-swap', operation: 'created', entity };
    }

    case 'CASHU_RECEIVE_SWAP_UPDATED': {
      const entity = await deps.cashuReceiveSwapRepository.toReceiveSwap(payload as AgicashDbCashuReceiveSwap);
      return { kind: 'cashu-receive-swap', operation: 'updated', entity };
    }

    case 'CASHU_SEND_QUOTE_CREATED': {
      const entity = await deps.cashuSendQuoteRepository.toQuote(
        payload as AgicashDbCashuSendQuote & { cashu_proofs: AgicashDbCashuProof[] },
      );
      return { kind: 'cashu-send-quote', operation: 'created', entity };
    }

    case 'CASHU_SEND_QUOTE_UPDATED': {
      const entity = await deps.cashuSendQuoteRepository.toQuote(
        payload as AgicashDbCashuSendQuote & { cashu_proofs: AgicashDbCashuProof[] },
      );
      return { kind: 'cashu-send-quote', operation: 'updated', entity };
    }

    case 'CASHU_SEND_SWAP_CREATED': {
      const entity = await deps.cashuSendSwapRepository.toSwap(
        payload as AgicashDbCashuSendSwap & { cashu_proofs: AgicashDbCashuProof[] },
      );
      return { kind: 'cashu-send-swap', operation: 'created', entity };
    }

    case 'CASHU_SEND_SWAP_UPDATED': {
      const entity = await deps.cashuSendSwapRepository.toSwap(
        payload as AgicashDbCashuSendSwap & { cashu_proofs: AgicashDbCashuProof[] },
      );
      return { kind: 'cashu-send-swap', operation: 'updated', entity };
    }

    case 'SPARK_RECEIVE_QUOTE_CREATED': {
      const entity = await deps.sparkReceiveQuoteRepository.toQuote(payload as AgicashDbSparkReceiveQuote);
      return { kind: 'spark-receive-quote', operation: 'created', entity };
    }

    case 'SPARK_RECEIVE_QUOTE_UPDATED': {
      const entity = await deps.sparkReceiveQuoteRepository.toQuote(payload as AgicashDbSparkReceiveQuote);
      return { kind: 'spark-receive-quote', operation: 'updated', entity };
    }

    case 'SPARK_SEND_QUOTE_CREATED': {
      const entity = await deps.sparkSendQuoteRepository.toQuote(payload as AgicashDbSparkSendQuote);
      return { kind: 'spark-send-quote', operation: 'created', entity };
    }

    case 'SPARK_SEND_QUOTE_UPDATED': {
      const entity = await deps.sparkSendQuoteRepository.toQuote(payload as AgicashDbSparkSendQuote);
      return { kind: 'spark-send-quote', operation: 'updated', entity };
    }

    default:
      console.debug('[change-feed-router] unknown event, ignoring:', event);
      return undefined;
  }
}
