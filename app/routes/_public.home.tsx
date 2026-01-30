import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useTimeout } from 'usehooks-ts';
import DiscordLogo from '~/assets/discord_logo.svg';
import { Page, PageContent } from '~/components/page';
import { Button } from '~/components/ui/button';
import { authQueryOptions } from '~/features/user/auth';

const TAP_THRESHOLD_MS = 500;

/** This hook is used for the login and signup button easter egg. */
function useShowAuthButtons() {
  const [tapCount, setTapCount] = useState(0);
  const [showAuthButtons, setShowAuthButtons] = useState(false);

  useTimeout(
    () => {
      setTapCount(0);
    },
    tapCount > 0 ? TAP_THRESHOLD_MS : null,
  );

  const handleTap = () => {
    setTapCount((prev) => {
      const newCount = prev + 1;
      if (newCount >= 3) {
        setShowAuthButtons(true);
        return 0;
      }
      return newCount;
    });
  };

  return { showAuthButtons, handleTap };
}

export default function HomePage() {
  const location = useLocation();
  const { showAuthButtons, handleTap } = useShowAuthButtons();
  const { data: authState } = useQuery(authQueryOptions());

  const isLoggedIn = authState?.isLoggedIn ?? false;

  return (
    <Page onClick={handleTap}>
      <PageContent className="flex flex-col items-center">
        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          <div className="relative text-center">
            <h1 className="mb-8 font-bold text-[clamp(3rem,10vw,4rem)] leading-none tracking-tight drop-shadow-lg">
              Coming Soon
            </h1>

            <a
              href="https://discord.gg/e2TSCfXxhd"
              className="inline-flex"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src={DiscordLogo}
                alt="Discord"
                className="size-8"
                style={{
                  filter:
                    'invert(38%) sepia(95%) saturate(1817%) hue-rotate(218deg) brightness(100%) contrast(93%)',
                }}
              />
            </a>

            {isLoggedIn ? (
              <div className="-translate-x-1/2 absolute top-full left-1/2 mt-8">
                <Button asChild size="sm">
                  <Link to="/">Go to Wallet</Link>
                </Button>
              </div>
            ) : (
              showAuthButtons && (
                <div className="-translate-x-1/2 absolute top-full left-1/2 mt-8 flex gap-4">
                  <Button asChild variant="outline" size="sm">
                    <Link to={{ ...location, pathname: '/login' }}>Log In</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link to={{ ...location, pathname: '/signup' }}>
                      Sign Up
                    </Link>
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
