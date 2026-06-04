import { useMediaQuery } from 'usehooks-ts';

/** Returns true when the app is running as an installed PWA (standalone display mode). */
export default function useIsPwa(): boolean {
  return useMediaQuery('(display-mode: standalone)');
}
