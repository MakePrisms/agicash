import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Money } from '@agicash/sdk';
import type { DaemonMethod } from '../daemon/protocol';
import { toPngBase64 } from '../qr';

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

type EventWaiter = {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// Map of quoteId -> list of waiters
const eventWaiters = new Map<string, EventWaiter[]>();
// Buffer for events that resolved before a waiter was registered (fixes race condition)
const resolvedEvents = new Map<string, Record<string, unknown>>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000;

// Terminal event mapping: daemon event -> normalized MCP event
const DAEMON_EVENT_MAP: Record<string, string> = {
  'send:completed': 'payment_completed',
  'send:failed': 'payment_failed',
  'spark:send:completed': 'payment_completed',
  'spark:send:failed': 'payment_failed',
  'receive:minted': 'receive_completed',
  'receive:expired': 'receive_failed',
  'receive:swap:completed': 'receive_completed',
  'spark:receive:completed': 'receive_completed',
  'spark:receive:expired': 'receive_failed',
  'send:swap:completed': 'payment_completed',
};

// Map from MCP tool name -> daemon method name
const TOOL_METHOD_MAP: Record<string, DaemonMethod> = {
  balance: 'balance',
  send: 'send',
  pay: 'pay',
  receive: 'receive',
  decode: 'decode',
  accounts: 'account.list',
  account_default: 'account.default',
  account_info: 'account.info',
  mint_add: 'mint.add',
  mint_list: 'mint.list',
  transactions: 'transactions',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'balance',
    description:
      'Show wallet balances across all accounts. Returns per-account balances (cashu ecash and spark) with totals per currency. Amounts are in sats (BTC) or cents (USD).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'send',
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
    name: 'pay',
    description: '', // set dynamically in ListTools handler based on channel support
    inputSchema: {
      type: 'object' as const,
      properties: {
        bolt11: {
          type: 'string',
          description: 'Lightning invoice or Lightning address to pay (required)',
        },
        accountId: {
          type: 'string',
          description: 'Specific account ID to pay from',
        },
        amount: {
          type: 'string',
          description: 'Amount in sats (required for Lightning address payments)',
        },
        wait: {
          type: 'boolean',
          description: 'Block until payment settles (default: false)',
        },
      },
      required: ['bolt11'],
    },
  },
  {
    name: 'receive',
    description:
      'Receive Bitcoin. Use amount (integer) to create a Lightning invoice, or token (cashuA.../cashuB...) to claim ecash. Token claims block until the swap completes and return the final result. Use list to see pending invoices, check/checkAll to poll for payment, inspect with token to check proof states.',
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
    name: 'decode',
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
    name: 'accounts',
    description:
      'List all wallet accounts with balances and details. Shows cashu and spark accounts, their mints, currencies, and default status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'account_default',
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
    name: 'account_info',
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
    name: 'mint_add',
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
    name: 'mint_list',
    description:
      'List configured Cashu mints. Shows all mints with their URLs, names, and associated accounts.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'transactions',
    description:
      'View transaction history. Returns recent transactions with amounts, types, and statuses. When hasMore is true, pass the returned cursor to fetch the next page.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Filter by account ID',
        },
        limit: {
          type: 'number',
          description: 'Number of transactions to return (default: 25)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor from previous response (JSON string)',
        },
      },
    },
  },
  {
    name: 'await_payment',
    description:
      'Block until a payment or receive quote settles. Returns the terminal event (completed/failed/expired). Use after creating a Lightning invoice or initiating a payment when you need to wait for the result.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        quoteId: {
          type: 'string',
          description: 'Quote ID to wait for (required)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default: 300, max: 300)',
        },
      },
      required: ['quoteId'],
    },
  },
];

// ---------------------------------------------------------------------------
// Logging (to stderr so it doesn't interfere with MCP stdio transport)
// ---------------------------------------------------------------------------

function log(message: string): void {
  process.stderr.write(`[mcp] ${message}\n`);
}

function formatAmount(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(num)) return '';
  const money = new Money({ amount: num, currency: 'BTC' });
  return money.toLocaleString({ unit: 'sat' });
}

