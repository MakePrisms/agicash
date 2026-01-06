import { WalletCard, WalletCardBackground } from '~/components/wallet-card';
import useUserAgent from '~/hooks/use-user-agent';
import { LinkWithViewTransition } from '~/lib/transitions';
import { cn } from '~/lib/utils';
import type { DiscoverMint } from './use-discover-cards';

type DiscoverSectionProps = {
  mints: DiscoverMint[];
};

/**
 * Horizontal scroll carousel of available gift cards for discovery.
 */
export function DiscoverSection({ mints }: DiscoverSectionProps) {
  const { isMobile } = useUserAgent();

  return (
    <div className="w-full shrink-0">
      <h2 className="mb-3 px-4 text-white">Discover</h2>
      <div
        className={cn(
          'overflow-x-auto pb-1',
          isMobile
            ? 'scrollbar-none'
            : '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5',
        )}
      >
        <div className="flex w-max gap-3 px-4 pb-2">
          {mints.map((mint) => (
            <LinkWithViewTransition
              key={`${mint.url}:${mint.currency}`}
              to={`/gift-cards/add/${encodeURIComponent(mint.url)}/${mint.currency}`}
              transition="slideUp"
              applyTo="newView"
            >
              <WalletCard size="sm" className="shrink-0">
                <WalletCardBackground src={mint.image} alt={mint.name} />
              </WalletCard>
            </LinkWithViewTransition>
          ))}
        </div>
      </div>
    </div>
  );
}
