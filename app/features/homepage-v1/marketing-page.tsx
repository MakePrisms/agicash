import { AgenticSection } from './sections/agentic-section';
import { CtaSection } from './sections/cta-section';
import { GiftCardsSection } from './sections/gift-cards-section';
import { HeroSection } from './sections/hero-section';
import { MerchantsSection } from './sections/merchants-section';
import { WalletSection } from './sections/wallet-section';
import './styles.css';

export function MarketingPage() {
  return (
    <div className="marketing">
      <main>
        <HeroSection />
        <WalletSection />
        <GiftCardsSection />
        <AgenticSection />
        <CtaSection />
        <MerchantsSection />
      </main>
    </div>
  );
}
