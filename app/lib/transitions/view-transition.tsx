import { type ComponentProps, useEffect, useState } from 'react';
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useNavigation,
} from 'react-router';
import type { NavigateOptions, To } from 'react-router';

const transitions = [
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'fade',
] as const;
type Transition = (typeof transitions)[number];

const isTransition = (value: unknown): value is Transition =>
  transitions.includes(value as Transition);

const applyToTypes = ['newView', 'oldView', 'bothViews'] as const;
type ApplyTo = (typeof applyToTypes)[number];

const isApplyTo = (value: unknown): value is ApplyTo =>
  applyToTypes.includes(value as ApplyTo);

type AnimationDefinition = { animationName: string; zIndex?: number };

const ANIMATIONS: Record<
  Transition,
  Record<ApplyTo, { out: AnimationDefinition; in: AnimationDefinition }>
> = {
  slideLeft: {
    newView: {
      out: { animationName: 'none', zIndex: 0 },
      in: { animationName: 'slide-in-from-right', zIndex: 1 },
    },
    oldView: {
      out: { animationName: 'slide-out-to-left', zIndex: 1 },
      in: { animationName: 'none', zIndex: 0 },
    },
    bothViews: {
      out: { animationName: 'slide-out-to-left' },
      in: { animationName: 'slide-in-from-right' },
    },
  },
  slideRight: {
    newView: {
      out: { animationName: 'none', zIndex: 0 },
      in: { animationName: 'slide-in-from-left', zIndex: 1 },
    },
    oldView: {
      out: { animationName: 'slide-out-to-right', zIndex: 1 },
      in: { animationName: 'none', zIndex: 0 },
    },
    bothViews: {
      out: { animationName: 'slide-out-to-right' },
      in: { animationName: 'slide-in-from-left' },
    },
  },
  slideUp: {
    newView: {
      out: { animationName: 'none', zIndex: 0 },
      in: { animationName: 'slide-in-from-bottom', zIndex: 1 },
    },
    oldView: {
      out: { animationName: 'slide-out-to-top', zIndex: 1 },
      in: { animationName: 'none', zIndex: 0 },
    },
    bothViews: {
      out: { animationName: 'slide-out-to-top' },
      in: { animationName: 'slide-in-from-bottom' },
    },
  },
  slideDown: {
    newView: {
      out: { animationName: 'none', zIndex: 0 },
      in: { animationName: 'slide-in-from-top', zIndex: 1 },
    },
    oldView: {
      out: { animationName: 'slide-out-to-bottom', zIndex: 1 },
      in: { animationName: 'none', zIndex: 0 },
    },
    bothViews: {
      out: { animationName: 'slide-out-to-bottom' },
      in: { animationName: 'slide-in-from-top' },
    },
  },
  fade: {
    newView: {
      out: { animationName: 'fade-out', zIndex: 0 },
      in: { animationName: 'fade-in', zIndex: 1 },
    },
    oldView: {
      out: { animationName: 'fade-out', zIndex: 0 },
      in: { animationName: 'fade-in', zIndex: 1 },
    },
    bothViews: {
      out: { animationName: 'fade-out' },
      in: { animationName: 'fade-in' },
    },
  },
};

/**
 * Changes the direction of the animation for the view transition.
 */
function applyTransitionStyles(transition: Transition, applyTo: ApplyTo) {
  const animationDefinition = ANIMATIONS[transition][applyTo];

  document.documentElement.style.setProperty(
    '--direction-out',
    animationDefinition.out.animationName,
  );
  document.documentElement.style.setProperty(
    '--view-transition-out-z-index',
    animationDefinition.out.zIndex?.toString() ?? 'auto',
  );
  document.documentElement.style.setProperty(
    '--direction-in',
    animationDefinition.in.animationName,
  );
  document.documentElement.style.setProperty(
    '--view-transition-in-z-index',
    animationDefinition.in.zIndex?.toString() ?? 'auto',
  );
}

