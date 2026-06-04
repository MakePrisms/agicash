import { useCallback, useState } from 'react';

type Options = {
  name: 'shake' | 'slam';
  durationMs?: number;
};

type Result = {
  animationClass: string;
  start: () => void;
};

// NOTE: animations class names must be statically defined so that
// when tailwind scans our source files it can find them
const animations: Record<Options['name'], `animate-${Options['name']}`> = {
  shake: 'animate-shake',
  slam: 'animate-slam',
};

const useAnimation = ({ name, durationMs = 200 }: Options): Result => {
  const [animationClass, setAnimationClass] = useState('');

  const start = useCallback(() => {
    setAnimationClass(animations[name]);
    setTimeout(() => setAnimationClass(''), durationMs);
  }, [name, durationMs]);

  return { animationClass, start };
};

export default useAnimation;
