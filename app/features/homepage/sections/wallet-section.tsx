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
          <SectionLabel href="#wallet">04_wallet</SectionLabel>
          <h2 className="mt-8 font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:hidden">
            <a href="#wallet">The most advanced bitcoin wallet.</a>
          </h2>
          <p className="mt-6 text-[color:var(--mk-text-dim)] text-base leading-relaxed md:hidden">
            Agicash is a non-custodial bitcoin wallet built on secure enclaves
            to enable cross-device sync and email login. Built on the latest
            bitcoin payment protocols.
          </p>

          <div className="mt-10 md:mt-8">
            <div className="mx-auto w-full max-w-[320px] rounded-[18px] border border-[color:var(--mk-border)] bg-[linear-gradient(180deg,#070d18_0%,#050a13_100%)] px-[22px] pt-[22px] pb-5 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] [font-family:var(--mk-font-display)]">
              <div className="mb-[18px] flex items-center justify-between">
                <span className="text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em] [font-family:var(--mk-font-mono)]">
                  bitcoin
                </span>
              </div>
              <div className="mb-[18px] text-[12px] text-[color:var(--mk-text-dim)] [font-family:var(--mk-font-mono)]">
                bob@agi.cash
              </div>
              <div className="text-center font-semibold text-[52px] text-[color:var(--mk-text)] tabular-nums leading-none tracking-[0.01em] [font-family:var(--mk-font-numeric)]">
                <span className="mr-[0.06em] inline-block align-[0.02em] font-bold text-[0.86em] [font-family:var(--mk-font-mono)]">
                  ₿
                </span>
                142,800
              </div>
              <div className="mt-1.5 mb-[22px] text-center font-medium text-[18px] text-[color:var(--mk-text-muted)] tabular-nums leading-none tracking-[0.01em] [font-family:var(--mk-font-numeric)]">
                $145.62
              </div>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <span className="rounded-[10px] border border-[color:var(--mk-border)] bg-transparent py-3 text-center text-[13px] text-[color:var(--mk-text)] [font-family:var(--mk-font-mono)]">
                    Receive
                  </span>
                  <span className="rounded-[10px] border border-[color:var(--mk-border)] bg-transparent py-3 text-center text-[13px] text-[color:var(--mk-text)] [font-family:var(--mk-font-mono)]">
                    Buy
                  </span>
                </div>
                <span className="rounded-[10px] border border-[color:var(--mk-border)] bg-[rgba(255,255,255,0.04)] py-3 text-center text-[13px] text-[color:var(--mk-text)] [font-family:var(--mk-font-mono)]">
                  Send
                </span>
              </div>
              <div className="mt-[18px] flex items-center gap-2 text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.1em] [font-family:var(--mk-font-mono)]">
                <span
                  aria-hidden="true"
                  className="h-[5px] w-[5px] rounded-full bg-[color:var(--mk-brand)] opacity-70"
                />
                synced
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="hidden font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:block md:text-5xl">
            <a href="#wallet">The most advanced bitcoin wallet.</a>
          </h2>
          <p className="mt-6 hidden text-[color:var(--mk-text-dim)] leading-relaxed md:block md:text-lg">
            Agicash is a non-custodial bitcoin wallet built on secure enclaves
            to enable cross-device sync and email login. Built on the latest
            bitcoin payment protocols.
          </p>

          <div className="mt-10 w-full md:mt-12">
            <div className="mb-1.5 border-[color:var(--mk-border)] border-b pb-2 text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.2em] [font-family:var(--mk-font-mono)]">
              specification
            </div>
            {specs.map((s) => (
              <div
                key={s.label}
                className="grid grid-cols-[80px_1fr] items-baseline gap-3 border-[color:var(--mk-border)] border-b py-[14px] last:border-b-0 md:grid-cols-[88px_1fr_auto]"
              >
                <span className="text-[11px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.12em] [font-family:var(--mk-font-mono)]">
                  {s.label}
                </span>
                <span
                  className="spec-leader-line hidden md:block"
                  aria-hidden="true"
                />
                <span className="text-right text-[11px] text-[color:var(--mk-text)] uppercase tabular-nums tracking-[0.12em] [font-family:var(--mk-font-mono)]">
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
