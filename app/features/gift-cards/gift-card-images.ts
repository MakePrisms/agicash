import bitcoinPizzaCard from '~/assets/gift-cards/bitcoinpizza.agi.cash.webp';
import blockAndBeanCard from '~/assets/gift-cards/blockandbean.agi.cash.webp';
import compassCoffeeCard from '~/assets/gift-cards/compass.agi.cash.webp';
import hackForFreedomCard from '~/assets/gift-cards/hackforfreedom.agi.cash.webp';
import kissOfMatchaCard from '~/assets/gift-cards/kissofmatcha.agi.cash.webp';
import mapleCard from '~/assets/gift-cards/maple.agi.cash.webp';
import mariposaCard from '~/assets/gift-cards/mariposa.agi.cash.webp';
import pinkOwlCoffeeCard from '~/assets/gift-cards/pinkowl.agi.cash.webp';
import pubkeyCard from '~/assets/gift-cards/pubkey.agi.cash.webp';
import theShackCard from '~/assets/gift-cards/shack.agi.cash.webp';
import squarealphaMayCard from '~/assets/gift-cards/squarealphamay.agi.cash.webp';
import squaresantacruzCard from '~/assets/gift-cards/squaresantacruz.agi.cash.webp';
import theEpicurianTraderCard from '~/assets/gift-cards/theepicureantrader.agi.cash.webp';

const GIFT_CARD_IMAGES: Record<string, string> = {
  'https://bitcoinpizza.agi.cash': bitcoinPizzaCard,
  'https://blockandbean.agi.cash': blockAndBeanCard,
  'https://compass.agi.cash': compassCoffeeCard,
  'https://hackforfreedom.agi.cash': hackForFreedomCard,
  'https://kissofmatcha.agi.cash': kissOfMatchaCard,
  'https://maple.agi.cash': mapleCard,
  'https://mariposa.agi.cash': mariposaCard,
  'https://pinkowl.agi.cash': pinkOwlCoffeeCard,
  'https://pubkey.agi.cash': pubkeyCard,
  'https://shack.agi.cash': theShackCard,
  'https://squarealphamay.agi.cash': squarealphaMayCard,
  'https://squaresantacruz.agi.cash': squaresantacruzCard,
  'https://theepicureantrader.agi.cash': theEpicurianTraderCard,
};

const GIFT_CARD_OG_IMAGES: Record<string, string> = {
  'https://bitcoinpizza.agi.cash': '/og/pizza-offer.webp',
  'https://hackforfreedom.agi.cash': '/og/hackforfreedom.webp',
  'https://kissofmatcha.agi.cash': '/og/kissofmatcha.webp',
  'https://mariposa.agi.cash': '/og/mariposa.webp',
  'https://pinkowl.agi.cash': '/og/pinkowl.webp',
  'https://pubkey.agi.cash': '/og/pubkey.webp',
  'https://squarealphamay.agi.cash': '/og/sf-offer.webp',
  'https://squaresantacruz.agi.cash': '/og/sc-offer.webp',
  'https://theepicureantrader.agi.cash': '/og/theepicureantrader.webp',
};

/**
 * Returns the card image for a mint URL (gift card or offer), if one exists.
 */
export function getGiftCardImageByUrl(url: string): string | undefined {
  return GIFT_CARD_IMAGES[url];
}

/**
 * Returns the social-preview (OG) image path for a mint URL, if one has been
 * registered. Paths point at static assets under `public/og/`.
 */
export function getGiftCardOgImageByUrl(url: string): string | undefined {
  return GIFT_CARD_OG_IMAGES[url];
}
