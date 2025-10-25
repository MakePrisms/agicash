import crypto from 'node:crypto';
import { SquareClient, SquareEnvironment } from 'square';

const SQUARE_BASE_URL = {
  production: 'https://connect.squareup.com',
  sandbox: 'https://connect.squareupsandbox.com',
} as const;

const getSquareBaseUrl = () => {
  return import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production'
    ? SQUARE_BASE_URL.production
    : SQUARE_BASE_URL.sandbox;
};

export const getSquareOAuthClient = () => {
  const environment =
    import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production'
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

  const client = new SquareClient({ environment });
  return client.oAuth;
};

export const generateSquareAuthParams = () => {
  const base64Encode = (buffer: Buffer) => {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const state = base64Encode(crypto.randomBytes(16));

  return {
    state,
    appId: import.meta.env.VITE_SQUARE_APP_ID,
    baseUrl: getSquareBaseUrl(),
  };
};

export const buildSquareAuthUrl = (params: {
  appId: string;
  baseUrl: string;
  state: string;
  redirectUri: string;
  scopes: string[];
}) => {
  const { appId, baseUrl, state, redirectUri, scopes } = params;
  const url = new URL(`${baseUrl}/oauth2/authorize`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('session', 'false');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);

  return url.toString();
};
