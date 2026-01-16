import type * as React from 'react';
import { cn } from '~/lib/utils';

export const CARD_SIZES = {
  default: { width: 340, className: 'w-[340px] rounded-[14px]' },
  sm: { width: 140, className: 'w-[140px] rounded-[12px]' },
} as const;

export const CARD_ASPECT_RATIO = 2115 / 1334;

export type WalletCardSize = keyof typeof CARD_SIZES;

/**
 * Props for the WalletCard component.
 */
export type WalletCardProps = {
  className?: string;
  children: React.ReactNode;
  size?: WalletCardSize;
};

type WalletCardBackgroundProps = {
  src: string;
  alt?: string;
  className?: string;
};

/**
 * A card container with a fixed aspect ratio.
 */
export function WalletCard({
  className,
  children,
  size = 'default',
}: WalletCardProps) {
  return (
    <div
      className={cn(
        '@container relative overflow-hidden',
        CARD_SIZES[size].className,
        className,
      )}
      style={{
        aspectRatio: CARD_ASPECT_RATIO,
      }}
    >
      {children}
      {/* Inner border overlay */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[inherit] border border-[#262626]/55',
        )}
      />
    </div>
  );
}

/**
 * Background image for WalletCard. The image should have a fixed aspect ratio of {@link CARD_ASPECT_RATIO}.
 * The image will fill the card container.
 */
export function WalletCardBackground({
  src,
  alt = '',
  className,
}: WalletCardBackgroundProps) {
  return (
    <img
      src={src}
      alt={alt}
      className={cn('block h-full w-full object-cover', className)}
    />
  );
}

type WalletCardBlankProps = {
  className?: string;
};

/**
 * A blank card background with the same aspect ratio and rounding as the card image.
 * Use this instead of WalletCardBackground when no image is needed.
 */
export function WalletCardBlank({ className }: WalletCardBlankProps) {
  return (
    <div
      className={cn(
        'h-full w-full rounded-[inherit] border-2 bg-card',
        className,
      )}
    />
  );
}

/**
 * Overlay content for WalletCard. The content will be displayed on top of the card background.
 */
export function WalletCardOverlay({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('absolute inset-0', className)} {...props}>
      {children}
    </div>
  );
}
