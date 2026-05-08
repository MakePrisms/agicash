import { useLocalStorage } from 'usehooks-ts';
import useIsPwa from '~/hooks/use-is-pwa';
import useUserAgent from '~/hooks/use-user-agent';

type DismissedValue =
  | { state: 'dismissed' }
  | { state: 'dismissed-temporarily'; showAfterTimestamp: number }
  | null;

const PROMPT_PERMANENTLY_DISMISSED: DismissedValue = { state: 'dismissed' };

/**
 * Generic hook that uses localStorage to manage when to show a prompt
 * @param promptName - The name of the prompt to manage
 * @example
 * ```tsx
 * const {
 *   shouldShow,
 *   handleDontShowAgain,
 *   handleDismissTemporarily
 * } = useShouldShowPrompt('showInstallPwaPrompt');
 * ```
 * */
const useShouldShowPrompt = (promptName: string) => {
  const [dismissedState, setDismissedState] = useLocalStorage<DismissedValue>(
    promptName,
    null,
  );

  const handleDontShowAgain = () => {
    setDismissedState(PROMPT_PERMANENTLY_DISMISSED);
  };

  const handleDismissTemporarily = (showAfter: number) => {
    const showAgainTimestamp = Date.now() + showAfter;
    setDismissedState({
      state: 'dismissed-temporarily',
      showAfterTimestamp: showAgainTimestamp,
    });
  };

  const isPermantentlyDismissed = dismissedState?.state === 'dismissed';
  const isTemporarilyDismissed =
    dismissedState?.state === 'dismissed-temporarily' &&
    Date.now() <= dismissedState.showAfterTimestamp;

  const shouldShow = !isPermantentlyDismissed && !isTemporarilyDismissed;

  return { shouldShow, handleDontShowAgain, handleDismissTemporarily };
};

const key = 'showPwaPrompt';
const TEMPORARY_DISMISS_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours

type Return = {
  /** True if the PWA prompt should be shown based on the user's browser, device, and if the app is already installed */
  shouldShowPwaPrompt: boolean;
  /** Function to permanently dismiss the PWA prompt */
  dontShowAgain: () => void;
  /** Function to temporarily dismiss the PWA prompt */
  dismissTemporarily: () => void;
};

/** Hook for managing when to show the PWA prompt */
export default function useShouldShowPwaPrompt(): Return {
  const { shouldShow, handleDontShowAgain, handleDismissTemporarily } =
    useShouldShowPrompt(key);
  const { isMobile } = useUserAgent();
  const isPwa = useIsPwa();

  const shouldShowPwaPrompt = shouldShow && isMobile && !isPwa;

  return {
    shouldShowPwaPrompt,
    dontShowAgain: handleDontShowAgain,
    dismissTemporarily: () =>
      handleDismissTemporarily(TEMPORARY_DISMISS_DURATION_MS),
  };
}
