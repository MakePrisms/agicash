export function buildCashAppDeepLink(paymentRequest: string) {
  return `https://cash.app/launch/lightning/${paymentRequest}`;
}

export const CASH_APP_LOGO_URL =
  'https://static.afterpaycdn.com/en-US/integration/logo/lockup/cashapp-color-white-32.svg';

export function CashAppLogo({ className }: { className?: string }) {
  return (
    <img
      src={CASH_APP_LOGO_URL}
      alt="Cash App"
      className={className}
      loading="eager"
    />
  );
}
