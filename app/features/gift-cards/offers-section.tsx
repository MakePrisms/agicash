import { useNavigate, useViewTransitionState } from 'react-router';
import {
  WalletCard,
  WalletCardBackgroundImage,
  WalletCardBlank,
  WalletCardOverlay,
} from '~/components/wallet-card';
import type { CashuAccount } from '~/features/accounts/account';
import useUserAgent from '~/hooks/use-user-agent';
import { cn } from '~/lib/utils';
import { CARD_WIDTH } from './card-stack-constants';
import { getGiftCardImageByUrl } from './gift-card-images';
import { useRestoreScrollPosition } from './use-restore-scroll-position';

type OfferCardButtonProps = {
  account: CashuAccount;
  size?: 'default' | 'sm';
  isTransitioning: boolean;
  onClick: () => void;
  className?: string;
  cardClassName?: string;
};

function OfferCardButton({
  account,
  size = 'default',
  isTransitioning,
  onClick,
  className,
  cardClassName,
}: OfferCardButtonProps) {
  const image = getGiftCardImageByUrl(account.mintUrl);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View ${account.name} offer`}
      className={cn('block', className)}
      style={{
        viewTransitionName: isTransitioning ? `offer-${account.id}` : undefined,
      }}
    >
      <WalletCard
        size={size}
        className={cn(size === 'default' && 'w-full max-w-none', cardClassName)}
      >
        {image ? (
          <WalletCardBackgroundImage src={image} alt={account.name} />
        ) : (
          <>
            <WalletCardBlank />
            <WalletCardOverlay className="flex items-center justify-center px-4">
              <span className="truncate text-card-foreground text-lg">
                {account.name}
              </span>
            </WalletCardOverlay>
          </>
        )}
      </WalletCard>
    </button>
  );
}

type OffersSectionProps = {
  offers: CashuAccount[];
};

export function OffersSection({ offers }: OffersSectionProps) {
  const navigate = useNavigate();
  const isTransitioning = useViewTransitionState(
    '/gift-cards/offers/:accountId',
  );
  const { isMobile } = useUserAgent();
  const { scrollRef, handleScroll, getScrollState } = useRestoreScrollPosition(
    'offersScrollPosition',
  );

  const navigateToOffer = (account: CashuAccount) => {
    navigate(`/gift-cards/offers/${account.id}`, {
      viewTransition: true,
      state: getScrollState(),
    });
  };

  if (offers.length === 0) return null;

  if (offers.length === 1) {
    const offer = offers[0];
    return (
      <div className="flex w-full shrink-0 flex-col items-center px-4 pb-8">
        <h2 className="mb-3 w-full text-white">Offers</h2>
        <div className="w-full" style={{ maxWidth: CARD_WIDTH }}>
          <OfferCardButton
            account={offer}
            isTransitioning={isTransitioning}
            onClick={() => navigateToOffer(offer)}
            className="w-full"
          />
        </div>
      </div>
    );
  }

  if (offers.length === 2) {
    return (
      <div className="flex w-full shrink-0 flex-col items-center px-4 pb-8">
        <h2 className="mb-3 w-full text-white">Offers</h2>
        <div className="flex w-full gap-3" style={{ maxWidth: CARD_WIDTH }}>
          {offers.map((offer) => (
            <OfferCardButton
              key={offer.id}
              account={offer}
              isTransitioning={isTransitioning}
              onClick={() => navigateToOffer(offer)}
              className="min-w-0 flex-1"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full shrink-0 pb-8">
      <h2 className="mb-3 px-4 text-white">Offers</h2>
      <div className="sm:px-4">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className={cn(
            'overflow-x-auto pb-1',
            isMobile
              ? 'scrollbar-none'
              : '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5',
          )}
        >
          <div className="flex w-max gap-3 pb-2">
            {offers.map((offer, index) => (
              <OfferCardButton
                key={offer.id}
                account={offer}
                size="sm"
                isTransitioning={isTransitioning}
                onClick={() => navigateToOffer(offer)}
                cardClassName={cn(
                  index === 0 && 'ml-4 sm:ml-0',
                  index === offers.length - 1 && 'mr-4 sm:mr-0',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
