import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import DiscordLogo from '~/assets/discord_logo.svg';
import { Page, PageContent } from '~/components/page';
import { Button } from '~/components/ui/button';
import { authQueryOptions } from '~/features/user/auth';

export default function HomePage() {
  const location = useLocation();
  const { data: authState } = useQuery(authQueryOptions());

  const isLoggedIn = authState?.isLoggedIn ?? false;

  return (
    <Page>
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

            <div className="-translate-x-1/2 absolute top-full left-1/2 mt-8">
              {isLoggedIn ? (
                <Button asChild size="sm">
                  <Link to="/">Go to Wallet</Link>
                </Button>
              ) : (
                <Button asChild size="sm">
                  <Link to={{ ...location, pathname: '/signup' }}>
                    Join Beta
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
