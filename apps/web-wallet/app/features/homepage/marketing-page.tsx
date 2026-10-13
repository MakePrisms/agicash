import { MarketingNav } from './components/marketing-nav';
import { BuySection } from './sections/buy-section';
import { CtaSection } from './sections/cta-section';
import { FooterSection } from './sections/footer-section';
import { HeroSection } from './sections/hero-section';
import { MerchantsSection } from './sections/merchants-section';
import { SendSection } from './sections/send-section';
import { SpendSection } from './sections/spend-section';
import { WalletSection } from './sections/wallet-section';

const marketingVars: React.CSSProperties = {
  '--mk-bg': '#04080f',
  '--mk-bg-card': 'rgba(12, 20, 36, 0.5)',
  '--mk-text': '#e8edf8',
  '--mk-text-dim': '#8094b8',
  '--mk-text-muted': '#455575',
  '--mk-brand': '#00d4ff',
  '--mk-border': 'rgba(255, 255, 255, 0.06)',
  '--mk-border-bright': 'rgba(255, 255, 255, 0.12)',
  '--mk-font-display':
    '"Cabinet Grotesk", -apple-system, BlinkMacSystemFont, sans-serif',
  '--mk-font-mono': '"Kode Mono", ui-monospace, monospace',
  '--mk-font-numeric': '"Teko", sans-serif',
} as React.CSSProperties;

export function MarketingPage() {
  return (
    <div
      className="marketing scrollbar-none h-dvh overflow-y-auto overflow-x-hidden bg-[color:var(--mk-bg)] text-[color:var(--mk-text)] antialiased [font-family:var(--mk-font-display)] [font-feature-settings:'ss01','ss02']"
      style={marketingVars}
    >
      <MarketingNav />
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
