import btcpayLogoUrl from '~/assets/btcpay-logo.svg';
import shopifyLogoUrl from '~/assets/shopify-logo.svg';
import squareLogoUrl from '~/assets/square-logo.svg';
import { MarketingCard } from '../components/marketing-card';
import { SectionLabel } from '../components/section-label';

const supportedSystems = [
  { name: 'Square', src: squareLogoUrl },
  { name: 'BTCPay Server', src: btcpayLogoUrl },
  { name: 'Shopify', src: shopifyLogoUrl },
];

export function MerchantsSection() {
  return (
    <section className="relative w-full border-[color:var(--mk-border)] border-t px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-xl">
        <MarketingCard className="text-center">
          <div className="flex justify-center">
            <SectionLabel>for_merchants</SectionLabel>
          </div>
          <h2 className="mt-7 font-medium font-mono text-2xl leading-[1.2] tracking-[-0.02em] md:text-3xl">
            <a id="merchants" href="#merchants">
              Run a store? Issue bitcoin gift cards today.
            </a>
          </h2>
          <p className="mt-4 text-[color:var(--mk-text-dim)] text-base leading-relaxed">
            Closed-loop bitcoin gift cards for your shop. No fees, instant
            settlement, no new hardware. We&apos;d love to talk.
          </p>
          <div className="mt-7 flex justify-center">
            <a
              href="https://waitlist.agi.cash/merchants"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center font-mono text-[color:var(--mk-text)] text-sm tracking-wide transition-colors duration-200 hover:text-[color:var(--mk-brand)]"
            >
              <span
                aria-hidden="true"
                className="mr-2 text-[color:var(--mk-text-muted)]"
              >
                {'>'}
              </span>
              join the waitlist
            </a>
          </div>

          <div className="mt-7 border-[color:var(--mk-border)] border-t pt-[22px] text-center">
            <div className="mb-4 text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.2em] [font-family:var(--mk-font-mono)]">
              supported systems
            </div>
            <div className="mb-[14px] flex flex-wrap items-center justify-center gap-7 text-[color:var(--mk-text-dim)]">
              {supportedSystems.map((s) => (
                <img
                  key={s.name}
                  src={s.src}
                  alt={s.name}
                  className="block h-[30px] w-auto opacity-90"
                />
              ))}
            </div>
            <div className="text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em] opacity-70 [font-family:var(--mk-font-mono)]">
              more coming soon
            </div>
          </div>
        </MarketingCard>
      </div>
    </section>
  );
}
