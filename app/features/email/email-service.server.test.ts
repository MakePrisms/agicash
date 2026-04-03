import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';

// Mock ky before the module under test imports it
const mockPost = mock(() => Promise.resolve(new Response(JSON.stringify({ id: 'test' }))));
const mockCreate = mock(() => ({ post: mockPost }));

mock.module('ky', () => ({
  default: { create: mockCreate },
}));

spyOn(console, 'error').mockImplementation(() => {});

const MODULE_PATH = require.resolve('./email-service.server');

type HandleNewSignup = (params: {
  email: string;
  firstName?: string;
  signupMethod: 'email' | 'google' | 'guest';
}) => Promise<void>;

function loadFreshModule(): { handleNewSignup: HandleNewSignup } {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

function setupEnv() {
  process.env.RESEND_API_KEY = 'test-api-key';
  process.env.RESEND_WELCOME_TEMPLATE_ID = 'test-template-id';
  process.env.RESEND_AUDIENCE_ID = 'test-audience-id';
}

describe('handleNewSignup', () => {
  let handleNewSignup: HandleNewSignup;

  beforeEach(() => {
    setupEnv();
    mockPost.mockClear();
    mockPost.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'test' }))),
    );
    handleNewSignup = loadFreshModule().handleNewSignup;
  });

  test('skips for guest signup', async () => {
    await handleNewSignup({
      email: 'guest@example.com',
      signupMethod: 'guest',
    });

    expect(mockPost).not.toHaveBeenCalled();
  });

  test('calls createContact and sendWelcomeEmail for email signup', async () => {
    await handleNewSignup({
      email: 'user@example.com',
      firstName: 'Alice',
      signupMethod: 'email',
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test('calls createContact and sendWelcomeEmail for google signup', async () => {
    await handleNewSignup({
      email: 'user@example.com',
      signupMethod: 'google',
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
  });
});

describe('createContact payload', () => {
  let handleNewSignup: HandleNewSignup;

  beforeEach(() => {
    setupEnv();
    mockPost.mockClear();
    mockPost.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'test' }))),
    );
    handleNewSignup = loadFreshModule().handleNewSignup;
  });

  test('sends correct URL and body with first_name', async () => {
    await handleNewSignup({
      email: 'user@example.com',
      firstName: 'Alice',
      signupMethod: 'email',
    });

    const [url, options] = mockPost.mock.calls[0] as unknown as [string, { json: Record<string, string> }];

    expect(url).toBe('audiences/test-audience-id/contacts');
    expect(options.json).toEqual({
      email: 'user@example.com',
      first_name: 'Alice',
    });
  });

  test('omits first_name when undefined', async () => {
    await handleNewSignup({
      email: 'user@example.com',
      signupMethod: 'email',
    });

    const [, options] = mockPost.mock.calls[0] as unknown as [string, { json: Record<string, string> }];

    expect(options.json).toEqual({ email: 'user@example.com' });
    expect('first_name' in options.json).toBe(false);
  });
});

describe('sendWelcomeEmail payload', () => {
  let handleNewSignup: HandleNewSignup;

  beforeEach(() => {
    setupEnv();
    mockPost.mockClear();
    mockPost.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'test' }))),
    );
    handleNewSignup = loadFreshModule().handleNewSignup;
  });

  test('sends correct URL and body with firstName', async () => {
    await handleNewSignup({
      email: 'user@example.com',
      firstName: 'Alice',
      signupMethod: 'email',
    });

    const [url, options] = mockPost.mock.calls[1] as unknown as [string, { json: Record<string, unknown> }];

    expect(url).toBe('emails');
    expect(options.json).toEqual({
      from: 'Agicash <noreply@email.agi.cash>',
      to: ['user@example.com'],
      subject: 'Welcome to Agicash',
      template_id: 'test-template-id',
      data: { firstName: 'Alice' },
    });
  });

  test('defaults firstName to "there" when undefined', async () => {
    await handleNewSignup({
      email: 'user@example.com',
      signupMethod: 'email',
    });

    const [, options] = mockPost.mock.calls[1] as unknown as [string, { json: Record<string, unknown> }];

    expect((options.json as { data: { firstName: string } }).data).toEqual({
      firstName: 'there',
    });
  });
});

describe('error resilience', () => {
  let handleNewSignup: HandleNewSignup;

  beforeEach(() => {
    setupEnv();
    mockPost.mockClear();
    handleNewSignup = loadFreshModule().handleNewSignup;
  });

  test('continues to sendWelcomeEmail if createContact fails', async () => {
    let callCount = 0;
    mockPost.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('createContact failed'));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'test' })));
    });

    await handleNewSignup({
      email: 'user@example.com',
      signupMethod: 'email',
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
    const [emailUrl] = mockPost.mock.calls[1] as unknown as [string, unknown];
    expect(emailUrl).toBe('emails');
  });

  test('does not throw if sendWelcomeEmail fails', async () => {
    let callCount = 0;
    mockPost.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error('sendWelcomeEmail failed'));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'test' })));
    });

    await handleNewSignup({
      email: 'user@example.com',
      signupMethod: 'email',
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test('does not throw if both calls fail', async () => {
    mockPost.mockImplementation(() =>
      Promise.reject(new Error('API failure')),
    );

    await handleNewSignup({
      email: 'user@example.com',
      signupMethod: 'email',
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
  });
});
