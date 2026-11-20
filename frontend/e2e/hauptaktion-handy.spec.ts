import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { einsatzPerApi } from './einsatz-kern';

/**
 * Hauptaktion am Handschirm im Blick (LLH-1761, Entwurf
 * `docs/superpowers/specs/2026-11-20-j45fvu8l-handy-hauptaktion-kleben-design.md`): der Fuß
 * der Erfassung klebt auf der Seite, und ein Tipp auf einen Auftrag holt dessen Detail ins Bild.
 * Vorher lag „Erfassen“ der Aufnahme bei y ≈ 1100, „Meldung erfassen“ bei 1218 und „Quittieren“
 * nach dem Antippen bei 1170, alles bei 390 × 844.
 */

const HANDY = { width: 390, height: 844 };

test.setTimeout(90_000);

/** Ganz im Fenster, ohne dass der Test gerollt hat (`toBeInViewport` rollt nicht). */
async function ganzImBild(page: Page, name: string) {
  await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
}

test('Aufnahme: „Erfassen“ und „Speichern und nächste“ stehen ohne Rollen im Bild', async ({
  page,
}) => {
  await page.setViewportSize(HANDY);
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Hauptaktion Aufnahme ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/personen/aufnahme`);
  await expect(page.getByRole('heading', { name: /Aufnahme/ })).toBeVisible();
  // Vorbedingung: die Seite ist höher als der Schirm, sonst bewiese das Kleben nichts.
  const hoehe = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(hoehe).toBeGreaterThan(HANDY.height);
  await ganzImBild(page, 'Erfassen');
  await ganzImBild(page, 'Speichern und nächste');
});

test('Meldung erfassen: der Absendeknopf steht ohne Rollen im Bild', async ({ page }) => {
  await page.setViewportSize(HANDY);
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Hauptaktion Meldung ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/meldungen`);
  await page.getByRole('button', { name: 'Meldung erfassen', exact: true }).click();
  const paneel = page.locator('[data-lfh="erfassung-fuss-seite"]');
  await expect(paneel).toBeVisible();
  await expect(paneel.getByRole('button', { name: 'Meldung erfassen' })).toBeInViewport({
    ratio: 1,
  });
});

test('Auftrag antippen holt „Quittieren“ ins Bild', async ({ page }) => {
  await page.setViewportSize(HANDY);
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Hauptaktion Auftrag ${Date.now()}`);
  for (let i = 1; i <= 6; i++) {
    const r = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
      data: {
        auftrag_text: `Erkundung Abschnitt ${i}`,
        empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
      },
    });
    expect(r.ok(), `Auftrag ${i}: ${r.status()}`).toBe(true);
  }
  await page.goto(`/einsaetze/${einsatzId}/auftraege`);
  const karten = page.getByRole('button', { name: /: Erkundung Abschnitt \d$/ });
  await expect(karten).toHaveCount(6);
  // Die unterste Karte, die noch im Bild steht: ihr Detail klappte bisher unter dem Rand auf.
  const sichtbar = await karten.evaluateAll((els) =>
    els
      .map((el, i) => ({ i, unten: el.getBoundingClientRect().bottom }))
      .filter((k) => k.unten <= window.innerHeight)
      .map((k) => k.i),
  );
  const ziel = karten.nth(sichtbar[sichtbar.length - 1]);
  await ziel.click();
  await expect(ziel).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page
      .locator('[data-lfh="liste-detail-detail"]')
      .getByRole('button', { name: 'Empfang für EA Nord quittieren' }),
  ).toBeInViewport({ ratio: 1 });
});
