import { Link } from 'react-router';
import discordLogo from '~/assets/discord_logo.svg';
import githubLogo from '~/assets/github.svg';
import nostrLogo from '~/assets/nostr_logo.svg';
import xLogo from '~/assets/x_logo.svg';

const SOCIALS = [
  {
    label: 'Discord',
    href: 'https://discord.gg/e2TSCfXxhd',
    src: discordLogo,
  },
  { label: 'X', href: 'https://x.com/agi_cash', src: xLogo },
  {
    label: 'Nostr',
    href: 'https://njump.me/nprofile1qqsw3u8v7rz83txuy8nc0eth6rsqh4z935fs3t6ugwc7364gpzy5psce64r7c',
    src: nostrLogo,
  },
  {
    label: 'GitHub',
    href: 'https://github.com/MakePrisms/agicash',
    src: githubLogo,
  },
];

const footerMetaLink =
  'text-[color:var(--mk-text-muted)] transition-colors duration-200 hover:text-[color:var(--mk-text-dim)]';

export function FooterSection() {
  return (
    <footer className="mt-6 w-full overflow-hidden border-[color:var(--mk-border)] border-t pt-12">
      <div className="mx-auto mb-[60px] max-w-[1100px] px-5 text-center md:mb-20 md:px-8">
        <div className="mb-7 flex items-center justify-center gap-[14px]">
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              aria-label={s.label}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-social-link inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--mk-border)] text-[color:var(--mk-text-muted)] transition-[color,border-color,background-color] duration-200 hover:border-[color:var(--mk-border-bright)] hover:bg-[rgba(255,255,255,0.03)] hover:text-[color:var(--mk-text)]"
            >
              <img
                src={s.src}
                alt=""
                className="footer-social-img block h-4 w-4"
              />
            </a>
          ))}
        </div>

        <div className="font-[family:var(--mk-font-mono)] text-[11px] text-[color:var(--mk-text-muted)] uppercase leading-[1.7] tracking-[0.08em]">
          <Link to="/terms" className={footerMetaLink}>
            Terms of Service
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/privacy" className={footerMetaLink}>
            Privacy Notice
          </Link>
          <span aria-hidden="true"> · </span>
          <span>© 2026 MakePrisms, Inc. All rights reserved.</span>
        </div>
      </div>

      <div
        aria-label="Agicash"
        className="m-0 block select-none whitespace-nowrap p-0 text-center font-[family:var(--mk-font-mono)] font-bold text-[24vw] text-[color:var(--mk-brand)] uppercase leading-[0.86] tracking-[-0.04em]"
      >
        AGICASH
      </div>
    </footer>
  );
}
