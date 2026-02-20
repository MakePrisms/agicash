import {
  WalletCard,
  WalletCardBlank,
  WalletCardOverlay,
} from '~/components/wallet-card';

/**
 * Placeholder displayed when user has no gift cards.
 */
export function EmptyState() {
  return (
    <>
      <div className="flex-1" />
      <div className="flex w-full max-w-sm items-center justify-center px-4">
        <WalletCard className="w-full max-w-none">
          <WalletCardBlank />
          <WalletCardOverlay className="flex items-center justify-center">
            <div className="w-full text-center">
              <p className="text-lg text-white">Add a gift card</p>
              <p className="mt-2 text-white/60">
                The easiest way to share
                <br />
                and spend bitcoin.
              </p>
            </div>
          </WalletCardOverlay>
        </WalletCard>
      </div>
      <div className="flex-1" />
    </>
  );
}
