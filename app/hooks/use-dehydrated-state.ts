/*
This hook is copied from https://github.com/maplegrove-io/use-dehydrated-state/blob/main/src/index.ts
and modified to work with the react-router v7.
*/

import type { DehydratedState } from '@tanstack/react-query';
import merge from 'deepmerge';
import { useMatches } from 'react-router';

export const useDehydratedState = (): DehydratedState | undefined => {
  const matches = useMatches();
  const dehydratedState = matches
    .map(
      (match) =>
        (match.loaderData as { dehydratedState?: DehydratedState } | undefined)
          ?.dehydratedState,
    )
    .filter((x): x is DehydratedState => Boolean(x));

  return dehydratedState.length
    ? dehydratedState.reduce(
        (accumulator, currentValue) => merge(accumulator, currentValue),
        {} as DehydratedState,
      )
    : undefined;
};
