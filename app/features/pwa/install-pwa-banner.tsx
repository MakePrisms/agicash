import { useState } from 'react';
import { useTimeout } from 'usehooks-ts';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

const DEFAULT_DISMISS_DELAY_MS = 300;
const DEFAULT_INITIAL_SHOW_DELAY_MS = 2000;

/** Return type for the useBanner hook */
type UseBannerReturn = {
  /** Whether the banner is currently visible */
  isVisible: boolean;
  /** Function to dismiss/hide the banner */
  handleDismiss: () => void;
};

/** Options for configuring the useBanner hook */
type UseBannerOptions = {
  /** Delay in ms before initially showing the banner. Defaults to 2000ms */
  initialShowDelay?: number;
  /** Delay in ms before the banner is dismissed. Defaults to 300ms */
  onDismissedDelay?: number;
};

/**
 * Hook for managing a banner component
 * @param onDismissed Optional callback that will be called after the banner is dismissed
 * @param options Configuration options
 */
function useBanner(
  onDismissed?: () => void,
  options: UseBannerOptions = {},
): UseBannerReturn {
  const [isVisible, setIsVisible] = useState(false);

  const onDismissedDelay = options.onDismissedDelay ?? DEFAULT_DISMISS_DELAY_MS;
  const initialShowDelay =
    options.initialShowDelay ?? DEFAULT_INITIAL_SHOW_DELAY_MS;

  // Show the banner after initial delay
  useTimeout(() => setIsVisible(true), initialShowDelay);

  const handleDismiss = () => {
    setIsVisible(false);
    if (onDismissed) {
      setTimeout(onDismissed, onDismissedDelay);
    }
  };

  return {
    isVisible,
    handleDismiss,
  };
}

export default function InstallPwaBanner({
  onClickInstall,
  onDismiss,
}: { onClickInstall: () => void; onDismiss: () => void }) {
  const { isVisible, handleDismiss } = useBanner(onDismiss);

  return (
    <div
      className={cn(
        'fixed right-0 bottom-[env(safe-area-inset-bottom)] left-0 transform transition-all duration-300 ease-in-out',
        'z-20 border-t bg-background p-4',
        isVisible ? 'translate-y-0' : 'translate-y-full',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Install Agicash for the best experience.
        </p>
        <div className="flex gap-4">
          <Button variant="outline" size="sm" onClick={handleDismiss}>
            Not now
          </Button>
          <Button variant="outline" size="sm" onClick={onClickInstall}>
            Install
          </Button>
        </div>
      </div>
    </div>
  );
}
