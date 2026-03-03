import { useTheme } from '~/features/theme/use-theme';

export function buildCashAppDeepLink(paymentRequest: string) {
  return `https://cash.app/launch/lightning/${paymentRequest}`;
}

export const CASH_APP_LOGO_WHITE =
  'https://static.afterpaycdn.com/en-US/integration/logo/lockup/cashapp-color-white-32.svg';
export const CASH_APP_LOGO_BLACK =
  'https://static.afterpaycdn.com/en-US/integration/logo/lockup/cashapp-color-black-32.svg';

export function CashAppLogo({ className }: { className?: string }) {
  const { effectiveColorMode } = useTheme();
  const logoUrl =
    effectiveColorMode === 'dark' ? CASH_APP_LOGO_WHITE : CASH_APP_LOGO_BLACK;

  return (
    <img src={logoUrl} alt="Cash App" className={className} loading="eager" />
  );
}
