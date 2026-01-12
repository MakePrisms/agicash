import { WalletCard, WalletCardBackground } from '~/components/wallet-card';
import useUserAgent from '~/hooks/use-user-agent';
import { LinkWithViewTransition } from '~/lib/transitions';
import { cn } from '~/lib/utils';
import type { GiftCardInfo } from './use-discover-cards';

type DiscoverSectionProps = {
  giftCards: GiftCardInfo[];
};

/**
 * Horizontal scroll carousel of available gift cards for discovery.
 */
export function DiscoverGiftCards({ giftCards }: DiscoverSectionProps) {
  const { isMobile } = useUserAgent();

  return (
    <div className="view-transition-available w-full shrink-0">
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
          {giftCards.map((card) => (
            <LinkWithViewTransition
              key={`${card.url}:${card.currency}`}
              to={`/gift-cards/add/${encodeURIComponent(card.url)}/${card.currency}`}
              transition="slideUp"
              applyTo="newView"
            >
              <WalletCard size="sm" className="shrink-0">
                <WalletCardBackground src={card.image} alt={card.name} />
              </WalletCard>
            </LinkWithViewTransition>
          ))}
        </div>
      </div>
    </div>
  );
}
