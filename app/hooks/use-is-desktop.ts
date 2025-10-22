import { useEffect, useState } from 'react';

/**
 * Hook to detect if the viewport is desktop size (matching Tailwind's md breakpoint: >= 768px)
 * Returns true if the viewport is desktop size, false if mobile/tablet
 */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Tailwind's md breakpoint is 768px
    const mediaQuery = window.matchMedia('(min-width: 768px)');

    // Set initial value
    setIsDesktop(mediaQuery.matches);

    // Listen for changes
    const handleChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isDesktop;
}
