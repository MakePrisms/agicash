import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTimeout } from 'usehooks-ts';

import {
  type CapturedCardPosition,
  type CardPosition,
  createEnteringCardStyles,
  createExitingCardStyles,
  createExitingInitialCardStyles,
  createInitialCardStyles,
  getCollapsedY,
} from './card-stack-animation';
import {
  ANIMATION_DURATION_MS,
  CARD_HEIGHT,
  CASCADE_DELAY_PER_CARD_MS,
  COLLAPSED_OFFSET,
} from './card-stack.constants';

/**
 * Card stack animation phases:
 * - idle: No card selected, showing collapsed stack
 * - entering: Card expanding to center, others fading/sliding away
 * - settled: Card centered, transactions visible
 * - exiting: Card returning to stack, others cascading back
 */
export type CardStackPhase = 'idle' | 'entering' | 'settled' | 'exiting';

type CardStackState = {
  selectedIndex: number | null;
  phase: CardStackPhase;
  capturedPosition: CapturedCardPosition | null;
  stackedHeight: number;
  selectCard: (index: number, cardRect: DOMRect) => void;
  collapseStack: () => void;
  /** True if the card was initialized from URL (skip animations) */
  wasInitializedFromUrl: boolean;
};

type CardAnimationStyles = {
  cardStyles: Map<number, CSSProperties>;
  cardWidth: number;
  cardHeight: number;
  centeredLeft: number;
};

type UseCardStackStateOptions = {
  cardCount: number;
  /** Initial selection index to restore on mount (e.g., from URL) */
  initialSelectedIndex?: number | null;
  /** Ref to card buttons for getting initial position */
  cardRefs?: React.RefObject<(HTMLButtonElement | null)[]>;
};

/**
 * Manages card stack state machine and phase transitions.
 * Controls when cards expand (entering → settled) and collapse (exiting → idle).
 */
export function useCardStackState({
  cardCount,
  initialSelectedIndex,
  cardRefs,
}: UseCardStackStateOptions): CardStackState {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<CardStackPhase>('idle');
  const [capturedPosition, setCapturedPosition] =
    useState<CapturedCardPosition | null>(null);
  const hasInitialized = useRef(false);
  const [wasInitializedFromUrl, setWasInitializedFromUrl] = useState(false);

  // Declarative timeout delays - null means no active timeout
  const [enterDelay, setEnterDelay] = useState<number | null>(null);
  const [exitDelay, setExitDelay] = useState<number | null>(null);

  // Restore selection from initial index (e.g., from URL query param)
  // Skips animation and goes directly to settled state
  useEffect(() => {
    if (
      hasInitialized.current ||
      initialSelectedIndex == null ||
      initialSelectedIndex < 0 ||
      initialSelectedIndex >= cardCount
    ) {
      return;
    }

    const refs = cardRefs?.current;
    const cardRef = refs?.[initialSelectedIndex];
    if (!cardRef) return;

    hasInitialized.current = true;
    const rect = cardRef.getBoundingClientRect();

    setCapturedPosition({
      index: initialSelectedIndex,
      top: rect.top,
      left: rect.left,
      width: rect.width,
    });
    setSelectedIndex(initialSelectedIndex);
    setPhase('settled');
    setWasInitializedFromUrl(true);
  }, [initialSelectedIndex, cardCount, cardRefs]);

  // useTimeout handles cleanup automatically on unmount or when delay changes
  useTimeout(() => {
    setPhase('settled');
    setEnterDelay(null);
  }, enterDelay);

  useTimeout(() => {
    setPhase('idle');
    setSelectedIndex(null);
    setCapturedPosition(null);
    setExitDelay(null);
  }, exitDelay);

  const selectCard = useCallback((index: number, cardRect: DOMRect) => {
    setCapturedPosition({
      index,
      top: cardRect.top,
      left: cardRect.left,
      width: cardRect.width,
    });
    setSelectedIndex(index);
    setPhase('entering');
    setEnterDelay(ANIMATION_DURATION_MS);
  }, []);

  // Collapse timing accounts for cascade delay on cards below the selected one.
  // Each card below animates with an additional CASCADE_DELAY_PER_CARD_MS delay,
  // creating a "falling into place" effect.
  const collapseStack = useCallback(() => {
    if (selectedIndex === null) return;
    setPhase('exiting');

    const cardsBelow = cardCount - selectedIndex - 1;
    const totalExitTime =
      ANIMATION_DURATION_MS + cardsBelow * CASCADE_DELAY_PER_CARD_MS;

    setExitDelay(totalExitTime);
  }, [cardCount, selectedIndex]);

  return {
    selectedIndex,
    phase,
    capturedPosition,
    stackedHeight: CARD_HEIGHT + (cardCount - 1) * COLLAPSED_OFFSET,
    selectCard,
    collapseStack,
    wasInitializedFromUrl,
  };
}

