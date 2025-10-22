// Duration constants (in ms)
export const ANIMATION_DURATION = 400;
export const DETAIL_VIEW_DELAY = 300; // Delay before detail content starts animating
export const OPACITY_ANIMATION_RATIO = 0.5; // Multiplier for opacity animation duration

export const EASE_IN_OUT = 'cubic-bezier(0.25, 0.1, 0.25, 1)';
export const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'; // Decelerating

// Layout constants (in px)
export const CARD_STACK_OFFSET = 64; // Space between cards in collapsed stack
export const CARD_ASPECT_RATIO = 1.585; // Credit card aspect ratio

/**
 * Get the off-screen Y offset for sliding cards out
 */
export function getOffScreenOffset(): number {
  return typeof window !== 'undefined' ? window.innerHeight + 100 : 900; // Fallback for SSR
}
