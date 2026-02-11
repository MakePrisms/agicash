# Agicash Architecture

## Components

The Agicash wallet consists of the following components:
- Server
- Client
- Open Secret secure enclave
- Postgres DB

### Diagram

![Agicash Component Diagram](./images/agicash-architecture.jpg?raw=true "Component Diagram")

### Server

Serves the wallet code to the client. Additionally, for the purpose of processing requests that might happen when the client is offline (e.g. ln address service), it can read and write the data to the Postgres DB, but only non-sensitive data. The server is hosted on the Vercel platform.

### Client

This is the browser that runs the wallet. The client authenticates with the Open Secret platform to get the user's auth data, wallet seeds, mnemonics and the encryption keys. It then uses this data to initialize the Cashu and Spark wallets and read/write data to the Postgres DB. A logged-in user can only read their own data from the Postgres DB. Sensitive user data is encrypted and decrypted on the client side using the encryption keys fetched from Open Secret. The client also subscribes to realtime db data updates using Supabase Realtime.

### Open Secret secure enclave

Manages authentication, wallet seeds, mnemonics, data encryption keys, etc. This data is created in the enclave when a user creates the account and is only accessible to the user after successful authentication. This means that only the client, after the user provides the credentials, can get this data.

### Postgres DB

Stores the wallet data. Hosted on Supabase. User data is protected by RLS, so each user can read only their own data. Sensitive data is stored in the db encrypted with the user's encryption key and then decrypted with the same key on the client side. Changes to the data are sent to the client using Supabase Realtime.


### Component Interactions

![Agicash Component Interactions](./images/agicash-component-interactions.jpg?raw=true "Component Interactions Diagram")


## External Components

Additionally, the Agicash wallet communicates with the following external components:
- Cashu mints
- Spark system