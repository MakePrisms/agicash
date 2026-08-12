# Wallet SDK Contacts Slice (Step 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Orchestration note for this plan:** tasks 1–3 are delivered via maxplayer marketplace contribution jobs; task text below doubles as the self-contained job spec. Tasks 0 and 4 run locally.

**Goal:** Wire the `contacts` namespace of the SDK contract and flip the web contacts feature from `@agicash/wallet-sdk/temporary` to `sdk.contacts.*`.

**Architecture:** Step 7 of the 19-step no-cache extraction (spec: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`). The already-moved `domain/contacts` code gets a thin session-fenced API wrapper (`createContactsApi`), the `AgicashSdk` constructor wires it (replacing the `NotImplementedError` getter), and the web hooks call `sdk.contacts.*`. Web keeps its TanStack cache and its realtime invalidation layer (flips in step 18).

**Tech Stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global Constraints

- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- Do not touch other domains' `/temporary` imports — only contacts files listed here.
- The web realtime invalidation layer stays as-is: `useContactChangeHandlers` keeps its `ContactRepository.toContact` + `AgicashDbContact` `/temporary` imports until step 18 (accounts precedent).
- No event emission from `ContactsApi`. `contact.created`/`contact.deleted` stay type-only until the step-18 realtime feed.
- Package manager: `bun` / `bunx` only.
- Base branch: `master`. Work branch: `sdk/contacts-slice`.
- No DB schema changes, no dependency changes.
- `packages/wallet-sdk/domain/sdk/sdk.test.ts` has no contacts assertions — leave it untouched.

## Resolved design decisions

1. `findContactCandidates(query)` returns `Promise<UserProfile[]>` (`{id, username}`), matching the live repository return. Deviation from the step-4 proposal's `Promise<Contact[]>` — candidates are not contacts; no contact id exists before `create`.
2. `CreateContactParams = { username: string }`; `ownerId` comes from the session (contract projection rule).
3. `ContactRepository.get` switches to `.maybeSingle()` and returns `null` on missing (contract: `Contact | null`). It also gains the `abortSignal` options bag for fence parity.
4. The API strips `ownerId` at runtime (`Contact = Omit<DomainContact, 'ownerId'>`).
5. Contacts rows are plaintext — no encryption keys. `keys: SessionKeys` is used only for the session fence (`sessionSignal()`), same `Deps` shape as accounts.
6. Repository is constructed once per API (db + domain are process-stable; unlike accounts there is no session-scoped key material in the constructor).
7. Smoke gate: app boots; contacts list, candidate search, create, delete work. No edit path exists (contacts are immutable per spec).

## Execution deviations (discovered during integration)

1. **`packages/wallet-sdk/index.ts` shadow.** The explicit `export type { Contact } from './domain/contacts/contact'` shadowed the contract projection (the file's own header documents that each slice deletes its names when it flips). The plan's original "no index.ts changes" constraint was wrong; the shadow export was deleted so the public `Contact` surfaces. After deviation 2's entity collapse removed the projection, review restored the line as the sole origin — it no longer shadows anything.
2. **Runtime `ownerId` strip (resolved decision 4) — superseded in review: the entity field is deleted.** The send flow also consumes `Contact` (`send-store.selectDestination` → `resolveSendDestination`), invisible to a `features/contacts` consumer search because it imports the type from the package root; the integration pass therefore kept domain objects as-is, and review first restored the api-boundary strip. Review follow-up went further: nothing reads `contact.ownerId` (its only writer was `toContact`; every other `ownerId` site is an input param — `CreateContact`, the `getAll` filter), so the field is deleted from the domain entity. One `Contact` type remains, exported from root `index.ts` (the domain-type list); the contract file imports it for its signatures only. The api returns repository objects unchanged, and the web realtime echo (`toContact`) produces the exact contract shape.
3. **Contact seam in `resolve-destination.ts`.** Its `string | Contact` input retyped to the public projection so public-typed callers compile. The zod `isContact` guard is replaced by `typeof input !== 'string'` narrowing — a host-built, public-shaped contact (legitimately without `ownerId`) must not fail resolution and fall into string parsing. `isContact`, left without consumers, is deleted from `domain/contacts/contact.ts`. After the entity collapse (deviation 2) the schema matches the seam shape again, so review restored the guard in place of the `typeof` narrowing — a positive guard keeps the else-branch honest if the input union ever gains a third member.

## Delegation map (maxplayer)

| Task | Route | Est. cost |
|---|---|---|
| 0 branch + plan commit | local | — |
| 1 canary: prune `isContact` temporary export | marketplace, budget seller | ~5–10 sats |
| 2 SDK: contract + repository.get + contacts-api + tests + sdk.ts wiring | marketplace, top-tier seller | ~100 sats |
| 3 web flip: contact-hooks → sdk.contacts, delete contact-repository-hooks | marketplace, budget seller | ~2–20 sats |
| 4 integration, gates, smoke, PR | local | — |

Contribution-mode mechanics: each job pins `base_oid` to the pushed tip of `sdk/contacts-slice`; jobs run sequentially (2 needs 1's tip only for a clean chain; 3 needs 2's contract types). Verify after collect, before merge: run the gates locally. Failed deliveries: log, re-route or do locally.

## File map

- Create: `packages/wallet-sdk/domain/contacts/contacts-api.ts`
- Create: `packages/wallet-sdk/domain/contacts/contacts-api.test.ts`
- Modify: `packages/wallet-sdk/domain/sdk/contacts.ts` (contract fill)
- Modify: `packages/wallet-sdk/domain/contacts/contact-repository.ts:19-29` (`get` → maybeSingle + options)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.ts` (wire namespace)
- Modify: `packages/wallet-sdk/temporary.ts:115` (drop `isContact` export)
- Modify: `apps/web-wallet/app/features/contacts/contact-hooks.ts` (flip to `sdk.contacts`)
- Delete: `apps/web-wallet/app/features/contacts/contact-repository-hooks.ts`
- Modify: `packages/wallet-sdk/index.ts` (delete the domain-`Contact` shadow export — see deviations)
- Modify: `packages/wallet-sdk/domain/send/resolve-destination.ts` + `domain/contacts/contact.ts` (contact seam — see deviations)
- Untouched on purpose: `domain/sdk/events.ts`, `domain/sdk/index.ts`, `sdk.test.ts`, web routes/components, `use-track-wallet-changes.ts`, `sdk.client.ts` (already passes `lightningAddressDomain`).

---

### Task 0: Branch + plan commit (LOCAL)

**Files:**
- Create: `docs/superpowers/plans/2026-08-11-wallet-sdk-contacts-slice.md` (this file)

- [ ] **Step 1: Create the branch off master**

```bash
git checkout master && git pull && git checkout -b sdk/contacts-slice
```

- [ ] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-08-11-wallet-sdk-contacts-slice.md
git commit -m "docs(wallet-sdk): contacts-slice plan (step 7)"
```

- [ ] **Step 3: Push the branch (contribution jobs fetch pinned oids from origin)**

```bash
git push -u origin sdk/contacts-slice
```

---

### Task 1: Canary — prune the unused `isContact` temporary export (MARKETPLACE, budget)

**Files:**
- Modify: `packages/wallet-sdk/temporary.ts:115`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new. `isContact` remains exported from `packages/wallet-sdk/domain/contacts/contact.ts` for SDK-internal use (`domain/send/resolve-destination.ts`).

**Context for the implementer:** `temporary.ts` is a transitional export surface. `rg -n "isContact" apps/` returns no hits — the web app never imports it, so the re-export is dead.

- [ ] **Step 1: Delete the export line**

In `packages/wallet-sdk/temporary.ts` delete exactly this line (line 115):

```ts
export { isContact } from './domain/contacts/contact';
```

Keep the next line (`export { ContactRepository } ...`) — the web realtime handler still imports it.

- [ ] **Step 2: Verify no importer broke**

Run: `rg -n "isContact" apps/ packages/wallet-sdk/temporary.ts`
Expected: no output from either path.

Run: `bun run fix:all && bun run typecheck`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-sdk/temporary.ts
git commit -m "chore(wallet-sdk): drop the unused isContact temporary export"
```

---

### Task 2: SDK contacts namespace (MARKETPLACE, top-tier)

**Files:**
- Modify: `packages/wallet-sdk/domain/sdk/contacts.ts`
- Modify: `packages/wallet-sdk/domain/contacts/contact-repository.ts` (only the `get` method)
- Create: `packages/wallet-sdk/domain/contacts/contacts-api.test.ts`
- Create: `packages/wallet-sdk/domain/contacts/contacts-api.ts`
- Modify: `packages/wallet-sdk/domain/sdk/sdk.ts`

**Interfaces:**
- Consumes: `SessionKeys` (`sessionSignal(): AbortSignal`, `reset()`, `dispose()`) from `domain/sdk/session-keys.ts`; `NoSessionError`, `SessionEndedError` from `lib/error.ts`; `AuthSession` from `domain/sdk/auth.ts`; `ContactRepository` from `domain/contacts/contact-repository.ts`; `UserProfile` from `domain/user/user.ts`.
- Produces: `createContactsApi(deps): ContactsApi` (used by `sdk.ts`); contract types `Contact` (public), `CreateContactParams`, `ContactsApi.findContactCandidates(query): Promise<UserProfile[]>` (used by Task 3's web flip).

- [ ] **Step 1: Fill the contract** — replace the whole content of `packages/wallet-sdk/domain/sdk/contacts.ts` with:

```ts
import type { Contact as DomainContact } from '../contacts/contact';
import type { UserProfile } from '../user/user';

export type Contact = Omit<DomainContact, 'ownerId'>;

export type ContactsApi = {
  get(id: string): Promise<Contact | null>;
  list(): Promise<Contact[]>;
  create(params: CreateContactParams): Promise<Contact>;
  delete(id: string): Promise<void>;
  /**
   * Users that match the partial username (minimum 3 characters after trim)
   * and are not already contacts of the current user. Candidates are user
   * profiles, not contacts — a contact id exists only after `create`.
   */
  findContactCandidates(query: string): Promise<UserProfile[]>;
};

export type CreateContactParams = {
  /** Username of the user within this app to add as a contact. */
  username: string;
};
```

- [ ] **Step 2: Make `ContactRepository.get` null-safe** — in `packages/wallet-sdk/domain/contacts/contact-repository.ts` replace:

```ts
  async get(contactId: string) {
    const query = this.db.from('contacts').select().eq('id', contactId);

    const { data, error } = await query.single();

    if (error) {
      throw new Error('Failed to get contact', error);
    }

    return ContactRepository.toContact(data, this.domain);
  }
```

with:

```ts
  async get(
    contactId: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Contact | null> {
    const query = this.db.from('contacts').select().eq('id', contactId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get contact', error);
    }

    return data ? ContactRepository.toContact(data, this.domain) : null;
  }
```

- [ ] **Step 3: Write the failing tests** — create `packages/wallet-sdk/domain/contacts/contacts-api.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import type { AgicashDb } from '../../db/database';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { AuthSession, AuthUser } from '../sdk';
import { createSessionKeys } from '../sdk/session-keys';
import type { Contact as DomainContact } from './contact';
import type { ContactRepository } from './contact-repository';
import { createContactsApi } from './contacts-api';

const authUser = (id: string): AuthUser =>
  ({
    id,
    name: null,
    email: 'a@b.c',
    email_verified: true,
    login_method: 'email',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }) as AuthUser;

const loggedIn = (id: string): AuthSession => ({
  isLoggedIn: true,
  user: authUser(id),
});

const domainContact = (
  overrides: Partial<DomainContact> = {},
): DomainContact => ({
  id: 'contact-1',
  createdAt: '2026-01-01T00:00:00Z',
  ownerId: 'user-x',
  username: 'satoshi',
  lud16: 'satoshi@agi.cash',
  ...overrides,
});

const publicContact = {
  id: 'contact-1',
  createdAt: '2026-01-01T00:00:00Z',
  username: 'satoshi',
  lud16: 'satoshi@agi.cash',
};

const makeApi = (deps: {
  session: AuthSession;
  repository?: Partial<ContactRepository>;
}) =>
  createContactsApi({
    db: {} as unknown as AgicashDb,
    keys: createSessionKeys(),
    getSession: () => deps.session,
    lightningAddressDomain: 'agi.cash',
    createRepository: () =>
      (deps.repository ?? {}) as unknown as ContactRepository,
  });

describe('createContactsApi', () => {
  describe('list', () => {
    it('lists the session user contacts without ownerId', async () => {
      let requestedUserId: string | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          getAll: (async (userId: string) => {
            requestedUserId = userId;
            return [
              domainContact(),
              domainContact({ id: 'contact-2', username: 'hal' }),
            ];
          }) as ContactRepository['getAll'],
        },
      });

      const contacts = await api.list();

      expect(requestedUserId).toBe('user-x');
      expect(contacts).toHaveLength(2);
      expect(contacts[0]).toEqual(publicContact);
      expect(Object.keys(contacts[0])).not.toContain('ownerId');
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.list()).rejects.toBeInstanceOf(NoSessionError);
    });

    it('rejects with SessionEndedError and issues no read after dispose', async () => {
      const keys = createSessionKeys();
      let getAllCalls = 0;
      const api = createContactsApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        lightningAddressDomain: 'agi.cash',
        createRepository: () =>
          ({
            getAll: (async () => {
              getAllCalls += 1;
              return [];
            }) as ContactRepository['getAll'],
          }) as unknown as ContactRepository,
      });

      keys.dispose();

      await expect(api.list()).rejects.toBeInstanceOf(SessionEndedError);
      expect(getAllCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the read', async () => {
      const keys = createSessionKeys();
      const api = createContactsApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        lightningAddressDomain: 'agi.cash',
        createRepository: () =>
          ({
            getAll: (async () => {
              keys.reset();
              return [domainContact()];
            }) as ContactRepository['getAll'],
          }) as unknown as ContactRepository,
      });

      await expect(api.list()).rejects.toBeInstanceOf(SessionEndedError);
    });
  });

  describe('get', () => {
    it('returns the contact without ownerId', async () => {
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () => domainContact()) as ContactRepository['get'],
        },
      });

      const contact = await api.get('contact-1');

      expect(contact).toEqual(publicContact);
    });

    it('returns null when the contact does not exist', async () => {
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () => null) as ContactRepository['get'],
        },
      });

      await expect(api.get('missing')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('injects the session userId as ownerId and returns the public contact', async () => {
      let created: Record<string, unknown> | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          create: (async (input: Record<string, unknown>) => {
            created = input;
            return domainContact();
          }) as unknown as ContactRepository['create'],
        },
      });

      const contact = await api.create({ username: 'satoshi' });

      expect(created?.ownerId).toBe('user-x');
      expect(created?.username).toBe('satoshi');
      expect(contact).toEqual(publicContact);
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.create({ username: 'x' })).rejects.toBeInstanceOf(
        NoSessionError,
      );
    });
  });

  describe('delete', () => {
    it('delegates to the repository with the contact id', async () => {
      let deletedId: string | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          delete: (async (contactId: string) => {
            deletedId = contactId;
          }) as ContactRepository['delete'],
        },
      });

      await api.delete('contact-1');

      expect(deletedId).toBe('contact-1');
    });
  });

  describe('findContactCandidates', () => {
    it('passes the query and session userId and returns profiles verbatim', async () => {
      let args: { query?: string; userId?: string } = {};
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          findContactCandidates: (async (query: string, userId: string) => {
            args = { query, userId };
            return [{ id: 'user-2', username: 'hal' }];
          }) as ContactRepository['findContactCandidates'],
        },
      });

      const candidates = await api.findContactCandidates('ha');

      expect(args).toEqual({ query: 'ha', userId: 'user-x' });
      expect(candidates).toEqual([{ id: 'user-2', username: 'hal' }]);
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.findContactCandidates('ha')).rejects.toBeInstanceOf(
        NoSessionError,
      );
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd packages/wallet-sdk && bun test contacts-api`
Expected: FAIL — cannot resolve `./contacts-api`.

- [ ] **Step 5: Implement the API** — create `packages/wallet-sdk/domain/contacts/contacts-api.ts`:

```ts
import type { AgicashDb } from '../../db/database';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { AuthSession, Contact, ContactsApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import type { Contact as DomainContact } from './contact';
import { ContactRepository } from './contact-repository';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** lud16 domain the repository stamps onto contacts. */
  lightningAddressDomain: string;
  /** Test seam; defaults to building the repository from db + domain. */
  createRepository?: () => ContactRepository;
};

export function createContactsApi(deps: Deps): ContactsApi {
  const repository =
    deps.createRepository?.() ??
    new ContactRepository(deps.db, deps.lightningAddressDomain);

  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const requireLiveSignal = (): AbortSignal => {
    const signal = deps.keys.sessionSignal();
    if (signal.aborted) {
      throw new SessionEndedError();
    }
    return signal;
  };

  const toPublicContact = (contact: DomainContact): Contact => {
    const { ownerId: _ownerId, ...publicContact } = contact;
    return publicContact;
  };

  return {
    get: async (id) => {
      const signal = requireLiveSignal();
      const contact = await repository.get(id, { abortSignal: signal });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return contact ? toPublicContact(contact) : null;
    },
    list: async () => {
      const userId = requireUserId();
      const signal = requireLiveSignal();
      const contacts = await repository.getAll(userId, {
        abortSignal: signal,
      });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return contacts.map(toPublicContact);
    },
    create: async (params) => {
      const userId = requireUserId();
      const signal = requireLiveSignal();
      const contact = await repository.create(
        { ownerId: userId, username: params.username },
        { abortSignal: signal },
      );
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return toPublicContact(contact);
    },
    delete: async (id) => {
      const signal = requireLiveSignal();
      await repository.delete(id, { abortSignal: signal });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
    },
    findContactCandidates: async (query) => {
      const userId = requireUserId();
      const signal = requireLiveSignal();
      const candidates = await repository.findContactCandidates(query, userId, {
        abortSignal: signal,
      });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return candidates;
    },
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/wallet-sdk && bun test contacts-api`
Expected: PASS, 11 tests.

- [ ] **Step 7: Wire the namespace in `packages/wallet-sdk/domain/sdk/sdk.ts`**

7a. Add the import (after the `createAccountsApi` import):

```ts
import { createContactsApi } from '../contacts/contacts-api';
```

7b. Replace the throwing getter

```ts
  get contacts(): ContactsApi {
    throw new NotImplementedError('contacts');
  }
```

with a readonly field, placed after `readonly accounts: AccountsApi;`:

```ts
  readonly contacts: ContactsApi;
```

7c. In the constructor's final assignment block, insert after `this.accounts = accounts.api;`:

```ts
    this.contacts = createContactsApi({
      db,
      getSession: getLiveSession,
      keys,
      lightningAddressDomain: config.lightningAddressDomain,
    });
```

`NotImplementedError` stays imported (other getters still throw it).

- [ ] **Step 8: Full package gate**

Run: `cd packages/wallet-sdk && bun test && bun run typecheck`
Expected: all tests pass (existing suite + 11 new), tsc exit 0.

Run (repo root): `bun run fix:all`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/wallet-sdk/domain/sdk/contacts.ts packages/wallet-sdk/domain/contacts/ packages/wallet-sdk/domain/sdk/sdk.ts
git commit -m "feat(wallet-sdk): contacts namespace — contract params, session-fenced api, sdk wiring"
```

---

### Task 3: Web flip — contacts hooks onto `sdk.contacts` (MARKETPLACE, budget)

**Files:**
- Modify: `apps/web-wallet/app/features/contacts/contact-hooks.ts`
- Delete: `apps/web-wallet/app/features/contacts/contact-repository-hooks.ts`

**Interfaces:**
- Consumes: `sdk.contacts.list(): Promise<Contact[]>`, `sdk.contacts.create({ username }): Promise<Contact>`, `sdk.contacts.delete(id): Promise<void>`, `sdk.contacts.findContactCandidates(query): Promise<UserProfile[]>` — from Task 2, via the `sdk` singleton at `~/features/shared/sdk.client`.
- Produces: unchanged hook signatures — `useContacts(select?)`, `useContact(id)`, `useCreateContact()`, `useDeleteContact()`, `useFindContactCandidates(query)`, `useContactsCache()`, `useContactChangeHandlers()`. Consumers (`contacts-list.tsx`, `add-contact-drawer.tsx`, `settings/contact.tsx`, `use-track-wallet-changes.ts`, `_protected.settings.contacts.$contactId.tsx`) need no edits.

**Hard constraints:** `useContactChangeHandlers` and `ContactsCache` stay byte-identical (realtime layer flips in step 18). Query keys, staleTime, and refetch options stay identical. Do not edit any other file.

- [ ] **Step 1: Replace the whole content of `apps/web-wallet/app/features/contacts/contact-hooks.ts` with:**

```ts
import type { Contact } from '@agicash/wallet-sdk';
import type { AgicashDbContact } from '@agicash/wallet-sdk/temporary';
import { ContactRepository } from '@agicash/wallet-sdk/temporary';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { sdk } from '~/features/shared/sdk.client';
import useLocationData from '~/hooks/use-location';
export class ContactsCache {
  public static Key = 'contacts';

  constructor(private readonly queryClient: QueryClient) {}

  /**
   * Adds a contact to the cache.
   * @param contact - The contact to add.
   */
  add(contact: Contact) {
    this.queryClient.setQueryData<Contact[]>([ContactsCache.Key], (curr) => [
      ...(curr ?? []),
      contact,
    ]);
  }

  /**
   * Gets all contacts in the cache for the current user.
   * @returns The list of contacts.
   */
  getAll() {
    return this.queryClient.getQueryData<Contact[]>([ContactsCache.Key]);
  }

  /**
   * Get a contact by id.
   * @param id - The id of the contact.
   * @returns The contact or null if the contact is not found.
   */
  get(id: string) {
    const contacts = this.getAll();
    return contacts?.find((x) => x.id === id) ?? null;
  }

  /**
   * Removes a contact from the cache.
   * @param contactId - The id of the contact to remove.
   */
  remove(contactId: string) {
    this.queryClient.setQueryData<Contact[]>(
      [ContactsCache.Key],
      (curr) => curr?.filter((x) => x.id !== contactId) ?? [],
    );
  }

  /**
   * Invalidates the contacts cache.
   */
  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [ContactsCache.Key],
    });
  }
}

