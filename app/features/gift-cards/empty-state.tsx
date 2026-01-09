import {
  WalletCard,
  WalletCardBlank,
  WalletCardOverlay,
} from '~/components/wallet-card';

import { CARD_WIDTH } from './card-stack.constants';

/**
 * Placeholder displayed when user has no gift cards.
 */
export function EmptyState() {
  return (
    <>
      <div className="flex-1" />
      <div className="w-full shrink-0 px-4" style={{ maxWidth: CARD_WIDTH }}>
        <WalletCard className="w-full max-w-none">
          <WalletCardBlank />
          <WalletCardOverlay className="flex items-center justify-center">
            <div className="w-full text-center">
              <p className="text-white text-xl">Add a gift card.</p>
              <p className="mt-2 text-white/60">
                The easiest way to share and spend bitcoin.
              </p>
            </div>
          </WalletCardOverlay>
        </WalletCard>
      </div>
      <div className="flex-1" />
    </>
  );
}
