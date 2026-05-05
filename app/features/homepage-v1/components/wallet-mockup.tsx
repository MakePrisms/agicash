type Transaction = {
  label: string;
  meta: string;
  amount: string;
  direction: 'in' | 'out';
};

const transactions: Transaction[] = [
  {
    label: 'Pink Owl Coffee',
    meta: '2026-04-29 · 14:32',
    amount: '4,200',
    direction: 'out',
  },
  {
    label: 'Received from Sasha',
    meta: '2026-04-28 · 09:15',
    amount: '25,000',
    direction: 'in',
  },
  {
    label: 'PubKey NYC',
    meta: '2026-04-26 · 19:48',
    amount: '8,500',
    direction: 'out',
  },
  {
    label: 'Lightning deposit',
    meta: '2026-04-24 · 11:02',
    amount: '50,000',
    direction: 'in',
  },
];

export function WalletMockup() {
  return (
    <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-2xl border border-[color:var(--mk-border)] bg-[#070d18] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] md:max-w-[400px]">
      <div className="flex items-center justify-between border-[color:var(--mk-border)] border-b px-5 py-3">
        <div className="font-mono text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-wider">
          bitcoin · spark
        </div>
        <div
          aria-hidden="true"
          className="size-1.5 rounded-full bg-[color:var(--mk-brand)]"
        />
      </div>

      <div className="px-6 pt-7 pb-5 text-center">
        <div className="font-mono text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-wider">
          balance
        </div>
        <div className="mt-2 flex items-baseline justify-center gap-1.5">
          <span className="font-medium font-mono text-4xl text-[color:var(--mk-text)] tabular-nums md:text-5xl">
            142,800
          </span>
          <span className="font-mono text-[color:var(--mk-text-muted)] text-xs">
            sats
          </span>
        </div>
        <div className="mt-1 font-mono text-[11px] text-[color:var(--mk-text-muted)] tabular-nums">
          ≈ $145.62
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-5 pb-5">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="rounded-lg border border-[color:var(--mk-border)] bg-[rgba(255,255,255,0.02)] py-2.5 font-mono text-[color:var(--mk-text)] text-xs"
        >
          send
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="rounded-lg border border-[color:var(--mk-brand)]/30 bg-[color:var(--mk-brand)]/10 py-2.5 font-mono text-[color:var(--mk-brand)] text-xs"
        >
          receive
        </button>
      </div>

      <div className="border-[color:var(--mk-border)] border-t">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="font-mono text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-wider">
            recent
          </div>
          <div className="font-mono text-[10px] text-[color:var(--mk-text-muted)]">
            mint.agi.cash
          </div>
        </div>
        <ul className="divide-y divide-[color:var(--mk-border)]">
          {transactions.map((tx) => (
            <li
              key={tx.label}
              className="flex items-center justify-between px-5 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-[color:var(--mk-text)] text-sm">
                  {tx.label}
                </div>
                <div className="font-mono text-[10px] text-[color:var(--mk-text-muted)]">
                  {tx.meta}
                </div>
              </div>
              <div
                className={`font-mono text-sm tabular-nums ${
                  tx.direction === 'in'
                    ? 'text-[#7be3b8]'
                    : 'text-[color:var(--mk-text)]'
                }`}
              >
                {tx.direction === 'in' ? '+' : '−'}
                {tx.amount}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
