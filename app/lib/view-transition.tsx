import { Link, NavLink, useNavigation } from '@remix-run/react';
import { type ComponentProps, useEffect } from 'react';

const transitions = [
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
] as const;
export type Transition = (typeof transitions)[number];

const isTransition = (value: unknown): value is Transition =>
  transitions.includes(value as Transition);

const applyToTypes = ['newView', 'oldView', 'bothViews'] as const;
export type ApplyTo = (typeof applyToTypes)[number];

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
 * Applies the animation direction styles based on the navigation state.
 * Must be used in the root component of the app.
 */
export function useViewTransitionEffect() {
  const navigation = useNavigation();

  useEffect(() => {
    if (navigation.state === 'loading') {
      const state = getViewTransitionState(navigation.location.state);
      console.log('nvaigation state: ', state);
      if (state) {
        applyTransitionStyles(state.transition, state.applyTo);
      } else {
        removeTransitionStyles();
      }
    }
  }, [navigation]);
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
export function ViewTransition<
  T extends ViewTransitionLinkProps | ViewTransitionNavLinkProps,
>({ transition, applyTo = 'bothViews', as = Link, ...props }: T) {
  const linkState: ViewTransitionState = {
    transition,
    applyTo,
  };

  const commonProps = {
    ...props,
    prefetch: props.prefetch ?? 'viewport',
    onClick: props.onClick,
    viewTransition: true,
    state: linkState,
  };

  if (as === NavLink) {
    return <NavLink {...(commonProps as ComponentProps<typeof NavLink>)} />;
  }

  return <Link {...(commonProps as ComponentProps<typeof Link>)} />;
}
