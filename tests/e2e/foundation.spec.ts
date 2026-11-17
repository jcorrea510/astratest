import { test, expect } from '@playwright/test';
test('production subpath renders title and responds to start', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'MERIDIAN AFTERGLOW' })).toBeVisible();
  await page.getByRole('button', { name: 'Enter the city' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect(errors).toEqual([]);
});
