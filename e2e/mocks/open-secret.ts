import type { UserResponse } from '@agicash/opensecret';
import sign from 'jwt-encode';

export const userId = '960f8a38-62c3-4756-9937-6cc3a64c4907';

export const session = {
  id: '1cc93c27-63d8-47c8-9731-7765466c7d06',
  key: 'p6lVKivBlX60YVzBfHV4pUxgGdhfmig2TupMdwN7Yx4=',
};

export const fullUser = {
  id: userId,
  name: null,
  email: 'cosmo@kramer.com',
  email_verified: true,
  login_method: 'email',
  created_at: '2024-12-26T12:07:17.170640Z',
  updated_at: '2024-12-26T12:07:17.170640Z',
} satisfies UserResponse['user'];

export const guestUser = {
  id: userId,
  name: null,
  email_verified: false,
  login_method: 'guest',
  created_at: '2024-12-26T12:07:17.170640Z',
  updated_at: '2024-12-26T12:07:17.170640Z',
} satisfies UserResponse['user'];

const secret = 'some-secret';

export const createAccessToken = (
  timestampInSeconds: number,
  userId: string,
): string => {
  const oneHourInSeconds = 60 * 60;
  // Math trunc is used to lose the decimals if there are any
  const expires = Math.trunc(timestampInSeconds) + oneHourInSeconds;
  return sign(
    {
      iat: timestampInSeconds,
      exp: expires,
      sub: userId,
      aud: 'access',
    },
    secret,
    {
      // @ts-ignore The types of the lib we are using don't support this alg, but we want that value to make sure it
      // matches what we see in Open Secret JWTs
      alg: 'ES256K',
      typ: 'JWT',
    },
  );
};

export const createRefreshToken = (
  timestampInSeconds: number,
  userId: string,
): string => {
  const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
  // Math trunc is used to lose the decimals if there are any
  const expires = Math.trunc(timestampInSeconds) + thirtyDaysInSeconds;
  return sign(
    {
      iat: timestampInSeconds,
      exp: expires,
      sub: userId,
      aud: 'refresh',
    },
    secret,
    {
      // @ts-ignore The types of the lib we are using don't support this alg, but we want that value to make sure it
      // matches what we see in Open Secret JWTs
      alg: 'ES256K',
      typ: 'JWT',
    },
  );
};