function removeTransitionStyles() {
  document.documentElement.style.removeProperty('--direction-out');
  document.documentElement.style.removeProperty('--direction-in');
  document.documentElement.style.removeProperty('--view-transition-in-z-index');
  document.documentElement.style.removeProperty(
    '--view-transition-out-z-index',
  );
}

type ViewTransitionState = {
  transition: Transition;
  applyTo: ApplyTo;
};

function getViewTransitionState(state: unknown): ViewTransitionState | null {
  if (state == null || typeof state !== 'object') {
    return null;
  }

  if (!('transition' in state) || !isTransition(state.transition)) {
    return null;
  }

  const applyTo =
    'applyTo' in state && isApplyTo(state.applyTo)
      ? state.applyTo
      : 'bothViews';

  return { transition: state.transition, applyTo };
}

/**
 * View transition scopes allow components to opt-in to named view transitions
 * only when navigating within a specific feature/scope.
 *
 * This is useful for element-level transitions (e.g., list items expanding to detail views)
 * that should only animate for internal navigation within that feature, not when
 * entering from or exiting to external pages.
 */
type ViewTransitionScope = string;

function getViewTransitionScope(state: unknown): ViewTransitionScope | null {
  if (state == null || typeof state !== 'object') {
    return null;
  }
  if (
    'viewTransitionScope' in state &&
    typeof state.viewTransitionScope === 'string'
  ) {
    return state.viewTransitionScope;
  }
  return null;
}

/**
 * Checks if viewTransitionName should be applied for elements within a scope.
 *
 * @param targetScope - The scope identifier to check against
 * @returns true if names should be applied (internal navigation), false otherwise
 */
