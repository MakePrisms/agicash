import { Section } from '../components/section';
import { SectionLabel } from '../components/section-label';
import { WalletMockup } from '../components/wallet-mockup';

export function WalletSection() {
  return (
    <Section id="wallet">
      <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-[35%_1fr] md:gap-16">
        <div>
          <SectionLabel>01_wallet</SectionLabel>
          <h2 className="mt-5 font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:text-5xl">
            Bitcoin payments. Non-custodial.
          </h2>
          <p className="mt-6 text-[color:var(--mk-text-dim)] text-base leading-relaxed md:text-lg">
            Lightning and Cashu in one wallet. Your keys, your sats, your
            contacts.
          </p>
          <div className="mt-6 font-mono text-[color:var(--mk-text-muted)] text-xs md:text-sm">
            lightning · cashu · spark
          </div>
        </div>
        <div className="flex justify-center md:justify-end">
          <WalletMockup />
        </div>
      </div>
    </Section>
  );
}
