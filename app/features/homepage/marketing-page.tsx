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
    <div className="marketing">
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
