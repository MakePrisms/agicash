import { type ComponentProps, useEffect } from 'react';
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

const REVERSE_TRANSITION: Record<Transition, Transition> = {
  slideLeft: 'slideRight',
  slideRight: 'slideLeft',
  slideUp: 'slideDown',
  slideDown: 'slideUp',
  fade: 'fade',
};

const REVERSE_APPLY_TO: Record<ApplyTo, ApplyTo> = {
  newView: 'oldView',
  oldView: 'newView',
  bothViews: 'bothViews',
};

function reverseViewTransitionState(
  state: ViewTransitionState,
): ViewTransitionState {
  return {
    transition: REVERSE_TRANSITION[state.transition],
    applyTo: REVERSE_APPLY_TO[state.applyTo],
  };
}

// Track history position to detect browser back vs forward navigation.
// React Router stores { usr, key, idx } in window.history.state where idx
// is an incrementing history index.
let lastHistoryIdx: number | undefined;
let isPendingPopBack = false;

function getHistoryIdx(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const state = window.history.state as { idx?: number } | null;
  return state?.idx;
}

function initPopStateTracking() {
  if (typeof window === 'undefined') return;

  lastHistoryIdx = getHistoryIdx();

  window.addEventListener('popstate', () => {
    const currentIdx = getHistoryIdx();
    isPendingPopBack =
      lastHistoryIdx != null &&
      currentIdx != null &&
      currentIdx < lastHistoryIdx;
    lastHistoryIdx = currentIdx;
  });
}

initPopStateTracking();

function applyViewTransitionState(state: ViewTransitionState | null) {
  if (state) {
    applyTransitionStyles(state.transition, state.applyTo);
  } else {
    removeTransitionStyles();
  }
}

// This value is repeated in transitions.css. When changing make sure to keep them in sync!
export const VIEW_TRANSITION_DURATION_MS = 180;

/**
 * Applies the animation direction styles based on the navigation state.
 * Must be used in the root component of the app.
 *
 * For programmatic navigations (links, navigate calls), transition styles are
 * applied synchronously in the click/navigate handler before React Router starts.
 *
 * For browser back/forward (popstate) navigations, this hook determines the
 * correct transition by comparing history indices:
 * - Back: reverses the transition used to arrive at the current page
 * - Forward: uses the transition stored in the target page's state
 */
export function useViewTransitionEffect() {
  const navigation = useNavigation();
  const location = useLocation();

  useEffect(() => {
    if (navigation.state === 'loading') {
      if (isPendingPopBack) {
        // Browser back: reverse the transition that was used to navigate
        // to the current page so the animation visually "undoes" the arrival.
        isPendingPopBack = false;
        const currentState = getViewTransitionState(location.state);
        applyViewTransitionState(
          currentState ? reverseViewTransitionState(currentState) : null,
        );
      } else {
        // Browser forward or programmatic navigation: use the transition
        // stored in the target page's state. For programmatic navigations,
        // styles are already applied synchronously by LinkWithViewTransition/
        // useNavigateWithViewTransition; this handles the fallback for
        // non-prefetched routes that go through loading.
        applyViewTransitionState(
          getViewTransitionState(navigation.location.state),
        );
      }
    } else if (navigation.state === 'idle') {
      // Update tracked history index after programmatic navigations complete.
      lastHistoryIdx = getHistoryIdx();

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
  }, [navigation, location.state]);
}

type ViewTransitionCommonProps = {
  transition: Transition;
  applyTo?: ApplyTo;
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
>({ transition, applyTo = 'bothViews', as = Link, ...props }: T) {
  const linkState: ViewTransitionState = {
    transition,
    applyTo,
  };

  const commonProps = {
    ...props,
    prefetch: props.prefetch ?? 'viewport',
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Apply styles synchronously on click, before React Router starts the view transition.
      // This is necessary because Link navigations to prefetched/cached routes skip the
      // "loading" state entirely, so our useEffect never gets a chance to apply styles.
      // Browser back/forward (popstate) navigations still go through loading state and
      // will be handled by useViewTransitionEffect.
      applyTransitionStyles(transition, applyTo);
      props.onClick?.(event);
    },
    viewTransition: true,
    state: { ...props.state, ...linkState },
  };

  if (as === NavLink) {
    return <NavLink {...(commonProps as ComponentProps<typeof NavLink>)} />;
  }

  return <Link {...(commonProps as ComponentProps<typeof Link>)} />;
}

export type NavigateWithViewTransitionOptions = NavigateOptions &
  ViewTransitionState;

export function useNavigateWithViewTransition() {
  const navigate = useNavigate();

  return (
    to: To,
    {
      transition,
      applyTo = 'bothViews',
      state,
      ...options
    }: NavigateWithViewTransitionOptions,
  ) => {
    // Apply styles synchronously before navigate, for the same reason as in LinkWithViewTransition.
    applyTransitionStyles(transition, applyTo);

    navigate(to, {
      ...options,
      viewTransition: true,
      state: { ...(state ?? {}), transition, applyTo },
    });
  };
}
