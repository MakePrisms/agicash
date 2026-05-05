import { Section } from '../components/section';
import { SectionLabel } from '../components/section-label';

type Spec = { label: string; value: string; mono?: boolean };

const specs: Spec[] = [
  { label: 'Protocol', value: 'cashu · spark', mono: true },
  { label: 'Payments', value: 'lightning, lightning address', mono: true },
  {
    label: 'Features',
    value: 'cross-device sync, encrypted backups',
    mono: true,
  },
  { label: 'Login', value: 'email · google oauth', mono: true },
];

export function WalletSection() {
  return (
    <Section id="wallet">
      <div className="grid grid-cols-1 items-start gap-12 md:grid-cols-[42%_1fr] md:items-center md:gap-20">
        <div className="text-center md:text-left">
          <SectionLabel>04_wallet</SectionLabel>
          <h2 className="mt-8 font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:hidden">
            The most advanced bitcoin wallet.
          </h2>
          <p className="mt-6 text-[color:var(--mk-text-dim)] text-base leading-relaxed md:hidden">
            Agicash is a non-custodial bitcoin wallet built on secure enclaves
            to enable cross-device sync and email login. Built on the latest
            bitcoin payment protocols.
          </p>

          <div className="mt-10 md:mt-8">
            <div className="wallet-card">
              <div className="head">
                <span className="label">bitcoin</span>
              </div>
              <div className="handle">bob@agi.cash</div>
              <div className="balance">
                <span className="btc-symbol">₿</span>142,800
              </div>
              <div className="usd">$145.62</div>
              <div className="actions">
                <div className="actions-row">
                  <span className="btn">Receive</span>
                  <span className="btn">Buy</span>
                </div>
                <span className="btn send">Send</span>
              </div>
              <div className="footer">
                <span className="syncdot" aria-hidden="true" />
                synced
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="hidden font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:block md:text-5xl">
            The most advanced bitcoin wallet.
          </h2>
          <p className="mt-6 hidden text-[color:var(--mk-text-dim)] leading-relaxed md:block md:text-lg">
            Agicash is a non-custodial bitcoin wallet built on secure enclaves
            to enable cross-device sync and email login. Built on the latest
            bitcoin payment protocols.
          </p>

          <div className="spec-table mt-10 md:mt-12">
            <div className="spec-head">specification</div>
            {specs.map((s) => (
              <div className="spec-row" key={s.label}>
                <span className="spec-label">{s.label}</span>
                <span className="spec-leader" aria-hidden="true" />
                <span className={`spec-value ${s.mono ? 'mono' : ''}`}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
