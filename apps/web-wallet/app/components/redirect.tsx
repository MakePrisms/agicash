import type { PropsWithChildren } from 'react';
import { useNavigate } from 'react-router';
import type { NavigateOptions, To } from 'react-router';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';

type Props = PropsWithChildren<{
  to: To;
  options?: NavigateOptions;
  logMessage?: string;
}>;

/**
 * Executes only on the initial render so any subsequent prop changes won't cause a redirect
 */
export const Redirect = ({
  to,
  options,
  children = null,
  logMessage,
}: Props) => {
  const navigate = useNavigate();

  // biome-ignore lint/correctness/useExhaustiveDependencies: we only want to run this once no matter if props change
  useEffectNoStrictMode(() => {
    logMessage && console.debug(logMessage);
    navigate(to, options);
  }, []);

  return children;
};
