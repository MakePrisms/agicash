import { useEffect, useState } from 'react';
import { MoneyDisplay } from '~/components/money-display';
import { Card, CardContent } from '~/components/ui/card';
import { getDefaultUnit } from '~/features/shared/currencies';
import { Money } from '~/lib/money';
import { cn } from '~/lib/utils';
import { type CardData, getCardAsset } from './card-types';
import { useCardStackAnimation } from './use-card-stack-animation';
import { useSelectionAnimation } from './use-selection-animation';

interface WalletCardProps {
  card: CardData;
  index: number;
  onSelect: (cardId: string, event?: React.MouseEvent) => void;
  selectedCardIndex: number | null;
}

// Animation timing constants - adjust ANIMATION_SPEED to make all animations faster/slower
const ANIMATION_SPEED = 500; // Base animation duration in ms

/**
 * A wallet card component that displays vendor information and balance.
 * Supports selection states with smooth animations.
 */
export function WalletCard({
  card,
  index,
  onSelect,
  selectedCardIndex,
}: WalletCardProps) {
  const [customDesignLoaded, setCustomDesignLoaded] = useState(false);
  const [customDesignExists, setCustomDesignExists] = useState(false);

  // Reset custom design state after fade-out animation completes
  useEffect(() => {
    if (!card.isSelected && (customDesignLoaded || customDesignExists)) {
      // Wait for the fade-out animation to complete before resetting
      const timer = setTimeout(() => {
        setCustomDesignLoaded(false);
        setCustomDesignExists(false);
      }, ANIMATION_SPEED);
      return () => clearTimeout(timer);
    }
  }, [card.isSelected, customDesignLoaded, customDesignExists]);

  const money = new Money({
    amount: card.balance.amount,
    currency: card.balance.currency,
    unit: getDefaultUnit(card.balance.currency),
  });

  const handleCardClick = (e: React.MouseEvent) => {
    // Pass the event to the parent handler for proper toggle logic
    onSelect(card.id, e);
  };

  // Use focused animation hooks for different animation concerns
  const stackAnimation = useCardStackAnimation({
    index,
    isExpanded: card.isSelected,
    expandedCardIndex: selectedCardIndex,
    animationSpeed: ANIMATION_SPEED,
  });

  const selectionAnimation = useSelectionAnimation({
    isExpanded: false,
  });

  // Combine stack positioning with scale animation
  const cardStyle = {
    ...stackAnimation,
    transform: `${stackAnimation.transform}`,
    transitionDuration: `${ANIMATION_SPEED}ms`,
  };

  const customDesignPath = getCardAsset(card.mintUrl);
  const hasCustomDesign = customDesignPath !== null;
  const showCustomDesign =
    card.isSelected && customDesignExists && customDesignLoaded;
  const shouldRenderCustomDesign = customDesignExists && customDesignLoaded;

  return (
    <Card
      className={cn(
        'relative w-full overflow-hidden',
        selectionAnimation.cardClassName,
      )}
      style={{ ...cardStyle, aspectRatio: '1.586' }}
      onClick={handleCardClick}
    >
      {/* Custom card design - fades in when selected, fades out when deselected */}
      {hasCustomDesign && (card.isSelected || shouldRenderCustomDesign) && (
        <img
          src={customDesignPath}
          alt={`${card.name} loyalty card design`}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
            showCustomDesign ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => {
            setCustomDesignExists(true);
            setCustomDesignLoaded(true);
          }}
          onError={() => {
            setCustomDesignExists(false);
          }}
        />
      )}

      {/* Default card content - always visible, custom design fades in on top */}
      <CardContent className="flex h-full flex-col p-6">
        {/* Card Header with Logo, Vendor, and Balance */}
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div
            className={cn(
              'flex-shrink-0 overflow-hidden rounded-xl',
              selectionAnimation.logoClassName,
            )}
            style={{ transitionDuration: `${ANIMATION_SPEED}ms` }}
          >
            <img
              src={card.logo}
              alt={`${card.name} logo`}
              className="h-10 w-10 object-contain"
              onError={(e) => {
                // Fallback to a placeholder if image fails to load
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent) {
                  parent.innerHTML = `<div class="flex h-10 w-10 items-center justify-center rounded bg-muted text-xs font-medium text-muted-foreground">${card.name.charAt(0)}</div>`;
                }
              }}
            />
          </div>
          {/* Card Info */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-base">{card.name}</h3>
            <p className="truncate text-muted-foreground text-sm">
              {card.type}
            </p>
          </div>
          {/* Balance on the right - fades out and slides up when selected */}
          <div
            className={cn(
              'flex-shrink-0 transition-all ease-in-out',
              card.isSelected
                ? 'translate-y-[-8px] opacity-0'
                : 'translate-y-0 opacity-100',
            )}
            style={{ transitionDuration: `${ANIMATION_SPEED}ms` }}
          >
            <MoneyDisplay
              money={money}
              unit={getDefaultUnit(card.balance.currency)}
              className="font-semibold text-base"
              variant="secondary"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
