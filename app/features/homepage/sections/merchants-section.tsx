import btcpayLogoUrl from '~/assets/btcpay-logo.svg';
import shopifyLogoUrl from '~/assets/shopify-logo.svg';
import squareLogoUrl from '~/assets/square-logo.svg';
import { MarketingCard } from '../components/marketing-card';
import { SectionLabel } from '../components/section-label';

// Brand wordmarks rendered as inline SVG so they sit on the dark card cleanly
function SquareLogo() {
  return (
    <img
      className="brand-logo-img"
      src={squareLogoUrl}
      alt="Square"
      height={20}
    />
  );
}

function BTCPayServerLogo() {
  return (
    <img
      className="brand-logo-img"
      src={btcpayLogoUrl}
      alt="BTCPay Server"
      height={28}
    />
  );
}

function ShopifyLogo() {
  return (
    <img
      className="brand-logo-img"
      src={shopifyLogoUrl}
      alt="Shopify"
      height={28}
    />
  );
}

export function MerchantsSection() {
  return (
    <section
      id="merchants"
      className="relative w-full border-[color:var(--mk-border)] border-t px-5 py-20 md:px-8 md:py-28"
    >
      <div className="mx-auto max-w-xl">
        <MarketingCard className="text-center">
          <div className="flex justify-center">
            <SectionLabel>for_merchants</SectionLabel>
          </div>
          <h2 className="mt-7 font-medium font-mono text-2xl leading-[1.2] tracking-[-0.02em] md:text-3xl">
            Run a store? Issue bitcoin gift cards today.
          </h2>
          <p className="mt-4 text-[color:var(--mk-text-dim)] text-base leading-relaxed">
            Closed-loop bitcoin gift cards for your shop. No fees, instant
            settlement, no new hardware. We&apos;d love to talk.
          </p>
          <div className="mt-7 flex justify-center">
            <a
              href="mailto:merchants@agi.cash"
              className="mk-mailto inline-flex items-center font-mono text-sm tracking-wide"
            >
              <span
                aria-hidden="true"
                className="mr-2 text-[color:var(--mk-text-muted)]"
              >
                {'>'}
              </span>
              contact · merchants@agi.cash
            </a>
          </div>

          <div className="supported-systems">
            <div className="supported-heading">supported systems</div>
            <div className="supported-row">
              <SquareLogo />
              <BTCPayServerLogo />
              <ShopifyLogo />
            </div>
            <div className="supported-more">more coming soon</div>
          </div>
        </MarketingCard>
      </div>
    </section>
  );
}
