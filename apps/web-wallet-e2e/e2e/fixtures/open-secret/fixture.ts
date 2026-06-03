import * as crypto from 'node:crypto';
import { type Page, type Route, test as base, expect } from '@playwright/test';
import { decode } from '@stablelib/base64';
import delay from '~/lib/delay';
import { session } from '../../mocks/open-secret';
import { openSecretEncryption } from './encryption';

// biome-ignore lint/suspicious/noExplicitAny: This type is copied from playwright-core/types/structs.d.ts. We needed to copy it because it is not exported from playwright-core.
type Serializable = any;

type OpenSecretApiMockOptions<
  TRes extends Serializable,
  TExpectedReq extends Serializable,
> = {
  /**
   * Url of the endpoint. Can be full url or just a path
   */
  url: string;

  /**
   * Response headers. Header values will be converted to a string.
   */
  headers?: { [key: string]: string };

  /**
   * Expected request data
   */
  expectedRequestData?: TExpectedReq;

  /**
   * JSON response.
   */
  responseData: TRes;

  /**
   * Response status code, defaults to `200`.
   */
  status?: number;

  /**
   * How often a mock should be used. By default, it will be used every time.
   */
  times?: number;

  /**
   * Adds a delay to mock response. Use when you want to simulate a request taking some time.
   * Represents the number of milliseconds to delay the response for
   */
  delayMs?: number;
};

type OpenSecretApiMock = {
  /**
   * Sets up open secret api mock with raw response data.
   */
  setup: <TRes = unknown, TExpectedReq = unknown>(
    options: OpenSecretApiMockOptions<TRes, TExpectedReq>,
  ) => Promise<void>;
  /**
   * Sets up open secret api mock with encrypted response data.
   */
  setupEncrypted: <TRes = unknown, TExpectedReq = unknown>(
    options: OpenSecretApiMockOptions<TRes, TExpectedReq>,
  ) => Promise<void>;
};

export type OpenSecretFixture = {
  /**
   * Open secret API mock. Use to mock the Open Secret responses.
   */
  openSecretApiMock: OpenSecretApiMock;
  /**
   * Presets Open Secret session before starting a test.
   * True by default. Set to false if you want to test "session handshake"
   */
  presetOpenSecretSession?: boolean;
};

type MockData = {
  config: OpenSecretApiMockOptions<unknown, unknown>;
  numOfInvocations: number;
};

export const openSecretBaseUrl = 'https://preview-enclave.opensecret.cloud';

const sortObject = <T>(obj: T): T => {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return obj;
  }

  const sortedEntries = Object.entries(obj)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => [key, sortObject(value)]);

  return Object.fromEntries(sortedEntries) as T;
};

const hasExpectedRequestData = (
  route: Route,
  expectedRequestData: unknown,
): { result: true } | { result: false; message: string } => {
  let requestData = route.request().postDataJSON();

  if (requestData && 'encrypted' in requestData) {
    const decryptedData = openSecretEncryption.decryptMessage(
      decode(session.key),
      requestData.encrypted,
    );
    requestData = JSON.parse(decryptedData);
  }

  const expected = JSON.stringify(sortObject(expectedRequestData));
  const actual = JSON.stringify(sortObject(requestData));

  if (expected !== actual) {
    return {
      result: false,
      message: `Expected: ${expected}. Actual: ${actual}`,
    };
  }

  return { result: true };
};

const hashMockOptions = (
  options: OpenSecretApiMockOptions<unknown, unknown> & {
    rawResponseData: unknown;
  },
) => {
  const {
    responseData,
    rawResponseData,
    expectedRequestData,
    headers,
    ...rest
  } = options;
  const optionsStr = JSON.stringify({
    rawResponseData: sortObject(rawResponseData),
    expectedRequestData: sortObject(expectedRequestData),
    headers: sortObject(headers),
    ...rest,
  });
  return crypto.createHash('sha256').update(optionsStr).digest('hex');
};

