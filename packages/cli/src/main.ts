#!/usr/bin/env bun
import { configure } from '@agicash/opensecret-sdk';
import { parseArgs } from './args';
import { executeAuthCommand, handleAuthCommand } from './commands/auth';
import { handleBalanceCommand } from './commands/balance';
import { handleConfigCommand } from './commands/config';
import { handleDecodeCommand } from './commands/decode';
import { handleMintCommand } from './commands/mint';
import { handlePayCommand } from './commands/pay';

import { handleReceiveCommand } from './commands/receive';
import { handleSendCommand } from './commands/send';
import { getDb } from './db';
import { detectMode } from './mode';
import { makeStorageProvider } from './opensecret-storage';
import { printError, printOutput } from './output';
import { getOpenSecretConfig, loadCliEnvFiles } from './runtime-config';
import { type SdkContext, getSdkContext } from './sdk-context';

type OutputOptions = { pretty: boolean };

async function requireSdkContext(
  outputOptions: OutputOptions,
): Promise<SdkContext> {
  try {
    return await getSdkContext();
  } catch (err) {
    printError(
      `Wallet setup failed. Run: agicash auth guest\n${err instanceof Error ? err.message : ''}`,
      'AUTH_REQUIRED',
      outputOptions,
    );
    process.exit(1);
  }
}

const VERSION = '0.0.1';

const HELP_TEXT = {
  name: 'agicash',
  version: VERSION,
  setup: [
    'Cloud-only in v0.0.1. Run agicash auth guest or agicash auth login first.',
    'Config overrides load from ~/.agicash/.env and ./.env.',
  ],
  commands: {
    'auth login <email> <password>': 'Log in with OpenSecret',
    'auth signup <email> <password>': 'Create an account',
    'auth logout': 'Clear stored credentials',
    'auth status': 'Show current auth state',
    'auth whoami': 'Alias for auth status',
    'auth guest': 'Create or re-use a guest account (for testing)',
    'mint add <url>': 'Add a mint (--currency BTC|USD, --name "My Mint")',
    'mint list': 'List configured mints',
    balance: 'Show wallet balance',
    'send <amount>': 'Create ecash token (sats)',
    'pay <invoice>': 'Pay a Lightning invoice',
    'receive <amount|token>':
      'Receive sats via Lightning invoice, or claim a cashu token',
    'receive list': 'List all pending quotes',
    'receive --check-all': 'Recheck all pending quotes and mint paid ones',
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

/** Commands that skip mode detection (no wallet needed). */
const MODE_BYPASS_COMMANDS = new Set(['help', 'version', 'decode']);

function getConfiguredDb(): ReturnType<typeof getDb> {
  const db = getDb();
  const openSecret = getOpenSecretConfig();
  if (openSecret.clientId) {
    configure({
      apiUrl: openSecret.apiUrl,
      clientId: openSecret.clientId,
      storage: makeStorageProvider(db),
    });
  }
  return db;
}

async function main(): Promise<void> {
  loadCliEnvFiles();

  const userArgs = process.argv.slice(2);
  const parsed = parseArgs(userArgs);
  const outputOptions = { pretty: Boolean(parsed.flags.pretty) };

  // Mode detection — wallet commands need a configured mode
  if (!MODE_BYPASS_COMMANDS.has(parsed.command)) {
    try {
      detectMode();
    } catch (err) {
      printError(
        err instanceof Error ? err.message : String(err),
        'CONFIG_ERROR',
        outputOptions,
      );
      process.exit(1);
    }
  }

  switch (parsed.command) {
    case 'help':
      printOutput(HELP_TEXT, outputOptions);
      break;

    case 'version':
      printOutput({ version: VERSION }, outputOptions);
      break;

    case 'balance': {
      getConfiguredDb(); // ensure OpenSecret is configured
      const ctx = await requireSdkContext(outputOptions);
      const result = await handleBalanceCommand(ctx);
      printOutput(result, outputOptions);
      break;
    }

    case 'receive': {
      getConfiguredDb(); // ensure OpenSecret is configured
      const receiveCtx = await requireSdkContext(outputOptions);
      const result = await handleReceiveCommand(parsed, receiveCtx);
      if (result.action === 'error') {
        printError(result.error ?? '', result.code ?? '', outputOptions);
        process.exit(1);
      }
      printOutput(result, outputOptions);
      break;
    }

    case 'send': {
      getConfiguredDb();
      const sendCtx = await requireSdkContext(outputOptions);
      const sendResult = await handleSendCommand(parsed, sendCtx);
      if (sendResult.action === 'error') {
        printError(
          sendResult.error ?? '',
          sendResult.code ?? '',
          outputOptions,
        );
        process.exit(1);
      }
      printOutput(sendResult, outputOptions);
      break;
    }

    case 'pay': {
      getConfiguredDb();
      const payCtx = await requireSdkContext(outputOptions);
      const payResult = await handlePayCommand(parsed, payCtx);
      if (payResult.action === 'error') {
        printError(payResult.error ?? '', payResult.code ?? '', outputOptions);
        process.exit(1);
      }
      printOutput(payResult, outputOptions);
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
      getConfiguredDb(); // ensure OpenSecret is configured
      const ctx = await requireSdkContext(outputOptions);
      const result = await handleMintCommand(parsed, ctx);
      if (result.action === 'error') {
        printError(result.error ?? '', result.code ?? '', outputOptions);
        process.exit(1);
      }
      printOutput(result, outputOptions);
      break;
    }

    case 'auth': {
      const db = getConfiguredDb();
      const validation = handleAuthCommand(parsed);
      if (validation.action === 'error') {
        printError(
          validation.error ?? '',
          validation.code ?? '',
          outputOptions,
        );
        process.exit(1);
      }
      const result = await executeAuthCommand(parsed, db);
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
