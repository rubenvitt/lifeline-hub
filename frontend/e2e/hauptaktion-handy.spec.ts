import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { einsatzPerApi } from './einsatz-kern';
import { ladeInDichte } from './trefflaeche-kern';

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

for (const kontext of [
  { name: 'Handy', viewport: HANDY, dichte: 'komfortabel' },
  { name: 'Handschuh-Tablet', viewport: { width: 1180, height: 820 }, dichte: 'handschuh' },
] as const) {
  test(`Aufnahme (${kontext.name}): „Erfassen“ steht ohne Rollen im Bild`, async ({ page }) => {
    await page.setViewportSize(kontext.viewport);
    await anmeldenAlsAdmin(page, { startseite: false });
    const einsatzId = await einsatzPerApi(page, `E2E Hauptaktion Aufnahme ${Date.now()}`);
    await ladeInDichte(page, `/einsaetze/${einsatzId}/personen/aufnahme`, kontext.dichte);
    await expect(page.getByRole('heading', { name: /Aufnahme/ })).toBeVisible();
    // Vorbedingung: die Seite ist höher als der Schirm, sonst bewiese das Kleben nichts.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(kontext.viewport.height);
    await ganzImBild(page, 'Erfassen');
    // Am Handy klebt nur der Abschluss; die Serie steht am Formularende (LLH-1763).
    if (kontext.viewport.width >= 768) await ganzImBild(page, 'Speichern und nächste');
  });
}

test('Meldung erfassen: der Absendeknopf steht ohne Rollen im Bild', async ({ page }) => {
  await page.setViewportSize(HANDY);
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Hauptaktion Meldung ${Date.now()}`);
  await ladeInDichte(page, `/einsaetze/${einsatzId}/meldungen`, 'komfortabel');
  await page.getByRole('button', { name: 'Meldung erfassen', exact: true }).click();
  // Der Kopfknopf heißt jetzt „Formular schließen“; „Meldung erfassen“ ist der Absendeknopf.
  await expect(page.getByRole('button', { name: 'Formular schließen' }).first()).toBeVisible();
  await ganzImBild(page, 'Meldung erfassen');
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
  await ladeInDichte(page, `/einsaetze/${einsatzId}/auftraege`, 'komfortabel');
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
