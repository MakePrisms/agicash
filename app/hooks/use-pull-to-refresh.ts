import { useCallback, useRef, useState } from 'react';

const PULL_THRESHOLD = 60;
const MAX_PULL_DISTANCE = 100;
const RESISTANCE_FACTOR = 0.4;

type PullToRefreshState = 'idle' | 'pulling' | 'refreshing';

export function usePullToRefresh({
  onRefresh,
  scrollRef,
}: {
  onRefresh: () => Promise<unknown>;
  scrollRef: React.RefObject<HTMLElement | null>;
}) {
  const [state, setState] = useState<PullToRefreshState>('idle');
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const currentY = useRef(0);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (state === 'refreshing') return;
      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      if (scrollTop > 0) return;

      startY.current = e.touches[0].clientY;
      currentY.current = startY.current;
    },
    [state, scrollRef],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (state === 'refreshing') return;
      if (startY.current === 0) return;

      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      if (scrollTop > 0) {
        startY.current = 0;
        setPullDistance(0);
        setState('idle');
        return;
      }

      currentY.current = e.touches[0].clientY;
      const rawDistance = currentY.current - startY.current;

      if (rawDistance <= 0) {
        setPullDistance(0);
        setState('idle');
        return;
      }

      const distance = Math.min(
        rawDistance * RESISTANCE_FACTOR,
        MAX_PULL_DISTANCE,
      );
      setPullDistance(distance);
      setState('pulling');
    },
    [state, scrollRef],
  );

  const onTouchEnd = useCallback(async () => {
    if (state === 'refreshing') return;

    if (pullDistance >= PULL_THRESHOLD * RESISTANCE_FACTOR) {
      setState('refreshing');
      setPullDistance(PULL_THRESHOLD * RESISTANCE_FACTOR);
      try {
        await onRefresh();
      } finally {
        setState('idle');
        setPullDistance(0);
      }
    } else {
      setState('idle');
      setPullDistance(0);
    }

    startY.current = 0;
  }, [state, pullDistance, onRefresh]);

  return {
    state,
    pullDistance,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
