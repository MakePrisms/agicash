import type { Contact } from '../contacts/contact';
import type { UserProfile } from '../user/user';

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
