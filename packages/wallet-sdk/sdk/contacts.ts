import type { Contact as DomainContact } from '../domain/contacts/contact';

export type Contact = Omit<DomainContact, 'ownerId'>;

export type ContactsApi = {
  get(id: string): Promise<Contact | null>;
  list(): Promise<Contact[]>;
  create(params: CreateContactParams): Promise<Contact>;
  delete(id: string): Promise<void>;
  findContactCandidates(query: string): Promise<Contact[]>;
};

export type CreateContactParams = unknown; // step 7 (contacts)
