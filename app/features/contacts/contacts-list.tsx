import { LoaderCircle } from 'lucide-react';
import { Suspense, useState } from 'react';
import { ScrollArea } from '~/components/ui/scroll-area';
import { LinkWithViewTransition } from '~/lib/transitions';
import type { Contact } from './contact';
import { ContactAvatar } from './contact-avatar';
import { useContacts } from './contact-hooks';

type ContactsListProps = {
  searchQuery?: string;
  onSelect?: (contact: Contact) => Promise<void>;
};

type ContactsListContentProps = {
  searchQuery: string;
  onSelect?: (contact: Contact) => Promise<void>;
};

type State = { status: 'idle' } | { status: 'selecting'; selected: Contact };

function ContactsListItems({
  searchQuery,
  onSelect,
}: ContactsListContentProps) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const contacts = useContacts((contacts) =>
    contacts.filter((contact) =>
      contact.username.toLowerCase().includes(searchQuery.toLowerCase()),
    ),
  );
  const hasContacts = contacts.length > 0;

  const handleClick = async (contact: Contact) => {
    setState({ status: 'selecting', selected: contact });
    await onSelect?.(contact);
    setState({ status: 'idle' });
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      {hasContacts ? (
        contacts.map((contact) =>
          onSelect ? (
            <button
              key={contact.id}
              className="flex w-full cursor-pointer items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              onClick={() => handleClick(contact)}
              type="button"
              disabled={state.status === 'selecting'}
            >
              <div className="flex w-full cursor-pointer items-center gap-3">
                {state.status === 'selecting' &&
                state.selected.id === contact.id ? (
                  <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : (
                  <ContactAvatar username={contact.username} size="sm" />
                )}
                <span className="font-medium">{contact.username}</span>
              </div>
            </button>
          ) : (
            <div
              key={contact.id}
              className=" flex items-center rounded-lg transition-colors"
            >
              <LinkWithViewTransition
                to={`/settings/contacts/${contact.id}`}
                transition="slideLeft"
                applyTo="oldView"
                className="flex w-full items-center gap-3"
              >
                <ContactAvatar username={contact.username} size="sm" />
                <span className="font-medium">{contact.username}</span>
              </LinkWithViewTransition>{' '}
            </div>
          ),
        )
      ) : (
        <div className="text-center text-muted-foreground">
          No contacts found
        </div>
      )}
    </div>
  );
}
export function ContactsList({
  searchQuery = '',
  onSelect,
}: ContactsListProps) {
  return (
    <ScrollArea className="flex h-full flex-1 flex-col" hideScrollbar>
      <Suspense
        fallback={
          <div className="flex flex-col gap-6 py-6">
            <div className="text-center text-muted-foreground">
              Loading contacts...
            </div>
          </div>
        }
      >
        <ContactsListItems searchQuery={searchQuery} onSelect={onSelect} />
      </Suspense>
    </ScrollArea>
  );
}