export function useContactsCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new ContactsCache(queryClient), [queryClient]);
}

/**
 * Hook for listing contacts for the current user with optional filtering
 */
export function useContacts(select?: (contacts: Contact[]) => Contact[]) {
  const { data: contacts } = useSuspenseQuery({
    queryKey: [ContactsCache.Key],
    queryFn: () => sdk.contacts.list(),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select,
  });

  return contacts;
}

export function useContact(contactId: string) {
  const contacts = useContacts();
  const contact = contacts.find((contact) => contact.id === contactId);
  if (!contact) {
    return null;
  }
  return contact;
}

export function useCreateContact() {
  const { mutateAsync: createContact } = useMutation({
    mutationKey: ['create-contact'],
    mutationFn: ({ username }: { username: string }) =>
      sdk.contacts.create({ username }),
  });

  return createContact;
}

export function useDeleteContact() {
  const { mutateAsync: deleteContact } = useMutation({
    mutationKey: ['delete-contact'],
    mutationFn: (contactId: string) => sdk.contacts.delete(contactId),
  });

  return deleteContact;
}

/**
 * @param query - The search query string
 * @return the query response containing any user profiles that match the query
 */
export function useFindContactCandidates(query: string) {
  return useQuery({
    queryKey: ['search-user-profiles', query],
    queryFn: () => sdk.contacts.findContactCandidates(query),
    initialData: [],
    initialDataUpdatedAt: () => Date.now() - 1000 * 6,
    staleTime: 1000 * 5,
  });
}

