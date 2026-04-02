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
import { handleWatchCommand } from './commands/watch';
import { getDb } from './db';
import { installSdkConsoleBridge } from './logging';
import { detectMode } from './mode';
import { makeStorageProvider } from './opensecret-storage';
import { printError, printOutput } from './output';
import { getOpenSecretConfig, loadCliEnvFiles } from './runtime-config';
import {
  type SdkContext,
  cleanupSdkContext,
  getSdkContext,
} from './sdk-context';

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

async function withSdkContext<T>(
  outputOptions: OutputOptions,
  run: (ctx: SdkContext) => Promise<T>,
): Promise<T> {
  const ctx = await requireSdkContext(outputOptions);
  try {
    return await run(ctx);
  } finally {
    await cleanupSdkContext(ctx);
  }
}

const VERSION = '0.0.1';

const HELP_TEXT = {
  name: 'agicash',
  version: VERSION,
  setup: [
    'Cloud-only in v0.0.1. Run agicash auth guest or agicash auth login first.',
    'Config overrides load from ~/.agicash/.env, ./.env, or the shell environment.',
  ],
  commands: {
    'auth login <email> <password>': 'Log in with OpenSecret',
    'auth signup <email> <password>': 'Create an OpenSecret account',
    'auth logout': 'Clear stored credentials',
    'auth status': 'Show current auth state',
    'auth whoami': 'Alias for auth status',
    'auth guest': 'Create or re-use a guest account (for testing)',
    'mint add <url>':
      'Add a mint. Supports --currency BTC|USD and --name "My Mint"',
    'mint list': 'List configured Cashu mints',
    balance: 'Show balances and totals for all wallet accounts',
    'send <amount>':
      'Create a Cashu token from the selected Cashu account. Also supports --amount <amount> and --account <id>',
    'pay <invoice>':
      'Pay a Lightning invoice from the selected Cashu account. Also supports --bolt11 <invoice> and --account <id>',
    'receive <amount>':
      'Create a Lightning invoice using the selected Cashu account. Also supports --amount <amount>, --account <id>, and --wait',
    'receive <cashu-token>':
      'Claim a Cashu token. Also supports --account <id>',
    'receive list': 'List all pending quotes',
    'receive --check <quote-id>':
      'Check one pending quote and mint it if payment completed',
    'receive --check-all': 'Recheck all pending quotes and mint paid ones',
    'decode <input>':
      'Decode or identify bolt11, cashu token, Lightning address, LNURL, or URL. Also supports --input <input>',
    watch:
      'Watch pending quotes/swaps and auto-complete (foreground daemon). Supports --receive or --send to filter',
    config: 'Show all config values (same as config list)',
    'config get <key>': 'Show one config value',
    'config set <key> <value>':
      'Set config (default-btc-account, default-usd-account)',
    'config list': 'Show all config',
    help: 'Show this help',
    version: 'Show version',
  },
  globalFlags: {
    '--pretty': 'Format output for humans (default: JSON)',
    '--verbose': 'Write SDK debug logs to stderr',
    '--help, -h': 'Show help when used as the first argument',
    '--version, -v': 'Show version when used as the first argument',
  },
  notes: [
    'Amounts use the selected Cashu account unit: sats for BTC accounts and cents for USD accounts.',
    'decode, help, and version work without wallet setup. Other commands require auth and OpenSecret config.',
  ],
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
  const restoreConsole = installSdkConsoleBridge(Boolean(parsed.flags.verbose));

  try {
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
        const result = await withSdkContext(outputOptions, (ctx) =>
          handleBalanceCommand(ctx),
        );
        printOutput(result, outputOptions);
        break;
      }

      case 'receive': {
        getConfiguredDb(); // ensure OpenSecret is configured
        const result = await withSdkContext(outputOptions, (receiveCtx) =>
          handleReceiveCommand(parsed, receiveCtx, (invoice) => {
            printOutput(invoice, outputOptions);
          }),
        );
        if (result.action === 'error') {
          printError(result.error ?? '', result.code ?? '', outputOptions);
          process.exit(1);
        }
        printOutput(result, outputOptions);
        break;
      }

      case 'send': {
        getConfiguredDb();
        const sendResult = await withSdkContext(outputOptions, (sendCtx) =>
          handleSendCommand(parsed, sendCtx),
        );
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
        const payResult = await withSdkContext(outputOptions, (payCtx) =>
          handlePayCommand(parsed, payCtx),
        );
        if (payResult.action === 'error') {
          printError(
            payResult.error ?? '',
            payResult.code ?? '',
            outputOptions,
          );
          process.exit(1);
        }
        printOutput(payResult, outputOptions);
        break;
      }

      case 'decode': {
        const result = await handleDecodeCommand(parsed);
        if (result.error) {
          printError(
            result.error,
            result.code || 'DECODE_ERROR',
            outputOptions,
          );
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
        const result = await withSdkContext(outputOptions, (ctx) =>
          handleMintCommand(parsed, ctx),
        );
        if (result.action === 'error') {
          printError(result.error ?? '', result.code ?? '', outputOptions);
          process.exit(1);
        }
        printOutput(result, outputOptions);
        break;
      }

      case 'watch': {
        getConfiguredDb();
        const watchCtx = await requireSdkContext(outputOptions);
        await handleWatchCommand(watchCtx, watchCtx.wallet, {
          receive: Boolean(parsed.flags.receive),
          send: Boolean(parsed.flags.send),
        });
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
  } finally {
    restoreConsole();
  }
}

main().catch((err) => {
  process.stderr.write(
    `${JSON.stringify({ error: String(err), code: 'FATAL' })}\n`,
  );
  process.exit(1);
});
