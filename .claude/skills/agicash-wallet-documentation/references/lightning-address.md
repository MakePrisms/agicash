# Lightning Address (LNURL-pay) Receive

Server-side flow for receiving payments via Lightning Address (e.g., `user@agi.cash`).

## Flow

```
1. Discovery (LUD-16)
   → Sender resolves username@domain → GET /.well-known/lnurlp/{username}
   → Returns LNURL-pay params: callback URL, min/max sendable, metadata

2. Callback (LUD-06)
   → Sender's wallet calls /api/lnurlp/callback/{userId}?amount={msat}
   → Resolves user's default account (Cashu or Spark)
   → Creates receive quote + Lightning invoice on server
   → Returns { pr (invoice), verify (encrypted URL) }

3. Payment
   → Sender pays the bolt11 invoice over Lightning (external)

4. Verification (LUD-21)
   → Sender polls /api/lnurlp/verify/{encryptedQuoteData}
   → Server decrypts token, checks settlement:
     - Cashu: wallet.checkMintQuote() → PAID or ISSUED
     - Spark: wallet.getLightningReceiveRequest() → TRANSFER_COMPLETED
   → Returns { settled, preimage, pr }
```

## Cashu vs Spark Routing

Determined by user's **default account** for the resolved currency:

1. Fetch user's default account ID for the currency
2. Account `type` field (`'cashu'` or `'spark'`) determines the path
3. **Cashu**: mint quote from Cashu mint → Lightning invoice, locked to user's P2PK public key
4. **Spark**: Lightning invoice from Spark SDK

**Currency constraint:** External LNURL requests force `currency='BTC'`. When `bypassAmountValidation=true` (Agicash-to-Agicash payments), the user's `defaultCurrency` is used (may be USD with exchange rate conversion).

## Server vs Client

The server creates quotes but **cannot read or update them**:

| Capability | Server | Client |
|-----------|--------|--------|
| Create quotes | Yes | Yes |
| Read/decrypt quotes | No | Yes |
| Update quotes | No | Yes |
| Has user's private key | No | Yes |

Sensitive data is encrypted to the user's **public encryption key** before storage. Only the client (holding the private key from BIP39 seed) can decrypt.

The verify URL contains an XChaCha20-Poly1305 encrypted blob (server-side `LNURL_SERVER_ENCRYPTION_KEY`) with quote type, ID, and mint URL — prevents external clients from inspecting quote details.

## Files

```
app/features/receive/
├── lightning-address-service.ts                 # Central orchestrator (all 3 LNURL steps)
├── cashu-receive-quote-service.server.ts        # Server-side Cashu quote creation
├── cashu-receive-quote-repository.server.ts     # Server-side Cashu DB persistence
├── spark-receive-quote-service.server.ts        # Server-side Spark quote creation
├── spark-receive-quote-repository.server.ts     # Server-side Spark DB persistence

app/routes/
├── [.]well-known.lnurlp.$username.ts            # LUD-16 discovery
├── api.lnurlp.callback.$userId.ts               # LUD-06 callback (invoice creation)
└── api.lnurlp.verify.$encryptedQuoteData.ts     # LUD-21 verification
```
