import { test as base } from '@playwright/test';

interface PasswordGeneratorMockConsumer {
  getPassword(): string | null;
}

class PasswordGeneratorMock implements PasswordGeneratorMockConsumer {
  private password: string | null = null;

  setPassword(newPassword: string) {
    this.password = newPassword;
  }

  getPassword(): string | null {
    return this.password;
  }

  clear() {
    this.password = null;
  }
}

type PasswordGeneratorFixture = {
  /**
   * Use to mock random password generator
   */
  passwordGeneratorMock: PasswordGeneratorMock;
};

declare global {
  interface Window {
    /**
     * Returns the promise which resolves to mock password or null if the mock is not set up
     */
    getMockPassword?: () => Promise<string | null>;
  }
}

export const test = base.extend<PasswordGeneratorFixture>({
  passwordGeneratorMock: async ({ page }, use) => {
    const mock = new PasswordGeneratorMock();

    await page.exposeFunction('getMockPassword', () => mock.getPassword());

    await use(mock);

    mock.clear();
  },
});
