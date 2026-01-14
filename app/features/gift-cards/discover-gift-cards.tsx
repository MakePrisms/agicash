import { WalletCard, WalletCardBackground } from '~/components/wallet-card';
import useUserAgent from '~/hooks/use-user-agent';
import {
  LinkWithViewTransition,
  useScopedTransitionName,
} from '~/lib/transitions';
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
  const vtn = useScopedTransitionName('gift-cards');

  return (
    <div
      className="w-full shrink-0"
      style={{ viewTransitionName: vtn('available-cards') }}
    >
      <h2 className="mb-3 px-4 text-white">Discover</h2>
      <div className="sm:px-4">
        <div
          className={cn(
            'overflow-x-auto pb-1',
            isMobile
              ? 'scrollbar-none'
              : '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5',
          )}
        >
          <div className="flex w-max gap-3 pb-2">
            {giftCards.map((card, index) => (
              <LinkWithViewTransition
                key={`${card.url}:${card.currency}`}
                to={`/gift-cards/add/${encodeURIComponent(card.url)}/${card.currency}`}
                transition="slideUp"
                applyTo="newView"
              >
                <WalletCard
                  size="sm"
                  className={cn(
                    index === 0 && 'ml-4 sm:ml-0',
                    index === giftCards.length - 1 && 'mr-4 sm:mr-0',
                  )}
                >
                  <WalletCardBackground src={card.image} alt={card.name} />
                </WalletCard>
              </LinkWithViewTransition>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
