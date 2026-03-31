#!/usr/bin/env bun
import { parseArgs } from './args';
import { printError, printOutput } from './output';

const VERSION = '0.1.0';

const HELP_TEXT = {
  name: 'agicash',
  version: VERSION,
  commands: {
    'mint add <url>': 'Add a mint',
    'mint list': 'List configured mints',
    balance: 'Show wallet balance',
    receive: 'Receive ecash or Lightning',
    send: 'Send ecash or Lightning',
    help: 'Show this help',
    version: 'Show version',
  },
  flags: {
    '--pretty': 'Format output for humans (default: JSON)',
    '--help': 'Show help',
    '--version': 'Show version',
  },
};

async function main(): Promise<void> {
  // Bun.argv: [bun, script, ...args]
  const userArgs = process.argv.slice(2);
  const parsed = parseArgs(userArgs);
  const outputOptions = { pretty: Boolean(parsed.flags.pretty) };

  switch (parsed.command) {
    case 'help':
      printOutput(HELP_TEXT, outputOptions);
      break;

    case 'version':
      printOutput({ version: VERSION }, outputOptions);
      break;

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
