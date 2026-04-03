import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { DaemonMethod } from '../daemon/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DaemonJsonlResponse = {
  id?: string;
  result?: unknown;
  error?: { code: string; message: string };
  event?: string;
  data?: unknown;
  ts?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000;

// Map from MCP tool name -> daemon method name
const TOOL_METHOD_MAP: Record<string, DaemonMethod> = {
  agicash_balance: 'balance',
  agicash_send: 'send',
  agicash_pay: 'pay',
  agicash_receive: 'receive',
  agicash_decode: 'decode',
  agicash_accounts: 'account.list',
  agicash_account_default: 'account.default',
  agicash_account_info: 'account.info',
  agicash_mint_add: 'mint.add',
  agicash_mint_list: 'mint.list',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'agicash_balance',
    description:
      'Show wallet balances across all accounts. Returns per-account balances (cashu ecash and spark) with totals per currency. Amounts are in sats (BTC) or cents (USD).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'agicash_send',
    description:
      "Create a cashu ecash token. The token can be shared with anyone to transfer value. Amount is in the account's unit (sats for BTC, cents for USD). Optionally specify accountId to use a specific cashu account.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        amount: {
          type: 'string',
          description: 'Amount to send (required)',
        },
        accountId: {
          type: 'string',
          description: 'Specific cashu account ID to send from',
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'agicash_pay',
    description:
      'Pay a Lightning invoice (bolt11) from the wallet. Automatically selects the best account (prefers spark for lower fees). Optionally specify accountId to force a specific account.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bolt11: {
          type: 'string',
          description: 'Lightning invoice to pay (required)',
        },
        accountId: {
          type: 'string',
          description: 'Specific account ID to pay from',
        },
      },
      required: ['bolt11'],
    },
  },
  {
    name: 'agicash_receive',
    description:
      'Receive Bitcoin. Use amount (integer) to create a Lightning invoice, or token (cashuA.../cashuB...) to claim ecash. Use list to see pending invoices, check/checkAll to poll for payment, inspect with token to check proof states.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        amount: {
          type: 'string',
          description: 'Amount for Lightning invoice (sats or cents)',
        },
        token: {
          type: 'string',
          description: 'Cashu token to claim (cashuA.../cashuB...)',
        },
        accountId: {
          type: 'string',
          description: 'Specific account ID to receive into',
        },
        inspect: {
          type: 'boolean',
          description: 'Inspect a token without claiming it',
        },
        check: {
          type: 'string',
          description: 'Check a specific pending quote ID for payment',
        },
        checkAll: {
          type: 'boolean',
          description: 'Check all pending quotes and mint paid ones',
        },
        list: {
          type: 'boolean',
          description: 'List all pending receive quotes',
        },
      },
    },
  },
  {
    name: 'agicash_decode',
    description:
      'Decode or identify a payment string. Supports bolt11 invoices, cashu tokens, Lightning addresses (user@domain), LNURLs, and mint URLs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        input: {
          type: 'string',
          description:
            'The string to decode (bolt11, cashu token, Lightning address, LNURL, or URL)',
        },
      },
      required: ['input'],
    },
  },
  {
    name: 'agicash_accounts',
    description:
      'List all wallet accounts with balances and details. Shows cashu and spark accounts, their mints, currencies, and default status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'agicash_account_default',
    description:
      "Set an account as the default for its currency. The default account is used when no specific account is specified for send/receive/pay operations.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Account ID to set as default (required)',
        },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'agicash_account_info',
    description:
      'Show detailed info for a specific account including mint URL, currency, balance, and key sets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Account ID to get info for (required)',
        },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'agicash_mint_add',
    description:
      'Add a Cashu mint and create an account for it. Provide the mint URL; optionally set a friendly name and currency (BTC or USD).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'Mint URL to add (required)',
        },
        name: {
          type: 'string',
          description: 'Friendly name for the mint',
        },
        currency: {
          type: 'string',
          description: 'Currency: BTC or USD',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'agicash_mint_list',
    description:
      'List configured Cashu mints. Shows all mints with their URLs, names, and associated accounts.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Logging (to stderr so it doesn't interfere with MCP stdio transport)
