import { useEffect, useRef, useState } from 'react';

export type UseIsVisibleOptions = {
  /**
   * Number between 0.0 and 1.0 indicating what percentage of the element
   * must be visible to trigger the callback. Can also be an array of thresholds
   * to trigger at multiple visibility percentages.
   * @default undefined
   */
  threshold?: number | number[];
  /**
   * Margin around the root element. Values work like CSS margin property
   * (top, right, bottom, left). Positive values shrink the root's bounding box,
   * negative values expand it.
   * @default undefined
   */
  rootMargin?: string;
  /**
   * Element used as the viewport for checking visibility. If null, uses the
   * browser's viewport.
   * @default null
   */
  root?: Element | null;
  /**
   * Callback fired when visibility changes.
   */
  onVisibilityChange?: (isVisible: boolean) => void;
};

/**
 * Hook to track if an element is visible in the viewport using IntersectionObserver
 * @param options - IntersectionObserver options
 * @returns object with ref to attach to element and isVisible boolean
 */
export function useIsVisible(options: UseIsVisibleOptions = {}) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const {
    threshold = undefined,
    rootMargin = undefined,
    root = null,
    onVisibilityChange,
  } = options;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        const newIsVisible = entry.isIntersecting;
        setIsVisible(newIsVisible);
        onVisibilityChange?.(newIsVisible);
      },
      {
        threshold,
        rootMargin,
        root,
      },
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, [threshold, rootMargin, root, onVisibilityChange]);

  return { ref, isVisible };
}
