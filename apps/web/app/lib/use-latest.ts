import { useRef } from 'react';
import { useIsomorphicLayoutEffect } from 'usehooks-ts';

export function useLatest<T>(value: T) {
  const ref = useRef(value);

  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}
