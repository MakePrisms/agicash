# QR Code Output Plan

**Date:** 2026-04-03
**Status:** Approved
**Depends on:** MCP v2 (ebce297 on agicash-cli)

## Goal

Show QR codes for invoices and cashu tokens — in terminal, as PNG files, and as base64 images in MCP tool responses. One dependency (`qrcode` npm package) covers all modes.

## Phase 1: Terminal QR

**Goal:** `agicash receive` and `agicash send` print a scannable QR code in the terminal.

**Build:**

1. **Install dep:** `qrcode` package — `toString()` for UTF-8 terminal output, `toBuffer()` for PNG later.

2. **`src/qr.ts`** — thin wrapper:
   ```ts
   import QRCode from 'qrcode';
   export async function toTerminal(data: string): Promise<string> {
     return QRCode.toString(data, { type: 'utf8', errorCorrectionLevel: 'M' });
   }
   ```

3. **Wire into commands:**
   - `handleReceiveCommand` — after creating invoice, if `--pretty` flag is set, append QR code of the BOLT11 invoice to output
   - `handleSendCommand` — after creating token, if `--pretty` flag is set, append QR code of the cashu token
   - JSON mode (`--pretty` not set): no QR, just data as today

4. **Flag:** `--no-qr` to suppress QR in pretty mode. QR is on by default in `--pretty`, off in JSON mode.

**Files changed:**
- New: `src/qr.ts`
- `src/commands/receive.ts` — append QR after invoice
- `src/commands/send.ts` — append QR after token
- `package.json` — add `qrcode` dep

**Verify:**
```bash
agicash receive 1000 --pretty   # shows invoice + QR code
agicash send 100 --pretty       # shows token + QR code
agicash receive 1000            # JSON only, no QR
agicash receive 1000 --pretty --no-qr  # pretty, no QR
```

## Phase 2: PNG + MCP Image

**Goal:** PNG file output for agents. MCP tools return base64 QR images alongside text.

**Build:**

1. **Extend `src/qr.ts`:**
   ```ts
   export async function toPngBuffer(data: string): Promise<Buffer> {
     return QRCode.toBuffer(data, { errorCorrectionLevel: 'M', width: 300 });
   }
   export async function toPngBase64(data: string): Promise<string> {
     const buf = await toPngBuffer(data);
     return buf.toString('base64');
   }
   export async function toPngFile(data: string, path: string): Promise<void> {
     await QRCode.toFile(path, data, { errorCorrectionLevel: 'M', width: 300 });
   }
   ```

2. **CLI `--qr-file <path>` flag:**
   - Writes PNG to specified path
   - Works with both `receive` and `send`
   - Useful for agents that need to attach QR images to messages

3. **Daemon protocol:**
   - Add `includeQr?: boolean` param to `send` and `receive` methods
   - Daemon response includes `qrBase64?: string` field when requested

4. **MCP tool responses:**
   - `agicash_receive` and `agicash_send` — when result includes an invoice or token, return both text content AND image content:
     ```ts
     content: [
       { type: 'text', text: 'Invoice: lnbc1...\nQuote ID: abc123' },
       { type: 'image', data: qrBase64, mimeType: 'image/png' },
     ]
     ```
   - MCP spec supports multiple content blocks — image appears inline in Claude's response
   - Always include QR in MCP responses (agents benefit from having it available for forwarding)

5. **File attachment for Discord/pikachat:**
   - MCP tool can also write PNG to a temp file and include path in response text
   - Agent can then attach file via Discord/pikachat reply tools
   - Pattern: `{ type: 'text', text: '...\nQR image saved to /tmp/agicash-qr-{quoteId}.png' }`

**Files changed:**
- `src/qr.ts` — add PNG functions
- `src/args.ts` — add `--qr-file` flag
- `src/commands/receive.ts` — PNG file output
- `src/commands/send.ts` — PNG file output
- `src/daemon/protocol.ts` — `includeQr` param, `qrBase64` response field
- `src/daemon/router.ts` — generate QR in daemon
- `src/mcp/server.ts` — image content blocks in tool responses

**Verify:**
- `agicash receive 1000 --qr-file /tmp/invoice.png` — writes PNG
- MCP `agicash_receive({ amount: 1000 })` — returns text + image content
- Agent attaches PNG to Discord message

## Sequencing

```
Phase 1 ──→ Phase 2
```

Phase 1 is standalone — terminal QR with zero MCP changes. Phase 2 adds PNG and wires into MCP/daemon.
