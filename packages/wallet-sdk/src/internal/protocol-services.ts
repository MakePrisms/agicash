import { CashuReceiveQuoteRepository } from './db/cashu-receive-quote-repository';
import { CashuReceiveSwapRepository } from './db/cashu-receive-swap-repository';
import { CashuSendQuoteRepository } from './db/cashu-send-quote-repository';
import { CashuSendSwapRepository } from './db/cashu-send-swap-repository';
import { ContactRepository } from './db/contact-repository';
import type { AgicashDb } from './db/database';
import { SparkReceiveQuoteRepository } from './db/spark-receive-quote-repository';
import { SparkSendQuoteRepository } from './db/spark-send-quote-repository';
import { TransactionRepository } from './db/transaction-repository';

import type { CashuCryptography } from './cashu/cryptography';
import type { Encryption } from './crypto/encryption';
import type { AccountRepository } from './db/account-repository';

import { CashuReceiveQuoteService } from './services/cashu-receive-quote-service';
import { CashuReceiveSwapService } from './services/cashu-receive-swap-service';
import { CashuSendQuoteService } from './services/cashu-send-quote-service';
import { CashuSendSwapService } from './services/cashu-send-swap-service';
import { SparkReceiveQuoteService } from './services/spark-receive-quote-service';
import { SparkSendQuoteService } from './services/spark-send-quote-service';
import { TransferService } from './services/transfer-service';

export type ProtocolServices = {
  cashuSendQuoteRepository: CashuSendQuoteRepository;
  cashuSendSwapRepository: CashuSendSwapRepository;
  sparkSendQuoteRepository: SparkSendQuoteRepository;
  cashuReceiveQuoteRepository: CashuReceiveQuoteRepository;
  cashuReceiveSwapRepository: CashuReceiveSwapRepository;
  sparkReceiveQuoteRepository: SparkReceiveQuoteRepository;
  transactionRepository: TransactionRepository;
  contactRepository: ContactRepository;

  cashuSendQuoteService: CashuSendQuoteService;
  cashuSendSwapService: CashuSendSwapService;
  sparkSendQuoteService: SparkSendQuoteService;
  cashuReceiveQuoteService: CashuReceiveQuoteService;
  cashuReceiveSwapService: CashuReceiveSwapService;
  sparkReceiveQuoteService: SparkReceiveQuoteService;
  transferService: TransferService;
};

type Foundation = {
  db: AgicashDb;
  encryption: Encryption;
  cashuCryptography: CashuCryptography;
  accountRepository: AccountRepository;
};

type Deps = {
  /** LN-address domain for contact lud16 composition (SdkConfig.domain). */
  domain: string;
};

/**
 * Builds the protocol repositories + services over the foundation runtime, in
 * dependency order (cashu receive-swap service precedes cashu send-swap service;
 * the four quote services precede the transfer service). Stateless — holds no
 * disposable resources of its own (reuses the foundation's mintCache/sparkWallets,
 * which the WalletRuntime disposes).
 */
export function createProtocolServices(
  foundation: Foundation,
  deps: Deps,
): ProtocolServices {
  const { db, encryption, cashuCryptography, accountRepository } = foundation;

  const cashuSendQuoteRepository = new CashuSendQuoteRepository(db, encryption);
  const cashuSendSwapRepository = new CashuSendSwapRepository(db, encryption);
  const sparkSendQuoteRepository = new SparkSendQuoteRepository(db, encryption);
  const cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
    db,
    encryption,
    accountRepository,
  );
  const cashuReceiveSwapRepository = new CashuReceiveSwapRepository(
    db,
    encryption,
    accountRepository,
  );
  const sparkReceiveQuoteRepository = new SparkReceiveQuoteRepository(
    db,
    encryption,
  );
  const transactionRepository = new TransactionRepository(db, encryption);
  const contactRepository = new ContactRepository(db, deps.domain);

  const cashuReceiveSwapService = new CashuReceiveSwapService(
    cashuReceiveSwapRepository,
  );
  const cashuReceiveQuoteService = new CashuReceiveQuoteService(
    cashuCryptography,
    cashuReceiveQuoteRepository,
  );
  const sparkReceiveQuoteService = new SparkReceiveQuoteService(
    sparkReceiveQuoteRepository,
  );
  const cashuSendQuoteService = new CashuSendQuoteService(
    cashuSendQuoteRepository,
  );
  const cashuSendSwapService = new CashuSendSwapService(
    cashuSendSwapRepository,
    cashuReceiveSwapService,
  );
  const sparkSendQuoteService = new SparkSendQuoteService(
    sparkSendQuoteRepository,
  );
  const transferService = new TransferService(
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    cashuSendQuoteService,
    sparkSendQuoteService,
  );

  return {
    cashuSendQuoteRepository,
    cashuSendSwapRepository,
    sparkSendQuoteRepository,
    cashuReceiveQuoteRepository,
    cashuReceiveSwapRepository,
    sparkReceiveQuoteRepository,
    transactionRepository,
    contactRepository,
    cashuSendQuoteService,
    cashuSendSwapService,
    sparkSendQuoteService,
    cashuReceiveQuoteService,
    cashuReceiveSwapService,
    sparkReceiveQuoteService,
    transferService,
  };
}