/**
 * Hook that returns a contact change handler.
 */
export function useContactChangeHandlers() {
  const contactsCache = useContactsCache();
  const { domain } = useLocationData();

  return [
    {
      event: 'CONTACT_CREATED',
      handleEvent: async (payload: AgicashDbContact) => {
        const contact = ContactRepository.toContact(payload, domain);
        contactsCache.add(contact);
      },
    },
    {
      event: 'CONTACT_DELETED',
      handleEvent: async (payload: AgicashDbContact) => {
        contactsCache.remove(payload.id);
      },
    },
  ];
}
```

- [ ] **Step 2: Delete the repository hook file**

```bash
git rm apps/web-wallet/app/features/contacts/contact-repository-hooks.ts
```

- [ ] **Step 3: Verify**

Run: `rg -n "useContactRepository|contact-repository-hooks" apps/`
Expected: no output.

Run: `cd apps/web-wallet && bun run typecheck`
Expected: exit 0.

Run (repo root): `bun run fix:all`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A apps/web-wallet/app/features/contacts/
git commit -m "feat(web): contacts hooks on sdk.contacts"
```

---

### Task 4: Integration, gates, smoke test, PR (LOCAL)

- [ ] **Step 1: Full gate at repo root**

```bash
bun run fix:all && bun run typecheck && bun run test
```
Expected: all exit 0; web + SDK suites green.

- [ ] **Step 2: Smoke test in the browser** (dev server + Chrome DevTools MCP)

1. `bun run dev`, open `http://127.0.0.1:3000`, sign in (guest ok).
2. Settings → Contacts: the list renders (Suspense resolves; empty state ok).
3. Add contact: search ≥3 chars, pick a candidate, Add → toast "Contact added"; contact appears in the list (realtime echo).
4. Open the contact → Remove Contact → toast; list drops it.
5. Console: no errors from `sdk.contacts.*` paths.

- [ ] **Step 3: Self-review the diff against master, then PR**

```bash
git push && gh pr create --base master --title "feat(wallet-sdk): contacts slice (step 7)" --body "<summary + gates + smoke evidence>"
```

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Lint/format | `bun run fix:all` | exit 0 |
| Types (4 pkgs) | `bun run typecheck` | exit 0 |
| Unit tests | `bun run test` | green (incl. 11 new contacts-api tests) |
| Smoke | manual, task 4 step 2 | list/search/create/delete work |
