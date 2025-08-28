import { useEffect, useRef, useState } from 'react';

export type UseIsVisibleOptions = {
  threshold?: number | number[];
  rootMargin?: string;
  root?: Element | null;
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
    threshold = 0.5,
    rootMargin = '0px 0px -10% 0px',
    root = null,
  } = options;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setIsVisible(entry.isIntersecting);
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
  }, [threshold, rootMargin, root]);

  return { ref, isVisible };
}
