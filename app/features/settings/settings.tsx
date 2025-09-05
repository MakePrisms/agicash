import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit,
  MessageSquare,
  Share,
  Users,
} from 'lucide-react';
import { useState } from 'react';
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
import { Input } from '~/components/ui/input';
import { SettingsNavButton } from '~/features/settings/ui/settings-nav-button';
import useLocationData from '~/hooks/use-location';
import { useRelaySelection } from '~/hooks/use-relay-selection';
// import { useRelayStatuses, type RelayStatusInfo } from '~/hooks/use-relay-statuses';
import { useToast } from '~/hooks/use-toast';
import { canShare, shareContent } from '~/lib/share';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { cn } from '~/lib/utils';
import { useDefaultAccount } from '../accounts/account-hooks';
import { AccountTypeIcon } from '../accounts/account-icons';
import { ColorModeToggle } from '../theme/color-mode-toggle';
import { useSignOut } from '../user/auth';
import { useUser } from '../user/user-hooks';

function ChatSettings({
  onSelectGeohash,
}: { onSelectGeohash?: (geohash: string) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [geohash, setGeohash] = useState('');
  const { closestRelays } = useRelaySelection(geohash);

  // Monitor relay statuses with debouncing (3 seconds)
  // const relayUrls = useMemo(() => closestRelays.map((relay) => relay.url), [closestRelays]);
  // const relayStatuses = useRelayStatuses(relayUrls, 800);

  // console.log('relayStatuses', relayStatuses);
  // console.log('closestRelays', closestRelays);
  // console.log('geohash', geohash);

  // Show ellipses when user has input and we have relays, until all statuses are determined
  // const hasConnectingRelays = geohash.trim() && closestRelays.length > 0 && relayStatuses.some(status => status.status === 'connecting');

  // console.log('hasConnectingRelays', hasConnectingRelays);

  // Helper function to get status for a specific relay
  // const getRelayStatus = (url: string) => {
  //   const statusInfo = relayStatuses.find((status: RelayStatusInfo) => status.url === url);
  //   return statusInfo?.status || 'connecting';
  // };

  // Helper function to get status indicator color and styling
  // const getStatusIndicator = (status: string) => {
  //   switch (status) {
  //     case 'connected':
  //       return 'bg-green-500';
  //     case 'connecting':
  //       return 'bg-yellow-500 animate-pulse';
  //     case 'failed':
  //       return 'bg-red-500';
  //     default:
  //       return 'bg-gray-400';
  //   }
  // };

  const handleJoinBitchat = () => {
    if (geohash.trim() && closestRelays.length > 0) {
      onSelectGeohash?.(geohash.trim());
    }
  };

  return (
    <div className="pb-3">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <MessageSquare className="h-5 w-5" />
          <span className="font-medium">BitChat</span>
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-4 pl-8">
          <div className="relative space-y-2">
            <Input
              id="geohash"
              autoFocus
              type="text"
              placeholder="Enter geohash (e.g., 9q)"
              value={geohash}
              onChange={(e) => setGeohash(e.target.value)}
              autoComplete="off"
              className="flex-1 border-0 bg-transparent px-0 text-base focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm"
            />

            {geohash.trim() && (
              <div className="absolute top-full right-0 left-0 z-50 mt-2">
                {geohash.trim() && closestRelays.length > 0 && (
                  <div className="rounded-lg border bg-background p-3 shadow-lg">
                    {/* {hasConnectingRelays && (
                      <div className="mb-3 flex items-center gap-1 text-muted-foreground">
                        <div className="flex gap-[2px]">
                          <div className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                          <div className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                          <div className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                        </div>
                      </div>
                    )} */}
                    <div className="mb-3 space-y-1">
                      {closestRelays.map((relay) => {
                        // const status = getRelayStatus(relay.url);
                        return (
                          <div
                            key={relay.url}
                            className="flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2 truncate">
                              {/* Status indicator dot */}
                              {/* <div
                                className={cn(
                                  'h-2 w-2 flex-shrink-0 rounded-full',
                                  getStatusIndicator(status),
                                )}
                                title={`Relay ${status}`}
                              /> */}
                              <span className="truncate">
                                {relay.url.replace('wss://', '')}
                              </span>
                            </div>
                            <span className="ml-2 text-muted-foreground">
                              {relay.distance.toFixed(0).toLocaleString()}km
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      onClick={handleJoinBitchat}
                      className="w-full"
                      size="sm"
                    >
                      Join <ArrowRight />
                    </Button>
                  </div>
                )}

                {geohash.trim() && closestRelays.length === 0 && (
                  <div className="rounded-lg border bg-background p-3 shadow-lg">
                    <div className="text-center text-muted-foreground text-sm">
                      No relays found in this area.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const navigate = useNavigateWithViewTransition();

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

        <ChatSettings
          onSelectGeohash={(geohash) => {
            navigate(
              { pathname: `/chat/${geohash}` },
              {
                transition: 'slideLeft',
                applyTo: 'newView',
              },
            );
          }}
        />
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
