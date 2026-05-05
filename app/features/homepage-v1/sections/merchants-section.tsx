import { MarketingCard } from '../components/marketing-card';
import { SectionLabel } from '../components/section-label';

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
          <h2 className="mt-4 font-medium font-mono text-2xl leading-[1.2] tracking-[-0.02em] md:text-3xl">
            For merchants.
          </h2>
          <p className="mt-4 text-[color:var(--mk-text-dim)] text-base leading-relaxed">
            Offer Bitcoin gift cards and rewards, accept Lightning payments at
            checkout, or enable agentic payments for your service. We&apos;d
            love to talk.
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
        </MarketingCard>
      </div>

      <footer className="mx-auto mt-20 max-w-xl text-center">
        <div className="font-mono text-[color:var(--mk-text-muted)] text-xs">
          <a className="mk-link" href="https://agi.cash">
            agi.cash
          </a>
          <span aria-hidden="true"> · </span>
          <span>2026</span>
          <span aria-hidden="true"> · </span>
          <a className="mk-link" href="/privacy">
            privacy
          </a>
          <span aria-hidden="true"> · </span>
          <a className="mk-link" href="/terms">
            terms
          </a>
          <span aria-hidden="true"> · </span>
          <a
            className="mk-link"
            href="https://discord.gg/e2TSCfXxhd"
            target="_blank"
            rel="noopener noreferrer"
          >
            discord
          </a>
        </div>
      </footer>
    </section>
  );
}
