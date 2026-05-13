import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { z } from 'zod';

/**
 * Persists and restores the horizontal scroll position of a container across
 * navigations. Positions are stored in `location.state` under `state.scrollPositions[stateKey]`.
 * Pass `getScrollState()` as the `state` argument to `navigate(...)` when
 * leaving the page so the position gets restored on back navigation.
 */
export function useRestoreScrollPosition<K extends string>(stateKey: K) {
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    const result = z
      .object({ scrollPositions: z.object({ [stateKey]: z.number() }) })
      .safeParse(location.state);

    if (result.success && scrollRef.current) {
      scrollRef.current.scrollLeft = result.data.scrollPositions[stateKey];
    }
  }, [location.state, stateKey]);

  const handleScroll = () => {
    if (scrollRef.current) {
      scrollPositionRef.current = scrollRef.current.scrollLeft;
    }
  };

  const getScrollState = () => {
    const existing = z
      .object({ scrollPositions: z.record(z.string(), z.number()) })
      .safeParse(location.state);
    return {
      scrollPositions: {
        ...(existing.success ? existing.data.scrollPositions : {}),
        [stateKey]: scrollPositionRef.current,
      },
    };
  };

  return { scrollRef, handleScroll, getScrollState };
}
