import { AtSign } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

type MentionDropdownProps = {
  username: string;
  pubkey: string;
  onMention: (username: string, pubkey: string) => void;
  children: React.ReactNode;
};

/**
 * Dropdown component for mentioning users in chat
 */
export function MentionDropdown({
  username,
  pubkey,
  onMention,
  children,
}: MentionDropdownProps) {
  const handleMention = () => {
    onMention(username, pubkey);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="mt-2">
        <DropdownMenuItem
          onClick={handleMention}
          className="flex cursor-pointer items-center gap-2"
        >
          <AtSign className="h-4 w-4" />
          <span>Mention</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
