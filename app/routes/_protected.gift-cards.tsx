import { type LinksFunction, Outlet } from 'react-router';
import '~/features/gift-cards/transitions.css';
import { GIFT_CARD_IMAGES } from '~/features/gift-cards/use-discover-cards';

export const links: LinksFunction = () =>
  GIFT_CARD_IMAGES.map((imageUrl) => ({
    rel: 'prefetch',
    href: imageUrl,
    as: 'image',
  }));

export default function GiftCardsLayout() {
  return <Outlet />;
}
