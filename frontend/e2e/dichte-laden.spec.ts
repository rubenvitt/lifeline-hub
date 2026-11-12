import { expect, test } from '@playwright/test';
import { anmelden, ladeInDichte } from './trefflaeche-kern';

/**
 * Nachweis für `ladeInDichte` (LLH-1665, Spec `e2e-zuschnitt`, „Eine Ladung je Dichtestufe“):
 * Die Gates laden ihre Seite je Stufe genau einmal, und die Stufe steht, bevor gemessen wird.
 */

test('je Stufe genau eine Ladung der gemessenen Seite, und die Stufe steht', async ({ page }) => {
  await anmelden(page);
  const ladungen: string[] = [];
  // Gezählt werden Dokumentanfragen: `framenavigated` meldet auch `replaceState` der App.
  page.on('request', (anfrage) => {
    if (anfrage.isNavigationRequest() && anfrage.frame() === page.mainFrame()) {
      ladungen.push(new URL(anfrage.url()).pathname);
    }
  });

  for (const dichte of ['kompakt', 'komfortabel', 'handschuh']) {
    ladungen.length = 0;
    await ladeInDichte(page, '/neuigkeiten', dichte);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    expect(ladungen, `${dichte}: eine Ladung`).toEqual(['/neuigkeiten']);
  }
});

test('von about:blank aus lädt sie wie bisher und stellt die Stufe trotzdem', async ({ page }) => {
  await anmelden(page, { startseite: false });
  await ladeInDichte(page, '/neuigkeiten', 'handschuh');
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
});