const setOpenSecretSession = async (page: Page, baseURL?: string) => {
  await page.addInitScript(
    async ({ baseURL, session }) => {
      if (
        window.location.origin === baseURL &&
        !window.sessionStorage.getItem('sessionId') &&
        !window.sessionStorage.getItem('sessionKey')
      ) {
        window.sessionStorage.setItem('sessionId', session.id);
        window.sessionStorage.setItem('sessionKey', session.key);
      }
    },
    { baseURL, session },
  );
};

const getFullUrl = (url: string) => {
  return url.startsWith(openSecretBaseUrl)
    ? url
    : `${openSecretBaseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
};

export const test = base.extend<OpenSecretFixture>({
  presetOpenSecretSession: [true, { option: true }],
  openSecretApiMock: async (
    { page, baseURL, presetOpenSecretSession },
    use,
  ) => {
    if (presetOpenSecretSession) {
      await setOpenSecretSession(page, baseURL);
    }

    const mocksMap = new Map<string, MockData>();
    let nonMockedOpenSecretRequestsCount = 0;

    await page.route(`${openSecretBaseUrl}/**`, async (route) => {
      nonMockedOpenSecretRequestsCount++;
      await route.continue();
    });

    const setupMock = async (
      options: OpenSecretApiMockOptions<unknown, unknown> & {
        rawResponseData: unknown;
      },
    ) => {
      const key = hashMockOptions(options);
      const mockData = mocksMap.get(key);
      if (!mockData) {
        mocksMap.set(key, { config: options, numOfInvocations: 0 });
      }

      const {
        url,
        headers,
        status,
        times,
        delayMs,
        responseData,
        expectedRequestData,
      } = options;

      await page.route(
        getFullUrl(url),
        async (route) => {
          if (expectedRequestData) {
            const resp = hasExpectedRequestData(route, expectedRequestData);
            if (!resp.result) {
              console.warn(
                `Mock found but skipped because request body didn't match. ${resp.message}`,
              );
              await route.fallback();
              return;
            }
          }

          if (delayMs) {
            await delay(delayMs);
          }

          await route.fulfill({
            status,
            headers: headers,
            json: responseData,
          });

          const mockData = mocksMap.get(key);
          if (!mockData) {
            // Should never happen
            throw new Error('Mock data not found');
          }
          mocksMap.set(key, {
            ...mockData,
            numOfInvocations: mockData.numOfInvocations + 1,
          });
        },
        { times },
      );
    };

    const setup: OpenSecretApiMock['setup'] = (options) =>
      setupMock({ ...options, rawResponseData: options.responseData });

    const setupEncrypted: OpenSecretApiMock['setupEncrypted'] = async ({
      responseData,
      ...rest
    }) => {
      const dataString = JSON.stringify(responseData);
      const encryptedData: Serializable = openSecretEncryption.encryptMessage(
        decode(session.key),
        dataString,
      );
      await setupMock({
        ...rest,
        // Raw property is not present in the normal Open Secret response. We are just adding it here for easier
        // debugging in Playwright UI
        responseData: { encrypted: encryptedData, raw: responseData },
        rawResponseData: responseData,
      });
    };

    await use({
      setup,
      setupEncrypted,
    });

    // Verify that each mock in the mocks map with times config set to non-zero value is invoked that exact number of times.
    // If the config for times is not defined, verify that it was called at least once
    for (const [_, mockData] of mocksMap.entries()) {
      const { config, numOfInvocations } = mockData;
      const { times } = config;

      if (times !== undefined) {
        // If `times` is set, verify it was invoked exactly that number of times
        expect(
          numOfInvocations,
          `Mock for URL ${config.url} was expected to be called ${times} times, but was called ${numOfInvocations} times.`,
        ).toEqual(times);
      } else {
        // If `times` is not set, verify it was invoked at least once
        expect(
          numOfInvocations,
          `Mock for URL ${config.url} was expected to be called at least once, but was never called.`,
        ).not.toBe(0);
      }
    }

    expect(
      nonMockedOpenSecretRequestsCount,
      `${nonMockedOpenSecretRequestsCount} non-mocked Open Secret requests were made.`,
    ).toBe(0);
  },
});
