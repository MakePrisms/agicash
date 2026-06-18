import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from '../../errors';
import { classify } from '../classify';
import type { Database } from '../db/database';
import type { Contact, UserProfile } from '../../types/contact';

type ContactRow = Database['wallet']['Tables']['contacts']['Row'];

/** Data access for `wallet.contacts`. CRUD + username-candidate search; lud16 derived from `domain`. */
export class ContactRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly domain: string,
  ) {}

  async get(contactId: string): Promise<Contact | null> {
    const { data, error } = await this.db
      .from('contacts')
      .select()
      .eq('id', contactId)
      .maybeSingle();
    if (error) throw classify(error);
    return data ? ContactRepository.toContact(data, this.domain) : null;
  }

  async getAll(ownerId: string): Promise<Contact[]> {
    const { data, error } = await this.db
      .from('contacts')
      .select()
      .eq('owner_id', ownerId)
      .limit(150)
      .order('username', { ascending: true });
    if (error) throw classify(error);
    return (data ?? []).map((c) => ContactRepository.toContact(c, this.domain));
  }

  async create(contact: {
    ownerId: string;
    username: string;
  }): Promise<Contact> {
    const { data, error } = await this.db
      .from('contacts')
      .insert({ owner_id: contact.ownerId, username: contact.username })
      .select()
      .single();
    if (error) {
      if (error.hint === 'LIMIT_REACHED') {
        throw new DomainError(
          `${error.message} ${error.details}`,
          'CONTACTS_LIMIT_REACHED',
        );
      }
      throw classify(error);
    }
    return ContactRepository.toContact(data, this.domain);
  }

  async delete(contactId: string): Promise<void> {
    const { error } = await this.db
      .from('contacts')
      .delete()
      .eq('id', contactId);
    if (error) throw classify(error);
  }

  async findContactCandidates(
    query: string,
    currentUserId: string,
  ): Promise<UserProfile[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];

    const { data, error } = await this.db.rpc('find_contact_candidates', {
      partial_username: trimmed,
      current_user_id: currentUserId,
    });
    if (error) throw classify(error);
    return (data ?? []).map((u) => ({
      id: u.id,
      username: u.username,
      lud16: `${u.username}@${this.domain}`,
    }));
  }

  static toContact(dbContact: ContactRow, domain: string): Contact {
    const username = dbContact.username ?? '';
    return {
      id: dbContact.id,
      createdAt: new Date(dbContact.created_at),
      ownerId: dbContact.owner_id,
      username,
      lud16: `${username}@${domain}`,
    };
  }
}
