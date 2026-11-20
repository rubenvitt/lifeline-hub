import { mkdirSync } from 'node:fs';
import { anmelden, demoEinsatz, expect, test, uhrAnhalten } from './kern';

/** Wegwerf-Aufnahme für den PR von LLH-1758; wird im nächsten Commit wieder entfernt. */
const ZIEL = new URL('../../../pr-bilder/vr2k8af0/', import.meta.url).pathname;

test('vr2k8af0: Serverfehler ist nicht offline', async ({ page }) => {
  mkdirSync(ZIEL, { recursive: true });
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  // Netz ist da, der Server lehnt jedes Speichern einer Meldung mit 500 ab.
  await page.route(`**/api/einsaetze/${demo.id}/meldungen`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { error: 'Interner Fehler' } })
      : route.fallback(),
  );
  await page.goto(`/einsaetze/${demo.id}/meldungen`);
  await expect(page.getByRole('button', { name: 'Meldung erfassen' })).toBeVisible();
  await page.getByRole('button', { name: 'Meldung erfassen' }).click();
  const paneel = page.getByRole('region', { name: 'Neue Meldung erfassen' });
  await paneel.getByRole('button', { name: 'Sofortmeldung' }).click();
  await paneel
    .getByLabel('Inhalt / Wortlaut')
    .fill('Gasgeruch im Keller Lindenstraße 6, Bewohner verlassen das Haus.');
  await paneel.getByLabel('Absender').fill('Florian Musterstadt 2/1');
  await paneel.getByRole('button', { name: 'Speichern und nächste' }).click();

  const toast = page.getByText(/^Server-Fehler – Meldung von Florian/);
  await expect(toast).toBeVisible();
  await expect(paneel.getByText('nicht gesendet: 1')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Nicht gesendet' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${ZIEL}1-serverfehler.png` });

  await page.getByRole('button', { name: '1 nicht gesendet' }).last().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: 'Jetzt erneut senden' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${ZIEL}2-wiederherstellung.png`, style: '.ant-message { display: none !important; }' });
});
