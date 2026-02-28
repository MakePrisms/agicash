import type { UserResponse } from '@agicash/opensecret';
import { expect, test } from './fixtures';
import { openSecretBaseUrl } from './fixtures/open-secret/fixture';
import { expectHomePage } from './helpers';

const getUser = (): UserResponse['user'] => {
  const id = crypto.randomUUID();
  return {
    id,
    name: null,
    email: `cosmo+${id}@kramer.com`,
    email_verified: false,
    login_method: 'email',
    created_at: '2024-12-26T12:07:17.170640Z',
    updated_at: '2024-12-26T12:07:17.170640Z',
  };
};

test('verify email by typing the code', async ({
  page,
  setupAuth,
  openSecretApiMock,
}) => {
  const user = getUser();
  // We are disabling initial navigation to home page in these tests so we can pick the initial page in each individual test
  await setupAuth(user, { performInitialNavigation: false });

  const verificationCode = '03f1c2d1-0fb4-469b-93a9-c792ce6a0c61';

  await openSecretApiMock.setupEncrypted({
    url: `/verify-email/${verificationCode}`,
    responseData: {
      message: 'Email verified successfully',
    },
    times: 1,
  });

  // In this test we are going to the home page, but we expect the app to redirect us to the verify email page
  await page.goto('/');

  await expect(
    page.getByText('Verify Your Email', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(
    page.getByRole('alert', { name: 'Code is required' }),
  ).toBeVisible();

  await page
    .getByRole('textbox', { name: 'Verification Code' })
    .fill(verificationCode);

  await expect(
    page.getByRole('alert', { name: 'Code is required' }),
  ).not.toBeVisible();

  await openSecretApiMock.setupEncrypted<UserResponse>({
    url: '/protected/user',
    responseData: {
      user: {
        ...user,
        email_verified: true,
        updated_at: '2024-12-26T12:08:17.170640Z',
      },
    },
  });

  await page.getByRole('button', { name: 'Verify' }).click();

  // Make sure that the redirect we expect after the verification has been performed is completed.
  // We need this because sometimes if you trigger another redirect while the first one hasn't been finished Playwright
  // will fail the test.
  await page.waitForLoadState('networkidle');

  await expectHomePage(page);

  // Assert that verified user cannot go back to verify email page
  await page.goto('/verify-email');

  await expectHomePage(page);
});

test('verify email by opening the link', async ({
  page,
  setupAuth,
  openSecretApiMock,
}) => {
  const user = getUser();
  // We are disabling initial navigation to home page in these tests so we can pick the initial page in each individual test
  await setupAuth(user, { performInitialNavigation: false });

  const verificationCode = '6a5938cb-bd46-4773-8f8b-312409b80b62';

  await openSecretApiMock.setupEncrypted({
    url: `/verify-email/${verificationCode}`,
    // Delay is added to make sure we can verify that 'Verifying email...' text is shown. Otherwise, things happen too
    // quickly.
    delayMs: 500,
    responseData: {
      message: 'Email verified successfully',
    },
  });

  page.on('request', async (request) => {
    if (
      request.url() === `${openSecretBaseUrl}/verify-email/${verificationCode}`
    ) {
      // Only after verify email request was triggered, update the user mock to return verified user
      // Because initial call to /protected/user needs to return non verified user and that mock was set up in auth
      // fixture so we must not override it before it is used.
      await openSecretApiMock.setupEncrypted<UserResponse>({
        url: '/protected/user',
        responseData: {
          user: {
            ...user,
            email_verified: true,
            updated_at: '2024-12-26T12:08:17.170640Z',
          },
        },
      });
    }
  });

  // In this test we want to immediately go to /verify-email/<code> page, without visiting the / page first
  await page.goto(`/verify-email/${verificationCode}`);

  await expect(page.getByText('Verifying email...')).toBeVisible();

  await expectHomePage(page);
});