/**
 * Computes CSS styles for each card during expand/collapse animations.
 * Returns a Map of card index → CSSProperties for positioning and transitions.
 */
export function useCardAnimationStyles(
  phase: CardStackPhase,
  selectedIndex: number,
  cardCount: number,
  capturedPosition: CapturedCardPosition,
  stackViewCardRefs: React.RefObject<(HTMLButtonElement | null)[]>,
): CardAnimationStyles {
  const [cardStyles, setCardStyles] = useState<Map<number, CSSProperties>>(
    new Map(),
  );
  const [isInitialRender, setIsInitialRender] = useState(true);

  const { top: baseTop, left: baseLeft, width: baseWidth } = capturedPosition;

  // Track centered position in state to avoid hydration mismatch.
  // Initialize with baseLeft (matches SSR), then update after mount.
  const [centeredLeft, setCenteredLeft] = useState(baseLeft);
  useLayoutEffect(() => {
    setCenteredLeft((window.innerWidth - baseWidth) / 2);
  }, [baseWidth]);

  // Set initial positions (no animation) - must happen before paint
  useLayoutEffect(() => {
    if (phase === 'entering') {
      setCardStyles(
        createInitialCardStyles(
          selectedIndex,
          cardCount,
          baseTop,
          baseLeft,
          baseWidth,
        ),
      );
      setIsInitialRender(true);
    }
  }, [phase, baseTop, baseLeft, baseWidth, selectedIndex, cardCount]);

  // Double requestAnimationFrame ensures initial styles are painted before
  // applying animated styles. First rAF schedules for next frame, second rAF
  // ensures the browser has actually painted the initial state.
  useEffect(() => {
    if (phase === 'entering' && isInitialRender) {
      let innerFrameId: number;
      let cancelled = false;

      const outerFrameId = requestAnimationFrame(() => {
        if (cancelled) return;
        innerFrameId = requestAnimationFrame(() => {
          if (cancelled) return;
          setCardStyles(
            createEnteringCardStyles(
              selectedIndex,
              cardCount,
              baseTop,
              baseLeft,
              centeredLeft,
              baseWidth,
            ),
          );
          setIsInitialRender(false);
        });
      });

      return () => {
        cancelled = true;
        cancelAnimationFrame(outerFrameId);
        cancelAnimationFrame(innerFrameId);
      };
    }
  }, [
    phase,
    isInitialRender,
    centeredLeft,
    selectedIndex,
    cardCount,
    baseTop,
    baseLeft,
    baseWidth,
  ]);

  // Handle exiting animation - set initial positions first (synchronous).
  // This ensures cards start at their "expanded" positions before animating to collapsed.
  useLayoutEffect(() => {
    if (phase !== 'exiting') return;

    setCardStyles(
      createExitingInitialCardStyles(
        selectedIndex,
        cardCount,
        baseTop,
        baseLeft,
        centeredLeft,
        baseWidth,
      ),
    );
    setIsInitialRender(true);
  }, [
    phase,
    centeredLeft,
    baseTop,
    baseLeft,
    baseWidth,
    selectedIndex,
    cardCount,
  ]);

  // Handle exiting animation - all cards return to collapsed positions.
  // Uses cascade delay for cards below to create a "falling into place" effect.
  // Double rAF ensures initial styles are painted before applying animated styles.
  useEffect(() => {
    if (phase !== 'exiting' || !isInitialRender) return;

    let innerFrameId: number;
    let cancelled = false;

    const outerFrameId = requestAnimationFrame(() => {
      if (cancelled) return;
      innerFrameId = requestAnimationFrame(() => {
        if (cancelled) return;

        const getCardPosition = (index: number): CardPosition => {
          const refs = stackViewCardRefs.current;
          const ref =
            refs && index >= 0 && index < refs.length ? refs[index] : null;
          if (ref) {
            const rect = ref.getBoundingClientRect();
            return { top: rect.top, left: rect.left, width: rect.width };
          }
          // Fallback: calculate position relative to captured card if ref is unavailable
          return {
            top: getCollapsedY(index, selectedIndex, baseTop),
            left: baseLeft,
            width: baseWidth,
          };
        };

        setCardStyles(
          createExitingCardStyles(selectedIndex, cardCount, getCardPosition),
        );
        setIsInitialRender(false);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outerFrameId);
      cancelAnimationFrame(innerFrameId);
    };
  }, [
    phase,
    isInitialRender,
    baseTop,
    baseLeft,
    baseWidth,
    selectedIndex,
    cardCount,
    stackViewCardRefs,
  ]);

  return {
    cardStyles,
    cardWidth: baseWidth,
    cardHeight: CARD_HEIGHT,
    centeredLeft,
  };
}
