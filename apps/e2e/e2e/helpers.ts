import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export async function expectHomePage(page: Page) {
  await expect(page.getByText('Send')).toBeVisible();
  await expect(page.getByText('Receive')).toBeVisible();
}
