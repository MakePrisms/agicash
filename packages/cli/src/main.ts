#!/usr/bin/env bun
import { configure } from '@agicash/opensecret-sdk';
import { parseArgs } from './args';
import { handleBalanceCommand } from './commands/balance';
import { handleConfigCommand } from './commands/config';
import { handleDecodeCommand } from './commands/decode';
import { handleMintCommand } from './commands/mint';
import { handlePayCommand } from './commands/pay';
import { handleReceiveCommand } from './commands/receive';
import { handleSendCommand } from './commands/send';
import { getDb } from './db';
import { hasMnemonic } from './key-provider';
import { makeStorageProvider } from './opensecret-storage';
import { printError, printOutput } from './output';

const VERSION = '0.1.0';

const HELP_TEXT = {
  name: 'agicash',
  version: VERSION,
  commands: {
    'mint add <url>': 'Add a mint (--currency BTC|USD, --name "My Mint")',
    'mint list': 'List configured mints',
    balance: 'Show wallet balance',
    'send <amount>': 'Create ecash token (sats)',
    'pay <invoice>': 'Pay a Lightning invoice',
    'receive <amount|token>':
      'Receive sats via Lightning invoice, or claim a cashu token',
    'decode <input>':
      'Parse any input (bolt11, cashu token, lnurl, Lightning address)',
    'config set <key> <value>':
      'Set config (default-btc-account, default-usd-account)',
    'config list': 'Show all config',
    help: 'Show this help',
    version: 'Show version',
  },
  flags: {
    '--pretty': 'Format output for humans (default: JSON)',
    '--help': 'Show help',
    '--version': 'Show version',
  },
};

/** Commands that require a mnemonic for wallet operations. */
const COMMANDS_REQUIRING_MNEMONIC = new Set(['send', 'pay', 'receive']);

function requireMnemonic(command: string, outputOptions: { pretty: boolean }) {
  if (!COMMANDS_REQUIRING_MNEMONIC.has(command)) return;
  if (hasMnemonic()) return;

  printError(
    'AGICASH_MNEMONIC is required. Generate one with:\n' +
      "bun -e \"import{generateMnemonic}from'@scure/bip39';import{wordlist}from'@scure/bip39/wordlists/english';console.log(generateMnemonic(wordlist))\"",
    'MISSING_MNEMONIC',
    outputOptions,
  );
  process.exit(1);
}

function getConfiguredDb(): ReturnType<typeof getDb> {
  const db = getDb();
  if (process.env.OPENSECRET_CLIENT_ID) {
    configure({
      apiUrl:
        process.env.OPENSECRET_API_URL ?? 'https://preview.opensecret.cloud',
      clientId: process.env.OPENSECRET_CLIENT_ID,
      storage: makeStorageProvider(db),
    });
  }
  return db;
}

async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  const parsed = parseArgs(userArgs);
  const outputOptions = { pretty: Boolean(parsed.flags.pretty) };

  requireMnemonic(parsed.command, outputOptions);

  switch (parsed.command) {
    case 'help':
      printOutput(HELP_TEXT, outputOptions);
      break;

    case 'version':
      printOutput({ version: VERSION }, outputOptions);
      break;

    case 'balance': {
      const db = getConfiguredDb();
      const result = handleBalanceCommand(db);
      printOutput(result, outputOptions);
      break;
    }

    case 'receive': {
      const db = getConfiguredDb();
      const result = await handleReceiveCommand(parsed, db);
      if (result.action === 'error') {
        printError(result.error ?? '', result.code ?? '', outputOptions);
        process.exit(1);
      }
      printOutput(result, outputOptions);
      break;
    }

    case 'send': {
      const db = getConfiguredDb();
      const result = await handleSendCommand(parsed, db);
      if (result.action === 'error') {
        printError(result.error ?? '', result.code ?? '', outputOptions);
        process.exit(1);
      }
      printOutput(result, outputOptions);
      break;
    }

    case 'pay': {
      const db = getConfiguredDb();
      const result = await handlePayCommand(parsed, db);
      if (result.action === 'error') {
        printError(result.error ?? '', result.code ?? '', outputOptions);
        process.exit(1);
      }
      printOutput(result, outputOptions);
      break;
    }

    case 'decode': {
      const result = await handleDecodeCommand(parsed);
      if (result.error) {
        printError(result.error, result.code || 'DECODE_ERROR', outputOptions);
        process.exit(1);
      }
      printOutput(result, outputOptions);
      break;
    }

    case 'config': {
      const db = getConfiguredDb();
      const result = handleConfigCommand(parsed, db);
      if (result.action === 'error') {
        printError(result.error ?? '', result.code ?? '', outputOptions);
        process.exit(1);
      }
      printOutput(result, outputOptions);
      break;
    }

    case 'mint': {
      const db = getConfiguredDb();
      const result = await handleMintCommand(parsed, db);
      if (result.action === 'error') {
        printError(result.error ?? '', result.code ?? '', outputOptions);
        process.exit(1);
      }
      printOutput(result, outputOptions);
      break;
    }

    default:
      printError(
        `Unknown command: ${parsed.command}`,
        'UNKNOWN_COMMAND',
        outputOptions,
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err), code: 'FATAL' }));
  process.exit(1);
});
