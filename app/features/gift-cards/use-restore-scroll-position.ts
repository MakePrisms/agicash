import { useEffect, useMemo, useRef } from 'react';
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

  const schema = useMemo(
    () => z.object({ [stateKey]: z.number() }),
    [stateKey],
  );

  useEffect(() => {
    const result = schema.safeParse(location.state);
    if (result.success && scrollRef.current) {
      const value = (result.data as Record<K, number>)[stateKey];
      scrollRef.current.scrollLeft = value;
    }
  }, [location.state, schema, stateKey]);

  const handleScroll = () => {
    if (scrollRef.current) {
      scrollPositionRef.current = scrollRef.current.scrollLeft;
    }
  };

  const getScrollState = () =>
    ({ [stateKey]: scrollPositionRef.current }) as Record<K, number>;

  return { scrollRef, handleScroll, getScrollState };
}
