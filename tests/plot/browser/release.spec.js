import { test, expect } from '@playwright/test';

const releaseRoot = 'https://github.com/wdk08/PlotForge/releases/download/v1.0.0';
const assetNames = ['PlotForge_1.0.0_aarch64.dmg', 'PlotForge_1.0.0_x64.dmg', 'PlotForge_1.0.0_x64-setup.exe'];
const endpoint = 'https://api.github.com/repos/wdk08/PlotForge/releases/latest';

test('browser downloads handle the first release and expose the three verified installer links', async ({ page }) => {
  let published = false;
  await page.route(endpoint, route => published ? route.fulfill({ json: {
    tag_name: 'v1.0.0', draft: false, prerelease: false,
    assets: assetNames.map(name => ({ name, size: 123, state: 'uploaded', browser_download_url: `${releaseRoot}/${name}` })),
  } }) : route.fulfill({ status: 404, json: {} }));
  await page.goto('/');
  await expect(page.locator('#new-project')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('#new-project')).toHaveCSS('background-color', 'rgb(181, 138, 53)');
  const menu = page.locator('.browser-download');
  const toggle = menu.locator('summary');
  await toggle.click();
  await expect(menu.getByRole('status')).toContainText('awaiting the first release');
  await expect(menu.getByRole('link', { name: 'View PlotForge releases' })).toBeVisible();
  await toggle.click();
  published = true;
  await toggle.click();
  for (const [index, label] of ['macOS — Apple Silicon', 'macOS — Intel', 'Windows — x64'].entries()) {
    await expect(menu.getByRole('link', { name: label })).toHaveAttribute('href', `${releaseRoot}/${assetNames[index]}`);
  }
  await expect(page.locator('.plot-update-prompt')).toHaveCount(0);
});

test('desktop updater waits for approval, reports progress and saves before installation', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Map();
    window.updateCalls = [];
    window.__TAURI__ = {
      event: { async listen(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); } },
      core: { async invoke(command, args) {
        if (command === 'plot_storage') return args.action === 'list' ? [] : null;
        window.updateCalls.push(command);
        if (command === 'plot_update_info') return { enabled: true, version: '1.0.0', platform: 'macos' };
        if (command === 'plot_update_check') return { version: '1.0.1' };
        if (command === 'plot_update_download') {
          listeners.get('plotforge-update-progress')({ payload: { downloaded: 5, total: 10 } });
          await new Promise(resolve => setTimeout(resolve, 450));
        }
      } },
    };
  });
  await page.goto('/');
  await expect(page.locator('.browser-download')).toHaveCount(0);
  const prompt = page.locator('.plot-update-prompt');
  await expect(prompt).toContainText('1.0.1 is available');
  await prompt.getByRole('button', { name: 'Later' }).click();
  await expect(prompt).toBeHidden();
  expect(await page.evaluate(() => window.updateCalls)).toEqual(['plot_update_info', 'plot_update_check']);

  await page.evaluate(() => {
    let attempts = 0;
    window.plotForgeBeforeClose = async () => {
      window.updateCalls.push('flush');
      if (++attempts === 1) throw new Error('Test save failed.');
    };
  });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'About PlotForge' }).click();
  const about = page.locator('#about-plotforge');
  await expect(about).toContainText('Version 1.0.0');
  await about.getByRole('button', { name: 'Check for Updates' }).click();
  const dialog = page.locator('#plotforge-update');
  await dialog.getByRole('button', { name: 'Update Now' }).click();
  await expect(dialog.getByRole('status')).toContainText('50%');
  await expect(dialog.getByRole('alert')).toContainText('Test save failed.');
  expect(await page.evaluate(() => window.updateCalls)).not.toContain('plot_update_install');
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await dialog.getByRole('button', { name: 'Restart Now' }).click();
  expect(await page.evaluate(() => window.updateCalls.slice(-4))).toEqual([
    'flush', 'plot_update_install', 'flush', 'plot_update_restart',
  ]);
});

test('manual desktop update checks remain available after an empty startup check', async ({ page }) => {
  await page.addInitScript(() => {
    window.updateChecks = [];
    window.__TAURI__ = {
      event: { async listen() { return () => {}; } },
      core: { async invoke(command, args) {
        if (command === 'plot_storage') return args.action === 'list' ? [] : null;
        if (command === 'plot_update_info') return { enabled: true, version: '1.1.0', platform: 'macos' };
        if (command === 'plot_update_check') {
          window.updateChecks.push(args.automatic);
          return null;
        }
      } },
    };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.updateChecks)).toEqual([true]);
  await expect(page.locator('.plot-update-prompt')).toBeHidden();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'About PlotForge' }).click();
  await page.locator('#about-plotforge').getByRole('button', { name: 'Check for Updates' }).click();
  await expect(page.locator('#plotforge-update')).toContainText('PlotForge Is Up to Date');
  expect(await page.evaluate(() => window.updateChecks)).toEqual([true, false]);
});
