import type { UserResponse } from '@agicash/opensecret';
import { test as base } from '@playwright/test';
import { createAccessToken, createRefreshToken } from '../mocks/open-secret';
import type { OpenSecretFixture } from './open-secret/fixture';

type AuthOptions = {
  /**
   * Controls if initial navigation to '/' should be performed. Default value is true.
   */
  performInitialNavigation?: boolean;
};

type AuthFixture = {
  /**
   * Sets up local storage and mocks for authentication
   * @param user - User to log in
   * @param options - Additional options for authentication
   */
  setupAuth: (
    user: UserResponse['user'],
    options?: AuthOptions,
  ) => Promise<void>;
};

declare global {
  interface Window {
    testInitScriptExecuted?: boolean;
  }
}

export const test = base.extend<AuthFixture & OpenSecretFixture>({
  setupAuth: async ({ page, baseURL, openSecretApiMock }, use) => {
    const setup = async (
      user: UserResponse['user'],
      options: AuthOptions = { performInitialNavigation: true },
    ) => {
      const now = Date.now() / 1000;
      const accessToken = createAccessToken(now, user.id);
      const refreshToken = createRefreshToken(now, user.id);

      await openSecretApiMock.setupEncrypted<UserResponse>({
        url: '/protected/user',
        responseData: { user },
      });

      // Playwright doesn't have a way to set local storage before opening the app so we are using init script instead
      await page.addInitScript(
        ({ origin, accessToken, refreshToken }) => {
          if (
            window.location.origin === origin &&
            !window.testInitScriptExecuted
          ) {
            window.localStorage.setItem('access_token', accessToken);
            window.localStorage.setItem('refresh_token', refreshToken);
            window.testInitScriptExecuted = true;
          }
        },
        {
          origin: baseURL,
          accessToken,
          refreshToken,
        },
      );

      if (options.performInitialNavigation) {
        await page.goto('/');
      }
    };

    await use(setup);
  },
});