function useIsInScope(targetScope: ViewTransitionScope): boolean {
  const location = useLocation();
  const navigation = useNavigation();
  const [hasSettled, setHasSettled] = useState(false);

  // ---------------------------------------------------------------------------
  // Problem: View Transitions API captures "old" and "new" DOM snapshots.
  // Elements with matching viewTransitionName in both snapshots morph together.
  //
  // For scoped element transitions (e.g., list item → detail view), we need:
  // - Names applied for INTERNAL navigation (both snapshots have the element)
  // - Names NOT applied for EXTERNAL navigation (only one snapshot has it)
  //
  // Challenge: React Router uses flushSync for view transitions, which causes
  // effects to run synchronously BEFORE the browser captures the new snapshot.
  // If we set hasSettled=true immediately, names get applied too early.
  //
  // Solution: Use requestAnimationFrame to delay hasSettled until after the
  // browser has captured its snapshot (next frame).
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (navigation.state === 'idle') {
      const frameId = requestAnimationFrame(() => {
        setHasSettled(true);
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [navigation.state]);

  const navigatingScope = navigation.location
    ? getViewTransitionScope(navigation.location.state)
    : null;

  // Exit early when leaving to a non-scoped destination.
  // This lets the page-level transition handle the exit animation.
  if (navigation.state === 'loading' && navigatingScope !== targetScope) {
    return false;
  }

  const currentScope = getViewTransitionScope(location.state);

  // Apply names when:
  // - hasSettled: Page settled, ready to be captured as "old" state
  // - navigatingScope matches: Outgoing internal nav, capture "old" state
  // - currentScope matches: Incoming internal nav, capture "new" state
  return (
    hasSettled ||
    navigatingScope === targetScope ||
    currentScope === targetScope
  );
}

/**
 * Hook that returns a function to generate scoped view transition names.
 *
 * Use this to conditionally apply viewTransitionName to elements that should only
 * animate during internal navigation within a feature scope.
 *
 * @example
 * ```tsx
 * const vtn = useScopedTransitionName('my-feature');
 *
 * <div style={{ viewTransitionName: vtn(`item-${id}`) }}>
 *   ...
 * </div>
 * ```
 */
export function useScopedTransitionName(
  scope: ViewTransitionScope,
): (name: string) => string | undefined {
  const isInScope = useIsInScope(scope);
  return (name: string) => (isInScope ? name : undefined);
}

// This value is repeated in transitions.css. When changing make sure to keep them in sync!
export const VIEW_TRANSITION_DURATION_MS = 180;

/**
 * Applies the animation direction styles based on the navigation state.
 * Must be used in the root component of the app.
 */
export function useViewTransitionEffect() {
  const navigation = useNavigation();

  useEffect(() => {
    if (navigation.state === 'loading') {
      const state = getViewTransitionState(navigation.location.state);
      if (state) {
        applyTransitionStyles(state.transition, state.applyTo);
      } else {
        removeTransitionStyles();
      }
    } else if (navigation.state === 'idle') {
      // Clear transition CSS variables after navigation completes to prevent
      // stale values from causing incorrect animation directions on subsequent navigations.
      // If we don't do this, then subsequent animations may reuse the old values.

      // Wait for current animation to finish before cleanup, otherwise the animation gets interrupted.
      const animationDurationMs = VIEW_TRANSITION_DURATION_MS;
      new Promise((resolve) => setTimeout(resolve, animationDurationMs)).then(
        () => {
          removeTransitionStyles();
        },
      );
    }
  }, [navigation]);
}

type ViewTransitionCommonProps = {
  transition?: Transition;
  applyTo?: ApplyTo;
  /** Scope for element-level transitions. Use with useScopedTransitionName in target components. */
  scope?: ViewTransitionScope;
};

export type ViewTransitionLinkProps = ViewTransitionCommonProps & {
  as?: typeof Link;
} & React.ComponentProps<typeof Link>;

type ViewTransitionNavLinkProps = ViewTransitionCommonProps & {
  as: typeof NavLink;
} & React.ComponentProps<typeof NavLink>;

/**
 * A wrapper around Link/NavLink that when used will animate the page transitions.
 *
 * Default is to prefetch the link when it is rendered to optimize the mobile experience,
 * but this can be overridden by setting the prefetch prop.
 */
export function LinkWithViewTransition<
  T extends ViewTransitionLinkProps | ViewTransitionNavLinkProps,
>({ transition, applyTo = 'bothViews', scope, as = Link, ...props }: T) {
  const commonProps = {
    ...props,
    prefetch: props.prefetch ?? 'viewport',
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Apply styles synchronously on click, before React Router starts the view transition.
      // This is necessary because Link navigations to prefetched/cached routes skip the
      // "loading" state entirely, so our useEffect never gets a chance to apply styles.
      // Browser back/forward (popstate) navigations still go through loading state and
      // will be handled by useViewTransitionEffect.
      if (transition) {
        applyTransitionStyles(transition, applyTo);
      }
      props.onClick?.(event);
    },
    viewTransition: true,
    state: {
      ...props.state,
      ...(transition ? { transition, applyTo } : {}),
      ...(scope ? { viewTransitionScope: scope } : {}),
    },
  };

  if (as === NavLink) {
    return <NavLink {...(commonProps as ComponentProps<typeof NavLink>)} />;
  }

  return <Link {...(commonProps as ComponentProps<typeof Link>)} />;
}

export type NavigateWithViewTransitionOptions = NavigateOptions &
  Partial<ViewTransitionState> & {
    /** Scope for element-level transitions. Use with useViewTransitionScope in target components. */
    scope?: ViewTransitionScope;
  };

export function useNavigateWithViewTransition() {
  const navigate = useNavigate();

  return (
    to: To,
    {
      transition,
      applyTo = 'bothViews',
      scope,
      state,
      ...options
    }: NavigateWithViewTransitionOptions,
  ) => {
    // Apply styles synchronously before navigate, for the same reason as in LinkWithViewTransition.
    if (transition) {
      applyTransitionStyles(transition, applyTo);
    }

    navigate(to, {
      ...options,
      viewTransition: true,
      state: {
        ...(state ?? {}),
        ...(transition ? { transition, applyTo } : {}),
        ...(scope ? { viewTransitionScope: scope } : {}),
      },
    });
  };
}
