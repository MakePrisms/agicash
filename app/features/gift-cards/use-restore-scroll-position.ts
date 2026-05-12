import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { z } from 'zod';

/**
 * Persists and restores the horizontal scroll position of a container across
 * navigations, keyed by `stateKey` in `location.state`. Pass `getScrollState()`
 * as the `state` argument to `navigate(...)` when leaving the page so the
 * position gets restored on back navigation.
 */
export function useRestoreScrollPosition<K extends string>(stateKey: K) {
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    const result = z
      .object({ [stateKey]: z.number() })
      .safeParse(location.state);

    if (result.success && scrollRef.current) {
      scrollRef.current.scrollLeft = result.data[stateKey];
    }
  }, [location.state, stateKey]);

  const handleScroll = () => {
    if (scrollRef.current) {
      scrollPositionRef.current = scrollRef.current.scrollLeft;
    }
  };

  const getScrollState = () => ({
    ...(typeof location.state === 'object' && location.state !== null
      ? location.state
      : {}),
    [stateKey]: scrollPositionRef.current,
  });

  return { scrollRef, handleScroll, getScrollState };
}
