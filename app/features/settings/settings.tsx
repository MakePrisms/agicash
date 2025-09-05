import { Copy, Edit, Share, Users } from 'lucide-react';
import { useLocation } from 'react-router';
import { useCopyToClipboard } from 'usehooks-ts';
import DiscordLogo from '~/assets/discord_logo.svg';
import GithubLogo from '~/assets/github.svg';
import NostrLogo from '~/assets/nostr_logo.svg';
import XLogo from '~/assets/x_logo.svg';
import {
  ClosePageButton,
  PageContent,
  PageFooter,
  PageHeader,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { SettingsNavButton } from '~/features/settings/ui/settings-nav-button';
import useLocationData from '~/hooks/use-location';
import { useToast } from '~/hooks/use-toast';
import { canShare, shareContent } from '~/lib/share';
import { LinkWithViewTransition } from '~/lib/transitions';
import { cn } from '~/lib/utils';
import { useDefaultAccount } from '../accounts/account-hooks';
import { AccountTypeIcon } from '../accounts/account-icons';
import { ColorModeToggle } from '../theme/color-mode-toggle';
import { useSignOut } from '../user/auth';
import { useUser } from '../user/user-hooks';

function LnAddressDisplay({
  username,
  domain,
}: { username: string; domain: string }) {
  const { toast } = useToast();
  const [_, copyToClipboard] = useCopyToClipboard();

  const lightningAddress = `${username}@${domain}`;

  const handleCopyLightningAddress = async () => {
    try {
      await copyToClipboard(lightningAddress);
      toast({
        title: 'Lightning address copied to clipboard',
        duration: 1000,
      });
    } catch {
      toast({
        title: 'Unable to copy to clipboard',
        variant: 'destructive',
        duration: 1000,
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopyLightningAddress}
      className="flex w-full items-center justify-between"
    >
      <div
        className={cn(
          // These lengths are based on a screen width of 375px. We shrink the font size
          // as the username gets longer so that it all fits on a single line. text-lg
          // is the smallest font size, then we just truncate
          'mr-1 truncate',
          lightningAddress.length > 23
            ? 'text-lg'
            : lightningAddress.length > 18
              ? 'text-xl'
              : 'text-2xl',
        )}
      >
        <span>{username}</span>
        <span className="text-muted-foreground/50">@{domain}</span>
      </div>
      <Copy className="ml-2 h-4 w-4 shrink-0" />
    </button>
  );
}

export default function Settings() {
  const { isSigningOut, signOut } = useSignOut();
  const defaultAccount = useDefaultAccount();
  const username = useUser((s) => s.username);
  const location = useLocation();

  const { domain } = useLocationData();
  const lightningAddress = `${username}@${domain}`;

  const handleShare = async () => {
    const data = {
      text: `Pay me to my Agicash Lightning Address at ${lightningAddress}`,
    };
    await shareContent(data);
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton to="/" transition="slideRight" applyTo="oldView" />
        {canShare() && (
          <button type="button" onClick={handleShare} className="px-1">
            <Share />
          </button>
        )}
      </PageHeader>

      <PageContent>
        <LnAddressDisplay username={username} domain={domain} />
        <SettingsNavButton to="/settings/profile/edit">
          <Edit />
          <span>Edit profile</span>
        </SettingsNavButton>

        <SettingsNavButton to="/settings/accounts">
          <AccountTypeIcon type={defaultAccount.type} />
          <span>{defaultAccount.name}</span>
        </SettingsNavButton>

        <SettingsNavButton to="/settings/contacts">
          <Users />
          Contacts
        </SettingsNavButton>
      </PageContent>

      <PageFooter className="mx-auto flex w-36 flex-col gap-6 pb-10">
        <Button
          className="mx-auto w-full"
          onClick={signOut}
          loading={isSigningOut}
        >
          Sign Out
        </Button>

        <ColorModeToggle />

        <div className="flex w-full justify-between text-muted-foreground text-sm">
          <LinkWithViewTransition
            to={{
              pathname: '/terms',
              search: `redirectTo=${location.pathname}`,
            }}
            transition="slideUp"
            applyTo="newView"
            className="underline"
          >
            Terms
          </LinkWithViewTransition>
          <span>&</span>
          <LinkWithViewTransition
            to={{
              pathname: '/privacy',
              search: `redirectTo=${location.pathname}`,
            }}
            transition="slideUp"
            applyTo="newView"
            className="underline"
          >
            Privacy
          </LinkWithViewTransition>
        </div>
        <div className="flex w-full justify-between">
          <a
            href="https://x.com/boardwalk_cash"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={XLogo} alt="X" className="h-5 w-5 invert" />
          </a>
          <a
            href="https://njump.me/nprofile1qqsw3u8v7rz83txuy8nc0eth6rsqh4z935fs3t6ugwc7364gpzy5psce64r7c"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={NostrLogo} alt="Nostr" className="h-5 w-5" />
          </a>
          <a
            href="https://github.com/MakePrisms/agicash"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={GithubLogo} alt="GitHub" className="h-5 w-5 invert" />
          </a>
          <a
            href="https://discord.gg/e2TSCfXxhd"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={DiscordLogo} alt="Discord" className="h-5 w-5 invert" />
          </a>
        </div>
      </PageFooter>
    </>
  );
}
