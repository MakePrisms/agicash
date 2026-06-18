import type { ContactsDomain } from '../../domains';
import { SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import type { ContactRepository } from '../../internal/repositories/contact-repository';
import type { DomainContext } from '../context';

/** Build the contacts domain over the shared context (CRUD + username search). */
export function createContactsDomain(
  ctx: DomainContext,
  repo: ContactRepository,
): ContactsDomain {
  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  return {
    async list() {
      return repo.getAll(await requireUserId());
    },

    get(id) {
      return repo.get(id);
    },

    async add({ username }) {
      const ownerId = await requireUserId();
      const contact = await repo.create({ ownerId, username });
      ctx.emitter.emit('contact:created', { contact });
      return contact;
    },

    async remove(contact) {
      await repo.delete(contact.id);
      ctx.emitter.emit('contact:deleted', { contactId: contact.id });
    },

    async search({ query }) {
      const userId = await requireUserId();
      return repo.findContactCandidates(query, userId);
    },
  };
}
