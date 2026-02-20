import { schnorr } from '@noble/curves/secp256k1';
import { SignJWT } from 'jose';

const TIMESTAMP_TOLERANCE_SECONDS = 60;
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

// biome-ignore lint/correctness/noUndeclaredVariables: Deno runtime global
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // biome-ignore lint/correctness/noUndeclaredVariables: Deno runtime global
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  // biome-ignore lint/correctness/noUndeclaredVariables: Deno runtime global
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // biome-ignore lint/correctness/noUndeclaredVariables: Deno runtime global
  const jwtSecret = Deno.env.get('JWT_SECRET');

  if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let body: { public_key: string; timestamp: number; signature: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { public_key, timestamp, signature } = body;

  // Validate input formats
  if (typeof public_key !== 'string' || !/^[0-9a-f]{64}$/i.test(public_key)) {
    return Response.json(
      { error: 'public_key must be a 64-character hex string' },
      { status: 400 },
    );
  }
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) {
    return Response.json(
      { error: 'signature must be a 128-character hex string' },
      { status: 400 },
    );
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return Response.json(
      { error: 'timestamp must be a finite number' },
      { status: 400 },
    );
  }

  // Replay protection: reject timestamps outside tolerance window
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
    return Response.json(
      { error: 'Timestamp expired or too far in the future' },
      { status: 401 },
    );
  }

  // Verify schnorr signature
  const message = `agicash:seed-auth:${public_key}:${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);

  let valid: boolean;
  try {
    valid = schnorr.verify(signature, messageBytes, public_key);
  } catch {
    valid = false;
  }
  if (!valid) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Look up user by encryption_public_key via PostgREST
  const userResponse = await fetch(
    `${supabaseUrl}/rest/v1/users?encryption_public_key=eq.${public_key}&select=id`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
        'Accept-Profile': 'wallet',
      },
    },
  );

  if (!userResponse.ok) {
    return Response.json({ error: 'Database query failed' }, { status: 500 });
  }

  const users = await userResponse.json();
  if (!Array.isArray(users) || users.length === 0) {
    return Response.json(
      { error: 'No user found for this public key' },
      { status: 404 },
    );
  }

  const userId = users[0].id;

  // Mint JWT
  const expiresAt = now + TOKEN_EXPIRY_SECONDS;
  const secret = new TextEncoder().encode(jwtSecret);

  const token = await new SignJWT({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${supabaseUrl}/auth/v1`,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return Response.json({ token, expires_at: expiresAt });
});
