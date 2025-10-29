import { getSquareOAuthClient } from './square-oauth.server';

const { SQUARE_APP_ID: appId = '', SQUARE_APP_SECRET: appSecret = '' } =
  process.env;

if (!appId || !appSecret) {
  throw new Error('Square app credentials not configured');
}

type RefreshTokenResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  merchantId: string;
};

/**
 * Service for managing Square OAuth tokens.
 * Handles token refresh operations.
 */
export class SquareTokenService {
  private readonly oAuthApi = getSquareOAuthClient();

  /**
   * Checks if a token should be refreshed.
   * Returns true if token expires within the next 24 hours or is already expired.
   */
  shouldRefreshToken(expiresAt: string | undefined): boolean {
    if (!expiresAt) {
      // Token never expires, no need to refresh
      return false;
    }

    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const hoursUntilExpiry =
      (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Refresh if expires within 24 hours
    return hoursUntilExpiry <= 24;
  }

  /**
   * Refreshes an OAuth token using the refresh token.
   * Returns new access token, refresh token, and expiration time.
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    try {
      const result = await this.oAuthApi.obtainToken({
        clientId: appId,
        clientSecret: appSecret,
        refreshToken,
        grantType: 'refresh_token',
      });

      const {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt,
        merchantId,
      } = result;

      if (!merchantId || !accessToken || !newRefreshToken || !expiresAt) {
        throw new Error('Missing required OAuth refresh response fields');
      }

      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt,
        merchantId,
      };
    } catch (error) {
      throw new Error('Failed to refresh token', { cause: error });
    }
  }
}
