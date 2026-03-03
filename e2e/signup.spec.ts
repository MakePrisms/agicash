import type { LoginResponse, UserResponse } from '@agicash/opensecret';
import { expect, test } from './fixtures';
import { expectHomePage } from './helpers';
import {
  createAccessToken,
  createRefreshToken,
  fullUser,
  guestUser,
} from './mocks/open-secret';

test('signup as guest', async ({
  page,
  openSecretApiMock,
  passwordGeneratorMock,
}) => {
  const user = guestUser;
  const password = 'Ln$ozoHx*Pd85HFFfyfAM*6Y2Sk8R@uY';
  const now = Date.now() / 1000;
  const accessToken = createAccessToken(now, user.id);
  const refreshToken = createRefreshToken(now, user.id);

  passwordGeneratorMock.setPassword(password);

  await openSecretApiMock.setupEncrypted<LoginResponse>({
    url: '/register',
    expectedRequestData: {
      password,
      inviteCode: '',
    },
    responseData: {
      id: user.id,
      access_token: accessToken,
      refresh_token: refreshToken,
    },
  });

  await openSecretApiMock.setupEncrypted<UserResponse>({
    url: '/protected/user',
    responseData: { user },
  });

  await page.goto('/');

  await expect(page.getByText('Sign Up')).toBeVisible();

  await page.getByRole('button', { name: 'Create wallet as Guest' }).click();

  await expectHomePage(page);
});

test('signup with email', async ({ page, openSecretApiMock }) => {
  const user = {
    ...fullUser,
    email_verified: false,
  } satisfies UserResponse['user'];

  const password = 'q1w2e3r4t5';

  const now = Date.now() / 1000;
  const accessToken = createAccessToken(now, user.id);
  const refreshToken = createRefreshToken(now, user.id);

  const loginResponse: LoginResponse = {
    id: user.id,
    access_token: accessToken,
    refresh_token: refreshToken,
  };

  await openSecretApiMock.setupEncrypted<LoginResponse>({
    url: '/register',
    expectedRequestData: {
      email: user.email,
      password,
      inviteCode: '',
    },
    responseData: loginResponse,
    times: 1,
  });

  await openSecretApiMock.setupEncrypted<UserResponse>({
    url: '/protected/user',
    responseData: { user },
    times: 1,
  });

  await page.goto('/');

  await expect(page.getByText('Sign Up')).toBeVisible();

  await page.getByRole('button', { name: 'Create wallet with Email' }).click();

  await expect(
    page.getByText('Enter your email & password below to setup a wallet'),
  ).toBeVisible();

  await page.getByRole('textbox', { name: 'Email' }).fill(user.email);
  await page
    .getByRole('textbox', { name: 'Password', exact: true })
    .fill(password);
  await page.getByRole('textbox', { name: 'Confirm Password' }).fill(password);

  await page.getByRole('button', { name: 'Create Wallet' }).click();

  await expect(
    page.getByText('Verify Your Email', { exact: true }),
  ).toBeVisible();
});

test('signup with email validation works', async ({
  page,
  openSecretApiMock,
}) => {
  const user = {
    ...fullUser,
    email_verified: false,
  } satisfies UserResponse['user'];

  const password = 'q1w2e3r4t5';

  const now = Date.now() / 1000;
  const accessToken = createAccessToken(now, user.id);
  const refreshToken = createRefreshToken(now, user.id);

  const loginResponse: LoginResponse = {
    id: user.id,
    access_token: accessToken,
    refresh_token: refreshToken,
  };

  await openSecretApiMock.setupEncrypted<LoginResponse>({
    url: '/register',
    expectedRequestData: {
      email: user.email,
      password,
      inviteCode: '',
    },
    responseData: loginResponse,
  });

  await openSecretApiMock.setupEncrypted<UserResponse>({
    url: '/protected/user',
    responseData: { user },
  });

  await page.goto('/');

  await expect(page.getByText('Sign Up')).toBeVisible();

  await page.getByRole('button', { name: 'Create wallet with Email' }).click();

  await page.getByRole('button', { name: 'Create Wallet' }).click();

  await expect(
    page.getByRole('alert', { name: 'Email is required' }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert', { name: 'Password is required' }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert', { name: 'Password confirmation is required' }),
  ).toBeVisible();

  await page.getByRole('textbox', { name: 'Email' }).fill('fdafdsa');
  await expect(
    page.getByRole('alert', { name: 'Invalid email' }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert', { name: 'Email is required' }),
  ).not.toBeVisible();

  await page.getByRole('textbox', { name: 'Email' }).fill(user.email);
  await expect(
    page.getByRole('alert', { name: 'Invalid email' }),
  ).not.toBeVisible();

  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('1');
  await expect(
    page.getByRole('alert', {
      name: 'Password must have at least 8 characters',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert', { name: 'Password is required' }),
  ).not.toBeVisible();

  await page
    .getByRole('textbox', { name: 'Password', exact: true })
    .fill(password);
  await expect(
    page.getByRole('alert', {
      name: 'Password must have at least 8 characters',
    }),
  ).not.toBeVisible();

  await page.getByRole('textbox', { name: 'Confirm Password' }).fill('1');
  await expect(
    page.getByRole('alert', { name: 'Passwords do not match' }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert', { name: 'Password confirmation is required' }),
  ).not.toBeVisible();

  await page.getByRole('textbox', { name: 'Confirm Password' }).fill(password);
  await expect(
    page.getByRole('alert', { name: 'Passwords do not match' }),
  ).not.toBeVisible();

  await page.getByRole('button', { name: 'Create Wallet' }).click();

  await expect(
    page.getByText('Verify Your Email', { exact: true }),
  ).toBeVisible();
});

[
  { protectedPageUrl: '/' },
  { protectedPageUrl: '/verify-email' },
  { protectedPageUrl: '/settings' },
].forEach(({ protectedPageUrl }) => {
  test(`trying to access ${protectedPageUrl} page when not logged in redirects to signup`, async ({
    page,
  }) => {
    await page.goto(protectedPageUrl);

    await expect(page.getByText('Sign Up')).toBeVisible();
  });
});

test('cannot access signup page if already logged in', async ({
  page,
  setupAuth,
}) => {
  await setupAuth(fullUser);

  await expectHomePage(page);

  await page.goto('/signup');

  await expectHomePage(page);
});
