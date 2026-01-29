/**
 * Playwright E2E tests for the interactive tutorial with live demo.
 * Verifies spotlight walkthrough, demo data loading, and chat injection.
 */

import { test, expect } from '@playwright/test';

/** localStorage key that marks tutorial as completed */
const TUTORIAL_COMPLETED_KEY = 'duckquery_tutorial_completed';

/** Waits for DuckDB to finish initializing (loading spinner gone) */
const waitForAppReady = async (page: import('@playwright/test').Page) => {
  await page.waitForSelector('header', { timeout: 15_000 });
};

/** Clicks the "Next" button in the tutorial tooltip */
const clickNext = async (page: import('@playwright/test').Page) => {
  await page.click('button:has-text("Next")');
};

test.describe('Tutorial Walkthrough', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage so tutorial auto-starts
    await page.goto('/');
    await page.evaluate((key) => localStorage.removeItem(key), TUTORIAL_COMPLETED_KEY);
    await page.reload();
    await waitForAppReady(page);
  });

  test('auto-starts on first visit and shows Welcome step', async ({ page }) => {
    // Tutorial should auto-start — spotlight + tooltip visible
    const tooltip = page.locator('[class*="z-[61]"]');
    await expect(tooltip).toBeVisible({ timeout: 5_000 });

    // Welcome step content
    await expect(page.getByText('Welcome to DuckQuery!')).toBeVisible();
    // Counter format: "1 / N"
    await expect(page.getByText('1 /')).toBeVisible();
  });

  test('does NOT auto-start when already completed', async ({ page }) => {
    // Mark as completed
    await page.evaluate((key) => localStorage.setItem(key, 'true'), TUTORIAL_COMPLETED_KEY);
    await page.reload();
    await waitForAppReady(page);

    // No tooltip should appear
    await expect(page.getByText('Welcome to DuckQuery!')).not.toBeVisible({ timeout: 3_000 });
  });

  test('"How to use" button re-launches tutorial', async ({ page }) => {
    // Skip the auto-started tutorial first
    await page.evaluate((key) => localStorage.setItem(key, 'true'), TUTORIAL_COMPLETED_KEY);
    await page.reload();
    await waitForAppReady(page);

    // Click "How to use" button
    await page.click('button:has-text("How to use")');

    // Tutorial should appear
    await expect(page.getByText('Welcome to DuckQuery!')).toBeVisible({ timeout: 5_000 });
  });

  test('navigates through all steps with Next button', async ({ page }) => {
    // Step 1: Welcome
    await expect(page.getByText('Welcome to DuckQuery!')).toBeVisible({ timeout: 5_000 });
    await clickNext(page);

    // Step 2: Import Data — also triggers sample data load
    await expect(page.getByText('Import Your Data')).toBeVisible({ timeout: 5_000 });
    // Wait for sample data to load (sales_data table should appear in sidebar)
    await expect(page.getByText('sales_data')).toBeVisible({ timeout: 10_000 });
    await clickNext(page);

    // Step 3: Schema
    await expect(page.getByText('Schema Browser')).toBeVisible({ timeout: 5_000 });
    await clickNext(page);

    // Step 4: Chat — demo messages should be injected
    await expect(page.getByText('Chat with Your Data')).toBeVisible({ timeout: 5_000 });
    // Wait for demo query execution + message injection
    await expect(page.getByText('What are the top categories by total revenue?')).toBeVisible({ timeout: 10_000 });
    // Results should show (the demo SQL was executed)
    await expect(page.getByText(/Found \d+ result/)).toBeVisible({ timeout: 5_000 });
    await clickNext(page);

    // Step 5: SQL Editor Tab — use heading role to avoid ambiguity
    await expect(page.getByRole('heading', { name: 'SQL Editor' })).toBeVisible({ timeout: 5_000 });
    await clickNext(page);

    // Step 6: Write & Run SQL — tab should switch to editor
    await expect(page.getByRole('heading', { name: 'Write & Run SQL' })).toBeVisible({ timeout: 5_000 });
    await clickNext(page);

    // Step 7: API Settings
    await expect(page.getByRole('heading', { name: 'API Settings' })).toBeVisible({ timeout: 5_000 });
    await clickNext(page);

    // Step 8: Query History
    await expect(page.getByRole('heading', { name: 'Query History' })).toBeVisible({ timeout: 5_000 });
    await clickNext(page);

    // Step 9: Done — should show "Get Started" instead of "Next"
    await expect(page.getByText('You\u2019re All Set!')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Get Started')).toBeVisible();

    // Click "Get Started" to finish
    await page.click('button:has-text("Get Started")');

    // Tutorial should be dismissed — tooltip gone
    await expect(page.getByText('You\u2019re All Set!')).not.toBeVisible({ timeout: 3_000 });

    // localStorage should be marked as completed
    const completed = await page.evaluate((key) => localStorage.getItem(key), TUTORIAL_COMPLETED_KEY);
    expect(completed).toBe('true');
  });

  test('Skip button dismisses tutorial and marks complete', async ({ page }) => {
    await expect(page.getByText('Welcome to DuckQuery!')).toBeVisible({ timeout: 5_000 });

    // Click Skip
    await page.click('button:has-text("Skip")');

    // Tutorial should be gone
    await expect(page.getByText('Welcome to DuckQuery!')).not.toBeVisible({ timeout: 3_000 });

    // Should be marked complete
    const completed = await page.evaluate((key) => localStorage.getItem(key), TUTORIAL_COMPLETED_KEY);
    expect(completed).toBe('true');
  });

  test('Back button navigates to previous step', async ({ page }) => {
    await expect(page.getByText('Welcome to DuckQuery!')).toBeVisible({ timeout: 5_000 });
    await clickNext(page);

    await expect(page.getByText('Import Your Data')).toBeVisible({ timeout: 5_000 });

    // Click Back
    await page.click('button:has-text("Back")');
    await expect(page.getByText('Welcome to DuckQuery!')).toBeVisible({ timeout: 5_000 });
  });

  test('demo chat shows insight text', async ({ page }) => {
    // Navigate to Chat step (step 4)
    await expect(page.getByText('Welcome to DuckQuery!')).toBeVisible({ timeout: 5_000 });
    await clickNext(page); // → Import
    await expect(page.getByText('Import Your Data')).toBeVisible({ timeout: 5_000 });
    await clickNext(page); // → Schema
    await expect(page.getByText('Schema Browser')).toBeVisible({ timeout: 5_000 });
    await clickNext(page); // → Chat

    await expect(page.getByText('Chat with Your Data')).toBeVisible({ timeout: 5_000 });

    // Insight text from tutorialDemo.ts
    await expect(
      page.getByText('Electronics leads with the highest revenue')
    ).toBeVisible({ timeout: 10_000 });
  });
});
