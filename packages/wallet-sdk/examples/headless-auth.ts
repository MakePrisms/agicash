import { Sdk, inMemoryStorageAdapter } from '@agicash/wallet-sdk';

// Headless guest sign-in against the local stack. NOT part of the test gate —
// run manually with the env vars below + a running Supabase/Open Secret stack.
const sdk = await Sdk.create({
  openSecret: {
    url: process.env.OPEN_SECRET_URL ?? '',
    clientId: process.env.OPEN_SECRET_CLIENT_ID ?? '',
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
  },
  storage: inMemoryStorageAdapter(),
  includeTestAccounts: true,
});

const user = await sdk.auth.signInGuest();
console.log('signed in as', user.id, '(guest:', `${user.isGuest})`);
console.log('current user:', await sdk.user.get());
await sdk.dispose();
