import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import { useContact } from '~/features/contacts/contact-hooks';
import { SingleContact } from '~/features/settings/contact';
import type { Route } from './+types/_protected.settings.contacts.$contactId';

export default function ContactsPage({ params }: Route.ComponentProps) {
  const contactId = params.contactId;
  const contact = useContact(contactId);

  if (!contact) {
    return <Redirect to="/settings/contacts" />;
  }

  return (
    <Page>
      <SingleContact contact={contact} />
    </Page>
  );
}
