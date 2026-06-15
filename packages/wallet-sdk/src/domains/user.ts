import type {
  ReadUserRepository,
  WriteUserRepository,
} from '../internal/db/user-repository';
import type { User } from './user-types';

type Deps = {
  readUserRepo: ReadUserRepository;
  writeUserRepo: WriteUserRepository;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `user` domain. `get()` is the current-user hot read (Promise-based in both
 * variants). setDefaultAccount / setDefaultCurrency are account-dependent (a DB
 * constraint requires a default account per currency) and are deferred to a later
 * plan alongside the accounts domain.
 */
export class UserDomain {
  constructor(private readonly deps: Deps) {}

  /** The current user, or null when signed out. */
  async get(): Promise<User | null> {
    const id = await this.deps.getCurrentUserId();
    if (!id) return null;
    return this.deps.readUserRepo.get(id);
  }

  async updateUsername(username: string): Promise<User> {
    const id = await this.requireUserId();
    return this.deps.writeUserRepo.update(id, { username });
  }

  async acceptTerms(): Promise<User> {
    const id = await this.requireUserId();
    return this.deps.writeUserRepo.update(id, {
      termsAcceptedAt: new Date().toISOString(),
    });
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