function formatEventContent(mcpEvent: string, data: Record<string, unknown>): string {
  const amount = formatAmount(data.amount);
  switch (mcpEvent) {
    case 'payment_completed':
      return amount ? `Sent ${amount}` : 'Payment sent';
    case 'payment_failed': {
      const reason = (data.reason as string) ?? 'unknown';
      return `Payment failed: ${reason}`;
    }
    case 'receive_completed':
      return amount ? `Received ${amount}` : 'Payment received';
    case 'receive_failed':
      return 'Invoice expired';
    default:
      return `${mcpEvent}: ${JSON.stringify(data)}`;
  }
}

// ---------------------------------------------------------------------------
// Event waiter helper
// ---------------------------------------------------------------------------

const MAX_AWAIT_TIMEOUT_MS = 300_000; // 5 min hard cap

function waitForEvent(quoteId: string, timeoutMs?: number): Promise<Record<string, unknown>> {
  // Check buffer first — event may have arrived before waiter was registered
  const buffered = resolvedEvents.get(quoteId);
  if (buffered) {
    resolvedEvents.delete(quoteId);
    return Promise.resolve(buffered);
  }

  const effectiveTimeout = timeoutMs
    ? Math.min(timeoutMs, MAX_AWAIT_TIMEOUT_MS)
    : MAX_AWAIT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiters = eventWaiters.get(quoteId);
      if (waiters) {
        const idx = waiters.findIndex(w => w.timer === timer);
        if (idx >= 0) waiters.splice(idx, 1);
        if (waiters.length === 0) eventWaiters.delete(quoteId);
      }
      reject(new Error(`Timed out waiting for event on quote ${quoteId}`));
    }, effectiveTimeout);

    const waiter: EventWaiter = { resolve, reject, timer };
    const existing = eventWaiters.get(quoteId);
    if (existing) {
      existing.push(waiter);
    } else {
      eventWaiters.set(quoteId, [waiter]);
    }
  });
}

// ---------------------------------------------------------------------------
// Daemon child process management
// ---------------------------------------------------------------------------

