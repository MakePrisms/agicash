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

export function FooterSection() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-top">
        <div className="footer-socials">
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              aria-label={s.label}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src={s.src} alt="" />
            </a>
          ))}
        </div>

        <div className="footer-meta">
          <Link to="/terms" className="footer-meta-link">
            Terms of Service
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/privacy" className="footer-meta-link">
            Privacy Notice
          </Link>
          <span aria-hidden="true"> · </span>
          <span>© 2026 MakePrisms, Inc. All rights reserved.</span>
        </div>
      </div>

      <div className="footer-mark" aria-label="Agicash">
        AGICASH
      </div>
    </footer>
  );
}
