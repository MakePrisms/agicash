import { useState } from 'react';
import { PageContent } from '~/components/page';
import { AddContactDrawer, ContactsList } from '~/features/contacts';
import { SettingsViewHeader } from '~/features/settings/ui/settings-view-header';
import { SearchBar } from '../../components/search-bar';

export default function Contacts() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <>
      <SettingsViewHeader
        title="Contacts"
        navBack={{
          to: '/settings',
          transition: 'slideRight',
          applyTo: 'oldView',
        }}
      >
        <AddContactDrawer />
      </SettingsViewHeader>
      <PageContent className="overflow-hidden">
        <SearchBar onSearch={setSearchQuery} placeholder="Search contacts..." />

        <ContactsList searchQuery={searchQuery} />
      </PageContent>
    </>
  );
}
