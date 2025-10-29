import { createCookie } from 'react-router';
import { SQUARE_COOKIES } from './square-cookie-config';

/**
 * Square OAuth state cookie (HttpOnly for security)
 */
export const squareStateCookie = createCookie(SQUARE_COOKIES.STATE.name, {
  path: '/',
  httpOnly: SQUARE_COOKIES.STATE.httpOnly,
  sameSite: 'lax',
  maxAge: SQUARE_COOKIES.STATE.maxAge,
});

/**
 * Square merchant email cookie
 */
export const squareMerchantEmailCookie = createCookie(
  SQUARE_COOKIES.MERCHANT_EMAIL.name,
  {
    path: '/',
    httpOnly: SQUARE_COOKIES.MERCHANT_EMAIL.httpOnly,
    sameSite: 'lax',
    maxAge: SQUARE_COOKIES.MERCHANT_EMAIL.maxAge,
  },
);

/**
 * Square connected status cookie
 */
export const squareConnectedCookie = createCookie(
  SQUARE_COOKIES.CONNECTED.name,
  {
    path: '/',
    httpOnly: SQUARE_COOKIES.CONNECTED.httpOnly,
    sameSite: 'lax',
    maxAge: SQUARE_COOKIES.CONNECTED.maxAge,
  },
);
