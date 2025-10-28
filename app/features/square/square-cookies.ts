/**
 * Client-side Square cookie utilities
 */

import { SQUARE_COOKIES } from './square-cookie-config';

const getCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
};

const setCookie = (name: string, value: string, maxAge: number): void => {
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
};

const deleteCookie = (name: string): void => {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
};

export const getSquareConnected = (): boolean => {
  return getCookie(SQUARE_COOKIES.CONNECTED.name) === 'true';
};

export const setSquareConnected = (connected: boolean): void => {
  if (connected) {
    setCookie(
      SQUARE_COOKIES.CONNECTED.name,
      'true',
      SQUARE_COOKIES.CONNECTED.maxAge,
    );
  } else {
    deleteCookie(SQUARE_COOKIES.CONNECTED.name);
  }
};

export const getSquareMerchantEmail = (): string | null => {
  return getCookie(SQUARE_COOKIES.MERCHANT_EMAIL.name);
};

export const setSquareMerchantEmail = (email: string): void => {
  setCookie(
    SQUARE_COOKIES.MERCHANT_EMAIL.name,
    email,
    SQUARE_COOKIES.MERCHANT_EMAIL.maxAge,
  );
};

export const clearSquareCookies = (): void => {
  deleteCookie(SQUARE_COOKIES.CONNECTED.name);
  deleteCookie(SQUARE_COOKIES.MERCHANT_EMAIL.name);
  deleteCookie(SQUARE_COOKIES.STATE.name);
};
