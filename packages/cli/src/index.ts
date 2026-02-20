import {
  type Account,
  AccountRepository,
  type CashuAccount,
  configure,
  getAccountBalance,
  getCashuCryptography,
  getEncryption,
  getSeedPhraseDerivationPath,
  tokenToMoney,
} from '@agicash/core';
import { CashuReceiveSwapRepository } from '@agicash/core/features/receive/cashu-receive-swap-repository';
import { CashuReceiveSwapService } from '@agicash/core/features/receive/cashu-receive-swap-service';
import { ReadUserRepository } from '@agicash/core/features/user/user-repository';
import { extractCashuToken } from '@agicash/core/lib/cashu/token';
import { areMintUrlsEqual } from '@agicash/core/lib/cashu/utils';
import { hexToUint8Array } from '@agicash/core/lib/utils';
import { createMapCache } from './map-cache';
import { authenticateWithSeed } from './seed-auth';
import { createSeedKeyProvider } from './seed-key-provider';
import { createAgicashDb } from './supabase';

// -- Helpers ------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function formatSats(account: Account): string {
  const balance = getAccountBalance(account);
  if (!balance) return 'unknown';
  if (account.currency === 'BTC')
    return balance.toLocaleString({ unit: 'sat' });
  return balance.toLocaleString();
}

function formatAccount(account: Account, index: number): string {
  const balanceStr = formatSats(account);
  const status = account.isOnline ? 'online' : 'offline';

  let line = `  ${index + 1}. ${account.name} (${account.type}/${account.currency}) — ${balanceStr} [${status}]`;

  if (account.type === 'cashu') {
    line += `\n     Mint: ${account.mintUrl}`;
    line += `\n     Proofs: ${account.proofs.length} unspent`;
  }

  return line;
}

// -- Auth + shared context ----------------------------------------------------

type Context = {
  userId: string;
  accounts: Account[];
  db: ReturnType<typeof createAgicashDb>;
  encryption: ReturnType<typeof getEncryption>;
  accountRepo: AccountRepository;
};

async function createContext(): Promise<Context> {
  const mnemonic = requireEnv('SEED_PHRASE');
  const supabaseUrl = requireEnv('VITE_SUPABASE_URL');
  const supabaseAnonKey = requireEnv('VITE_SUPABASE_ANON_KEY');

  configure({
    supabaseUrl,
    supabaseAnonKey,
    cashuMintBlocklist: [],
    environment: 'local',
  });

  console.log('Authenticating...');
  const { token, publicKeyHex } = await authenticateWithSeed(
    mnemonic,
    supabaseUrl,
    supabaseAnonKey,
  );
  console.log('Authenticated.\n');

  const db = createAgicashDb(supabaseUrl, supabaseAnonKey, token);
  const cache = createMapCache();
  const keyProvider = createSeedKeyProvider(mnemonic);

  const { private_key: encPrivKeyHex } = await keyProvider.getPrivateKeyBytes({
    private_key_derivation_path: "m/10111099'/0'",
  });
  const encryption = getEncryption(
    hexToUint8Array(encPrivKeyHex),
    publicKeyHex,
  );

  const cashuCrypto = getCashuCryptography(keyProvider, cache);
  const sparkSeedPath = getSeedPhraseDerivationPath('spark', 12);

  const userRepo = new ReadUserRepository(db);
  const payload = JSON.parse(atob(token.split('.')[1]));
  const userId = payload.sub as string;

  const user = await userRepo.get(userId);
  console.log(`User: ${user.username} (${user.id})`);
  if (!user.isGuest) {
    console.log(`Email: ${user.email} (verified: ${user.emailVerified})`);
  } else {
    console.log('Guest account');
  }

  const accountRepo = new AccountRepository(
    db,
    encryption,
    cache,
    () => cashuCrypto.getSeed(),
    () =>
      keyProvider
        .getMnemonic({ seed_phrase_derivation_path: sparkSeedPath })
        .then((r) => r.mnemonic),
  );

  console.log('\nLoading accounts...');
  const accounts = await accountRepo.getAll(userId);

  return { userId, accounts, db, encryption, accountRepo };
}

// -- Commands -----------------------------------------------------------------

async function commandAccounts(ctx: Context) {
  console.log(`\nAccounts (${ctx.accounts.length}):`);
  for (let i = 0; i < ctx.accounts.length; i++) {
    console.log(formatAccount(ctx.accounts[i], i));
  }
}

async function commandReceive(ctx: Context, tokenStr: string) {
  const token = extractCashuToken(tokenStr);
  if (!token) {
    console.error('Failed to parse cashu token');
    process.exit(1);
  }

  const money = tokenToMoney(token);
  console.log(
    `\nToken: ${money.toLocaleString({ unit: 'sat' })} from ${token.mint}`,
  );

  const account = ctx.accounts.find(
    (a): a is CashuAccount =>
      a.type === 'cashu' &&
      areMintUrlsEqual(a.mintUrl, token.mint) &&
      a.currency === money.currency,
  );

  if (!account) {
    console.error(
      `No cashu account found for mint ${token.mint} (${money.currency})`,
    );
    process.exit(1);
  }

  if (!account.isOnline) {
    console.error(`Account "${account.name}" is offline`);
    process.exit(1);
  }

  console.log(`Receiving into: ${account.name} (${account.id})`);

  const receiveSwapRepo = new CashuReceiveSwapRepository(
    ctx.db,
    ctx.encryption,
    ctx.accountRepo,
  );
  const receiveSwapService = new CashuReceiveSwapService(receiveSwapRepo);

  console.log('Creating receive swap...');
  const { swap, account: updatedAccount } = await receiveSwapService.create({
    userId: ctx.userId,
    token,
    account,
  });
  console.log(`Swap created (${swap.state}), swapping proofs with mint...`);

  const result = await receiveSwapService.completeSwap(updatedAccount, swap);

  if (result.swap.state === 'COMPLETED') {
    const received = result.swap.amountReceived;
    console.log(
      `Received ${received.toLocaleString({ unit: 'sat' })} (${result.addedProofs.length} new proofs)`,
    );
  } else {
    console.error(`Swap failed: ${result.swap.state}`);
    process.exit(1);
  }
}

// -- CLI router ---------------------------------------------------------------

const USAGE = `Usage: agicash <command> [args]

Commands:
  accounts              List accounts and balances
  receive <token>       Receive a cashu token

Environment:
  SEED_PHRASE           BIP39 mnemonic (exported from web app)
  VITE_SUPABASE_URL     Supabase project URL
  VITE_SUPABASE_ANON_KEY  Supabase anon/publishable key`;

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const ctx = await createContext();

  switch (command) {
    case 'accounts':
      await commandAccounts(ctx);
      break;

    case 'receive': {
      const tokenStr = args[0];
      if (!tokenStr) {
        console.error('Usage: agicash receive <cashu-token>');
        process.exit(1);
      }
      await commandReceive(ctx, tokenStr);
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
