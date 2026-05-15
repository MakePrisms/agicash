import type { LinksFunction } from 'react-router';
import pubkeyCard from '~/assets/gift-cards/pubkey.agi.cash.webp';
import { MarketingPage } from '~/features/homepage/marketing-page';

const fontPreloads = [
  'https://cdn.fontshare.com/wf/J6PPRPKWXDUIYA47IXLEQB4R4OPVYDQH/N2ZXAXWEHVMLISD2TIXJC7EF4GOY43L4/NXM4Z4TDCMYWBZ7AVI2N6DQ5VMWNENMU.woff2',
  'https://cdn.fontshare.com/wf/CKQBK2QBTCDREE7L3MXZ3PPW7LDNJCWU/OTOY7FQFSFOJVZKJWKO2EHUJLOGBDN4Q/4CO2ETY7NITKLUDKMYJ75RHJSPHOJ7XT.woff2',
  'https://cdn.fontshare.com/wf/XMXWOHABYLQDJ42L65EFRYNVRY37HQCB/B2O4O6V3JMFM2WDCYQI3A47L5U4THDUL/WN5274VQ3AUBDFP74GB4EC4XYJ3EKVNE.woff2',
  'https://cdn.fontshare.com/wf/ZX6AQLSFYVDPN2URWO2MQFGTYYOHIS64/TPYPKOYWFQVNJHLLRXD4KFYX4LUOUW4Z/6QH2ALVTTK7IRVO5MYOQQ3OZNXW5SSS3.woff2',
  'https://fonts.gstatic.com/s/kodemono/v4/A2BYn5pb0QgtVEPFnlYOnYLw.woff2',
  'https://fonts.gstatic.com/s/teko/v23/LYjNdG7kmE0gfaN9pQ.woff2',
];

export const links: LinksFunction = () => [
  ...fontPreloads.map((href) => ({
    rel: 'preload',
    href,
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous' as const,
  })),
  // PubKey is the first hero card — preload so LCP isn't blocked on the
  // bundled JS finishing before the image request even starts. The other
  // 5 cards are pre-decoded post-mount by HeroSection's decodedImagesRef.
  { rel: 'preload', href: pubkeyCard, as: 'image', type: 'image/webp' },
];

export default function HomePage() {
  return <MarketingPage />;
}
