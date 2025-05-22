import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '~/components/ui/drawer';
import { useToast } from '~/hooks/use-toast';
import { SearchBar } from '../../components/search-bar';
import { getErrorMessage } from '../shared/error';
import type { UserProfile } from '../user/user';
import { ContactAvatar } from './contact-avatar';
import { useCreateContact, useFindContactCandidates } from './contact-hooks';

export function AddContactDrawer() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const createContact = useCreateContact();
  const [searchQuery, setSearchQuery] = useState('');
  const { data: results, isFetching } = useFindContactCandidates(searchQuery);

  const handleAddContact = async (username: string) => {
    try {
      await createContact({ username });
      setOpen(false);
      toast({
        title: 'Contact added',
        description: username,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error adding contact',
        description: getErrorMessage(error),
      });
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button size="icon" variant="ghost">
          <Plus className="h-4 w-4" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="h-[90dvh] font-primary">
        <DrawerHeader className="space-y-2">
          <DrawerTitle className="text-center">Add Contact</DrawerTitle>
        </DrawerHeader>
        <div className="mx-auto flex h-full w-full max-w-sm flex-col gap-3 px-4 sm:px-0">
          <SearchBar
            onSearch={setSearchQuery}
            placeholder="satoshi"
            debounceTime={300}
            isLoading={isFetching}
          />
          <SearchResults results={results} onAddContact={handleAddContact} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
function SearchResults({
  results,
  onAddContact,
}: {
  results: UserProfile[];
  onAddContact: (username: string) => Promise<void>;
}) {
  const [selectedContact, setSelectedContact] = useState<UserProfile | null>(
    null,
  );

  if (!results || results.length === 0) {
    return (
      <div className="py-6 text-center text-muted-foreground">
        {!results ? 'Search by username' : 'No Results'}
      </div>
    );
  }

  return (
    <div className="relative h-full py-6">
      <div className="flex flex-col gap-6 pb-16">
        {results.map((searchResult) => (
          <button
            key={searchResult.username}
            className="flex w-full items-center gap-3 rounded-lg"
            onClick={() =>
              setSelectedContact(
                selectedContact?.username === searchResult.username
                  ? null
                  : searchResult,
              )
            }
            type="button"
          >
            <ContactAvatar username={searchResult.username} size="sm" />
            <span className="font-medium">{searchResult.username}</span>
            {selectedContact?.username === searchResult.username && (
              <Check className="ml-auto h-4 w-4 text-foreground" />
            )}
          </button>
        ))}
      </div>
      {selectedContact && (
        <Button
          onClick={() => onAddContact(selectedContact.username)}
          className="fixed right-0 bottom-16 left-0 mx-auto flex w-fit max-w-xs"
        >
          Add
        </Button>
      )}
    </div>
  );
}
