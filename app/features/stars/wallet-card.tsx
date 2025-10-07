import { useEffect, useState } from 'react';
import { MoneyDisplay } from '~/components/money-display';
import { Card, CardContent } from '~/components/ui/card';
import {
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import { getDefaultUnit } from '~/features/shared/currencies';
import { cn } from '~/lib/utils';
import {
  ANIMATION_DURATION,
  CARD_ASPECT_RATIO,
  CARD_STACK_OFFSET,
  EASE_IN_OUT,
  getOffScreenOffset,
} from './animation-constants';

/**
 * Lazy import functions for card assets.
 * These are cached by the browser's module system after first import.
 */
const cardAssetLoaders = import.meta.glob<{ default: string }>(
  '../../assets/star-cards/*.png',
);

/**
 * Extracts the domain name from a file path.
 * e.g., '../../assets/star-cards/fake.agi.cash.png' -> 'fake.agi.cash'
 */
function extractDomainFromPath(path: string): string {
  return path.split('/').pop()?.replace('.png', '') || '';
}

/**
 * Gets the domain from a mint URL
 */
function getDomainFromMintUrl(mintUrl: string): string {
  return mintUrl.replace(/^https?:\/\//, '');
}

/**
 * Loads a card asset dynamically if it exists.
 */
async function loadCardAsset(mintUrl: string): Promise<string | null> {
  const domain = getDomainFromMintUrl(mintUrl);
  const loaderEntry = Object.entries(cardAssetLoaders).find(
    ([path]) => extractDomainFromPath(path) === domain,
  );
  if (!loaderEntry) {
    return null;
  }
  try {
    const [, loader] = loaderEntry;
    const module = await loader();
    return module.default;
  } catch (error) {
    console.error(`Failed to load card asset for ${domain}:`, error);
    return null;
  }
}

interface WalletCardProps {
  account: CashuAccount;
  hideHeader?: boolean;
}

export function WalletCard({ account, hideHeader = false }: WalletCardProps) {
  const [customDesignPath, setCustomDesignPath] = useState<string | null>(null);

  useEffect(() => {
    loadCardAsset(account.mintUrl).then(setCustomDesignPath);
  }, [account.mintUrl]);

  const cardName = account.wallet.cachedMintInfo.name ?? account.name;
  const cardLogo = account.wallet.cachedMintInfo.iconUrl ?? null;

  const balance = getAccountBalance(account);

  return (
    <Card
      className={cn(
        'relative w-full overflow-hidden rounded-3xl',
        customDesignPath && 'border-none',
      )}
      style={{
        aspectRatio: CARD_ASPECT_RATIO.toString(),
      }}
    >
      {/* Custom card design - always visible if available */}
      {customDesignPath ? (
        <img
          src={customDesignPath}
          alt={`${cardName} loyalty card design`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center gap-6 px-6">
          {cardLogo ? (
            <img
              src={cardLogo}
              alt={`${cardName} logo`}
              className="h-16 w-16 flex-shrink-0 object-contain"
            />
          ) : (
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-muted font-bold text-muted-foreground text-xl">
              {cardName.charAt(0)}
            </div>
          )}
          <h3 className="truncate font-bold text-2xl">{cardName}</h3>
        </div>
      )}

      {/* Default card content */}
      <CardContent className="relative flex h-full flex-col px-6 pt-3 pb-6">
        {/* Card Header with Logo, Vendor, and Balance */}
        <div
          className={cn('flex items-center gap-4', hideHeader && 'opacity-0')}
        >
          {/* Logo */}
          <div className="flex-shrink-0">
            {cardLogo ? (
              <img
                src={cardLogo}
                alt={`${cardName} logo`}
                className="h-10 w-10 object-contain"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-muted font-medium text-muted-foreground text-xs">
                {cardName.charAt(0)}
              </div>
            )}
          </div>

          {/* Card Info */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-base">{cardName}</h3>
          </div>

          {/* Balance */}
          <div className="flex-shrink-0">
            <MoneyDisplay
              money={balance}
              unit={getDefaultUnit(account.currency)}
              className="font-semibold text-base"
              variant="secondary"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface SelectableWalletCardProps {
  account: CashuAccount;
  isSelected: boolean;
  index: number;
  onSelect: (accountId: string, event?: React.MouseEvent) => void;
  selectedCardIndex: number | null;
}

/**
 * A selectable wallet card component with animations.
 * Wraps WalletCard with selection logic, click handlers, and animation behavior.
 * Use this in contexts where cards need selection/animation behavior (e.g., card stack).
 */
export function SelectableWalletCard({
  account,
  isSelected,
  index,
  onSelect,
  selectedCardIndex,
}: SelectableWalletCardProps) {
  const handleCardClick = (e: React.MouseEvent) => {
    onSelect(account.id, e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(account.id);
    }
  };

  // Calculate Y position based on state
  let yOffset: number;
  if (isSelected) {
    // This card is selected - move to top position
    yOffset = 0;
  } else if (selectedCardIndex !== null) {
    // Another card is selected - slide this card off screen
    yOffset = getOffScreenOffset();
  } else {
    // No selection - normal stacked position
    yOffset = index * CARD_STACK_OFFSET;
  }

  // Fixed z-index based on position
  const zIndex = 100 + index;

  const transition = `all ${ANIMATION_DURATION}ms ${EASE_IN_OUT}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: div needed for absolute positioning wrapper
    <div
      role="button"
      tabIndex={0}
      className="absolute top-0 w-full cursor-pointer"
      style={{
        transform: `translateY(${yOffset}px)`,
        zIndex,
        transition,
      }}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
    >
      <WalletCard account={account} hideHeader={isSelected} />
    </div>
  );
}
