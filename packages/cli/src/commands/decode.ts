import type { ParsedArgs } from '../args';

export interface DecodeResult {
  type: string;
  raw: string;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
}

export async function handleDecodeCommand(
  args: ParsedArgs,
): Promise<DecodeResult> {
  const input = args.positional[0] || (args.flags.input as string);
  if (!input) {
    return {
      type: 'error',
      raw: '',
      error: 'Missing input. Usage: agicash decode <bolt11|cashu-token|lnurl|mint-url>',
      code: 'MISSING_INPUT',
    };
  }

  // Detect type and decode
  if (input.startsWith('cashuA') || input.startsWith('cashuB')) {
    return decodeCashuToken(input);
  }

  if (input.startsWith('lnbc') || input.startsWith('lntb') || input.startsWith('lnbcrt')) {
    return decodeBolt11(input);
  }

  if (input.startsWith('lnurl') || input.startsWith('LNURL')) {
    return decodeLnurl(input);
  }

  // Check if it's a Lightning address (user@domain)
  if (input.includes('@') && input.includes('.')) {
    return decodeLightningAddress(input);
  }

  // Check if it's a URL (mint URL)
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return {
        type: 'url',
        raw: input,
        data: {
          protocol: url.protocol,
          host: url.hostname,
          path: url.pathname,
          hint: 'Could be a mint URL. Use: agicash mint add ' + input,
        },
      };
    }
  } catch {
    // Not a URL
  }

  return {
    type: 'unknown',
    raw: input,
    error: 'Could not determine input type.',
    code: 'UNKNOWN_TYPE',
  };
}

async function decodeCashuToken(token: string): Promise<DecodeResult> {
  try {
    const { getDecodedToken } = await import('@cashu/cashu-ts');
    const decoded = getDecodedToken(token);

    const totalAmount = decoded.proofs.reduce(
      (sum: number, p: { amount: number }) => sum + p.amount,
      0,
    );

    return {
      type: 'cashu_token',
      raw: token,
      data: {
        mint: decoded.mint,
        unit: decoded.unit,
        memo: decoded.memo || null,
        proof_count: decoded.proofs.length,
        total_amount: totalAmount,
      },
    };
  } catch (err) {
    return {
      type: 'cashu_token',
      raw: token,
      error: `Failed to decode cashu token: ${err instanceof Error ? err.message : String(err)}`,
      code: 'DECODE_FAILED',
    };
  }
}

async function decodeBolt11(invoice: string): Promise<DecodeResult> {
  try {
    const { decodeBolt11: decode } = await import('@agicash/sdk');
    const decoded = decode(invoice);

    return {
      type: 'bolt11',
      raw: invoice,
      data: {
        amount_msat: decoded.amount,
        network: decoded.network,
        timestamp: decoded.timestamp,
        expiry: decoded.expiry,
        description: decoded.description,
        payment_hash: decoded.paymentHash,
      },
    };
  } catch (err) {
    return {
      type: 'bolt11',
      raw: invoice,
      error: `Failed to decode bolt11: ${err instanceof Error ? err.message : String(err)}`,
      code: 'DECODE_FAILED',
    };
  }
}

function decodeLnurl(input: string): DecodeResult {
  return {
    type: 'lnurl',
    raw: input,
    data: {
      hint: 'LNURL decoding not yet implemented. Use the encoded URL directly.',
    },
  };
}

function decodeLightningAddress(address: string): DecodeResult {
  const [user, domain] = address.split('@');
  return {
    type: 'lightning_address',
    raw: address,
    data: {
      user,
      domain,
      lnurlp_url: `https://${domain}/.well-known/lnurlp/${user}`,
    },
  };
}
