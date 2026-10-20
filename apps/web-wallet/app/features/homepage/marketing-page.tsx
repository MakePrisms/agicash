import { MarketingNav } from './components/marketing-nav';
import { BuySection } from './sections/buy-section';
import { CtaSection } from './sections/cta-section';
import { FooterSection } from './sections/footer-section';
import { HeroSection } from './sections/hero-section';
import { MerchantsSection } from './sections/merchants-section';
import { SendSection } from './sections/send-section';
import { SpendSection } from './sections/spend-section';
import { WalletSection } from './sections/wallet-section';
import './styles.css';

export function MarketingPage() {
  return (
    <div className="marketing scrollbar-none h-dvh overflow-y-auto overflow-x-hidden bg-[color:var(--mk-bg)] text-[color:var(--mk-text)] [font-family:var(--mk-font-display)]">
      <MarketingNav />
      <div className="border-[color:var(--mk-border)] border-b bg-[rgba(0,212,255,0.06)] px-5 py-3 md:px-8">
        <p className="mx-auto max-w-6xl text-balance text-center font-mono text-[color:var(--mk-text)] text-xs md:text-[13px]">
          <span aria-hidden="true" className="text-[color:var(--mk-brand)]">
            {'> '}
          </span>
          Agicash has shut down its services effective October 1, 2026.
        </p>
      </div>
      <main>
        <HeroSection />
        <BuySection />
        <SendSection />
        <SpendSection />
        <WalletSection />
        <CtaSection />
        <MerchantsSection />
      </main>
      <FooterSection />
    </div>
  );
}