function spawnDaemon(): ReturnType<typeof spawn> {
  const mainTs = resolve(import.meta.dirname ?? __dirname, '../main.ts');
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
  const trackedQuotes = new Set<string>();
  let exiting = false;
  let hasChannels = false;

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

      // Forward terminal events as channel notifications
      const mcpEvent = DAEMON_EVENT_MAP[msg.event];
      if (!mcpEvent) {
        log(`event NOT in DAEMON_EVENT_MAP: ${msg.event} (dropped)`);
      }
      if (mcpEvent) {
        const data = (msg.data ?? {}) as Record<string, unknown>;
        const eventQuoteId = (data.quoteId as string) ?? (data.tokenHash as string) ?? (data.swapId as string);
        log(`mapped event: daemon=${msg.event} → mcp=${mcpEvent} quoteId=${eventQuoteId ?? 'none'} tracked=${eventQuoteId ? trackedQuotes.has(eventQuoteId) : 'n/a'} trackedQuotes=[${[...trackedQuotes].join(',')}]`);

        // Only send channel notifications for operations this session initiated
        if (!eventQuoteId || trackedQuotes.has(eventQuoteId)) {
          log(`sending channel notification: ${mcpEvent} quoteId=${eventQuoteId ?? 'none'}`);
          const content = formatEventContent(mcpEvent, data);
          server.notification({
              method: 'notifications/claude/channel',
              params: {
                content,
                meta: {
                  source: 'agicash',
                  event: mcpEvent,
                  chat_id: 'agicash',
                  message_id: eventQuoteId ?? '',
                  ts: (msg.ts as string) ?? new Date().toISOString(),
                },
              },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any).catch((err: unknown) => {
              log(`channel notification failed: ${err}`);
            });

          // Clean up tracked quote on terminal event to prevent unbounded growth
          if (eventQuoteId) {
            trackedQuotes.delete(eventQuoteId);
          }
        }

        // Resolve any waiters for this event's quote (always, regardless of tracking)
        if (eventQuoteId) {
          const eventData = { event: mcpEvent, ...data };
          const waiters = eventWaiters.get(eventQuoteId);
          if (waiters) {
            eventWaiters.delete(eventQuoteId);
            for (const waiter of waiters) {
              clearTimeout(waiter.timer);
              waiter.resolve(eventData);
            }
          } else {
            // No waiter yet — buffer so waitForEvent can pick it up
            resolvedEvents.set(eventQuoteId, eventData);
          }
        }
      }
    }
  });

  // 3. Handle unexpected daemon exit (clean shutdown handled in cleanup)
  daemon.on('exit', (code, signal) => {
    log(`daemon exited: code=${code} signal=${signal}`);
    // Reject all pending requests
    for (const [id, req] of pending) {
      clearTimeout(req.timer);
      req.reject(new Error('daemon exited'));
      pending.delete(id);
    }
    // Reject all event waiters
    for (const [qid, waiters] of eventWaiters) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('daemon exited'));
      }
      eventWaiters.delete(qid);
    }
    // Only exit with error if this wasn't a clean shutdown
    if (!exiting) {
      process.exit(1);
    }
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

  // 6. Query daemon for wallet state to build instructions
  let accountSummary = '';
  try {
    const accountResult = await sendRequest('account.list', {}) as { accounts?: Array<Record<string, unknown>> };
    if (accountResult.accounts?.length) {
      const lines = accountResult.accounts.map((a: Record<string, unknown>) =>
        `- ${a.name} (${a.type}, ${a.currency}): ${a.balance} ${a.unit}${a.is_default ? ' [default]' : ''}`,
      );
      accountSummary = `\nWallet accounts:\n${lines.join('\n')}`;
    }
  } catch {
    accountSummary = '\nWallet accounts: unable to query (auth may be needed)';
  }

  // 7. Create the MCP server
  const server = new Server(
    {
      name: 'agicash',
      version: '0.0.1',
    },
    {
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      instructions: [
        'Agicash is a Bitcoin wallet with Cashu ecash and Lightning support.',
        'Amounts are in sats (BTC) or cents (USD) depending on the account currency.',
        'Use balance for quick balances, accounts for detailed account info.',
        'Payments: pay for Lightning invoices/addresses, send for ecash tokens.',
        'Receiving: receive for Lightning invoices or claiming ecash tokens.',
        'Use await_payment to wait for payment/receive completion.',
        'Sharing invoices/tokens: In chat (Discord, etc), include both the QR code image (qrFile path) and the bolt11/token string. In a terminal, output just the string — QR images won\'t render.',
        accountSummary,
      ].filter(Boolean).join('\n'),
    },
  );

  // 8. Register tool listing (adaptive descriptions based on channel support)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const settlementHint = hasChannels
      ? "When wait is false, you'll receive a channel notification when payment settles."
      : 'When wait is false, use await_payment to check settlement status.';
    const payDesc = `Pay a Lightning invoice (bolt11) or Lightning address (user@domain). For Lightning addresses, amount is required. Automatically selects the best account (prefers spark for lower fees). Set wait: true to block until payment settles. ${settlementHint}`;

    return {
      tools: TOOLS.map(t =>
        t.name === 'pay' ? { ...t, description: payDesc } : t,
      ),
    };
  });

  // 9. Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const params = (request.params.arguments ?? {}) as Record<string, unknown>;

    // -- Special tool handling --

    // pay with wait: block until payment settles
    if (toolName === 'pay' && params.wait) {
      // Remove wait from params before sending to daemon
      const { wait, ...daemonParams } = params;
      try {
        const result = await sendRequest('pay', daemonParams) as Record<string, unknown>;

        // Extract quote ID from result and track it for event filtering
        const payment = result.payment as Record<string, unknown> | undefined;
        const quoteId = payment?.quote_id as string | undefined;
        if (quoteId) {
          trackedQuotes.add(quoteId);
        }

        if (quoteId && payment?.state === 'pending') {
          // Wait for terminal event (60s timeout)
          try {
            const event = await waitForEvent(quoteId, 60_000);
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ ...result, settlement: event }, null, 2),
              }],
            };
          } catch (err) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  ...result,
                  settlement: { error: err instanceof Error ? err.message : String(err) },
                }, null, 2),
              }],
            };
          }
        }

        // Not pending (error or already settled) — return as-is
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          }],
          isError: true,
        };
      }
    }

    // pay without wait: send payment and track quoteId for notifications
    if (toolName === 'pay' && !params.wait) {
      try {
        const result = await sendRequest('pay', params) as Record<string, unknown>;
        const payment = result.payment as Record<string, unknown> | undefined;
        const quoteId = payment?.quote_id as string | undefined;
        if (quoteId) {
          trackedQuotes.add(quoteId);
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          }],
          isError: true,
        };
      }
    }

    // await_payment: block until a quote settles (MCP-only, no daemon method)
    if (toolName === 'await_payment') {
      const quoteId = params.quoteId as string;
      const timeoutSec = params.timeout as number | undefined;
      const timeoutMs = timeoutSec ? timeoutSec * 1000 : undefined;

      if (!quoteId) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Missing quoteId' }) }],
          isError: true,
        };
      }

      try {
        const event = await waitForEvent(quoteId, timeoutMs);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(event, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    }

    // -- QR code handling for send / receive --

    if (toolName === 'send' || toolName === 'receive') {
      const qrMethod = TOOL_METHOD_MAP[toolName];
      try {
        const result = await sendRequest(qrMethod, params) as Record<string, unknown>;

        // Track the operation's identifier for event filtering
        if (toolName === 'send') {
          const token = result.token as Record<string, unknown> | undefined;
          const tokenHash = token?.tokenHash as string | undefined;
          if (tokenHash) trackedQuotes.add(tokenHash);
        } else {
          const quote = result.quote as Record<string, unknown> | undefined;
          const quoteId = quote?.id as string | undefined;
          if (quoteId) trackedQuotes.add(quoteId);
        }

        // Token receive: block until swap completes (same pattern as pay with wait)
        if (toolName === 'receive') {
          const swap = result.swap as Record<string, unknown> | undefined;
          const tokenHash = swap?.tokenHash as string | undefined;
          if (tokenHash && swap?.state === 'PENDING') {
            trackedQuotes.add(tokenHash);
            try {
              const event = await waitForEvent(tokenHash, 60_000);
              const settled = event.event === 'receive_completed';
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({ ...result, swap: { ...swap, state: settled ? 'COMPLETED' : 'FAILED' }, settlement: event }, null, 2),
                }],
              };
            } catch (err) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    ...result,
                    settlement: { error: err instanceof Error ? err.message : String(err) },
                  }, null, 2),
                }],
              };
            }
          }
        }

        // Extract the QR-encodable data from the result
        let qrData: string | undefined;
        if (toolName === 'send') {
          const token = result.token as Record<string, unknown> | undefined;
          qrData = token?.encoded as string | undefined;
        } else {
          // receive — invoice is in quote.bolt11, token claim has no QR
          const quote = result.quote as Record<string, unknown> | undefined;
          qrData = quote?.bolt11 as string | undefined;
          // Also check for qrData directly on the result (set by handler)
          if (!qrData && typeof result.qrData === 'string') {
            qrData = result.qrData;
          }
        }

        const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ];

        if (qrData) {
          try {
            const qrBase64 = await toPngBase64(qrData);

            // Write to temp file for agents that need file paths
            const tmpPath = join(tmpdir(), `agicash-qr-${Date.now()}.png`);
            await writeFile(tmpPath, Buffer.from(qrBase64, 'base64'));

            content[0] = {
              type: 'text' as const,
              text: JSON.stringify({ ...result, qrFile: tmpPath }, null, 2),
            };
            content.push({
              type: 'image' as const,
              data: qrBase64,
              mimeType: 'image/png',
            });
          } catch {
            // QR generation failed — return text-only result
          }
        }

        return { content };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          }],
          isError: true,
        };
      }
    }

    // -- Generic tool handling --

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

  // 10. Connect the MCP server to its own stdio transport (Claude <-> MCP server)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const clientCaps = server.getClientCapabilities();
  hasChannels = !!clientCaps?.experimental?.['claude/channel'];
  log(`client channel support: ${hasChannels}`);
  log('MCP server connected');

  // 11. Cleanup on shutdown
  const cleanup = () => {
    if (exiting) return;
    exiting = true;
    log('shutting down');
    daemon.kill('SIGTERM');
    // Give daemon 5s to exit gracefully, then force kill
    const forceTimer = setTimeout(() => {
      log('daemon did not exit in time, force killing');
      daemon.kill('SIGKILL');
    }, 5000);
    daemon.on('exit', () => {
      clearTimeout(forceTimer);
      process.exit(0);
    });
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