// ---------------------------------------------------------------------------

function log(message: string): void {
  process.stderr.write(`[mcp] ${message}\n`);
}

// ---------------------------------------------------------------------------
// Daemon child process management
// ---------------------------------------------------------------------------

function spawnDaemon(): ReturnType<typeof spawn> {
  const mainTs = resolve(__dirname, '../main.ts');
  log(`spawning daemon: bun run ${mainTs} daemon`);

  const child = spawn('bun', ['run', mainTs, 'daemon'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  return child;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Spawn the daemon
  const daemon = spawnDaemon();
  const pending = new Map<string, PendingRequest>();

  if (!daemon.stdout || !daemon.stdin) {
    log('daemon stdio not available');
    process.exit(1);
  }

  // 2. Parse JSONL from daemon stdout
  const daemonRl = createInterface({ input: daemon.stdout });

  daemonRl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: DaemonJsonlResponse;
    try {
      msg = JSON.parse(trimmed) as DaemonJsonlResponse;
    } catch {
      log(`invalid JSON from daemon: ${trimmed}`);
      return;
    }

    // Response (has id)
    if (msg.id) {
      const req = pending.get(msg.id);
      if (!req) {
        log(`response for unknown request id: ${msg.id}`);
        return;
      }
      pending.delete(msg.id);
      clearTimeout(req.timer);

      if (msg.error) {
        req.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      } else {
        req.resolve(msg.result);
      }
      return;
    }

    // Event (has event field, no id)
    if (msg.event) {
      log(`event: ${msg.event} ${JSON.stringify(msg.data ?? {})}`);
    }
  });

  // 3. Handle daemon exit
  daemon.on('exit', (code, signal) => {
    log(`daemon exited: code=${code} signal=${signal}`);
    // Reject all pending requests
    for (const [id, req] of pending) {
      clearTimeout(req.timer);
      req.reject(new Error('daemon exited'));
      pending.delete(id);
    }
    process.exit(1);
  });

  daemon.on('error', (err) => {
    log(`daemon spawn error: ${err.message}`);
    process.exit(1);
  });

  // 4. Wait for daemon:ready event
  await new Promise<void>((resolveReady, rejectReady) => {
    const readyTimeout = setTimeout(() => {
      rejectReady(new Error('daemon did not become ready within 30s'));
    }, REQUEST_TIMEOUT_MS);

    const readyHandler = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as DaemonJsonlResponse;
        if (msg.event === 'daemon:ready') {
          clearTimeout(readyTimeout);
          daemonRl.removeListener('line', readyHandler);
          log('daemon ready');
          resolveReady();
        }
      } catch {
        // ignore parse errors during startup
      }
    };

    // Prepend the ready handler so it fires before the general handler
    daemonRl.prependListener('line', readyHandler);
  });

  // 5. Helper to send a request to the daemon and await a response
  function sendRequest(
    method: DaemonMethod,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise<unknown>((resolveReq, rejectReq) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectReq(new Error(`request ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      pending.set(id, { resolve: resolveReq, reject: rejectReq, timer });

      const request = JSON.stringify({ id, method, params });
      daemon.stdin!.write(`${request}\n`);
    });
  }

  // 6. Create the MCP server
  const server = new Server(
    {
      name: 'agicash',
      version: '0.0.1',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Register tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const method = TOOL_METHOD_MAP[toolName];

    if (!method) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
          },
        ],
        isError: true,
      };
    }

    try {
      const params = (request.params.arguments ?? {}) as Record<string, unknown>;
      const result = await sendRequest(method, params);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // 7. Connect the MCP server to its own stdio transport (Claude <-> MCP server)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server connected');

  // 8. Cleanup on shutdown
  const cleanup = () => {
    log('shutting down');
    daemon.kill('SIGTERM');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  process.stderr.write(
    `[mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
