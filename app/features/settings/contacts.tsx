import { useState } from 'react';
import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderItem,
  PageHeaderTitle,
} from '~/components/page';
import { AddContactDrawer, ContactsList } from '~/features/contacts';
import { SearchBar } from '../../components/search-bar';

export default function Contacts() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <>
      <PageHeader>
        <PageBackButton
          to="/settings"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Contacts</PageHeaderTitle>
        <PageHeaderItem position="right">
          <AddContactDrawer />
        </PageHeaderItem>
      </PageHeader>
      <PageContent className="overflow-hidden">
        <SearchBar onSearch={setSearchQuery} placeholder="Search contacts..." />

        <ContactsList searchQuery={searchQuery} />
      </PageContent>
    </>
  );
}
