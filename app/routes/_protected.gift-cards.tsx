import { type LinksFunction, Outlet } from 'react-router';
import '~/features/gift-cards/transitions.css';
import { GIFT_CARDS } from '~/features/gift-cards/use-discover-cards';

export const links: LinksFunction = () =>
  GIFT_CARDS.map((card) => ({
    rel: 'preload',
    href: card.image,
    as: 'image',
  }));

export default function GiftCardsLayout() {
  return <Outlet />;
}
