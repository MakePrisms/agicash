import { useMemo } from 'react';
import { cn } from '~/lib/utils';

interface SelectionAnimationOptions {
  isExpanded: boolean;
}

interface SelectionAnimationResult {
  cardClassName: string;
  logoClassName: string;
  balanceClassName: string;
}

/**
 * Hook for managing selection state animations and styling.
 * Provides consistent visual feedback for selected cards including borders, shadows, and highlights.
 */
export function useSelectionAnimation({
  isExpanded,
}: SelectionAnimationOptions): SelectionAnimationResult {
  return useMemo(() => {
    const cardClassName = cn(
      'relative cursor-pointer transition-all ease-in-out',
      // Keep border consistent - no border changes on selection
    );

    const logoClassName = cn(
      'flex h-10 w-10 items-center justify-center rounded-full text-lg transition-all',
    );

    const balanceClassName = cn(
      'font-bold transition-all ease-in-out',
      isExpanded ? 'text-3xl' : 'text-xl',
    );

    return {
      cardClassName,
      logoClassName,
      balanceClassName,
    };
  }, [isExpanded]);
}
