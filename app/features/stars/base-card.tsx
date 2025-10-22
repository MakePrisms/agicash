import transparentCardBg from '~/assets/transparent-card.png';
import { Card } from '~/components/ui/card';
import { cn } from '~/lib/utils';
import { CARD_ASPECT_RATIO } from './animation-constants';

type BaseCardProps = {
  backgroundImage?: string | null;
  className?: string;
  children: React.ReactNode;
};

/**
 * Base card component that provides consistent card dimensions and background handling.
 * Used as the foundation for WalletCard and CurrencyCard.
 */
export function BaseCard({
  backgroundImage,
  className,
  children,
}: BaseCardProps) {
  const hasCustomBackground = !!backgroundImage;

  return (
    <Card
      className={cn(
        'relative w-full overflow-hidden border-none bg-transparent',
        hasCustomBackground && 'rounded-3xl', // TODO: Bob will give us card designs with rounded corners
        className,
      )}
      style={{
        aspectRatio: CARD_ASPECT_RATIO.toString(),
      }}
    >
      {/* Background image - either custom design or fallback */}
      <img
        src={backgroundImage || transparentCardBg}
        alt="Card background"
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Card content - children handle their own positioning */}
      {children}
    </Card>
  );
}
