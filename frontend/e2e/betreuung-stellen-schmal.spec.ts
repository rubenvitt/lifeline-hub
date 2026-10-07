import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Betreuungsstellen am schmalen Schirm (LFH-967): die Seite beantwortet „welche Stelle hat noch
 * Platz?“ ohne Querscrollen, und die Meldeaktion ist ganz im Bild.
 *
 * GEMESSEN WIRD AM TABELLENRAHMEN, nicht an `document.body.scrollWidth` (der sieht den Überlauf
 * einer Tabelle nicht): `toBeInViewport({ ratio: 1 })` rechnet über die Schnittfläche, und die
 * schneidet jeder Bildlauf-Vorfahr ab. Eine Kopfzelle hinter dem Querscrollen fällt also durch.
 *
 * GEKLICKT, nicht nur sichtbar (`e2e/AGENTS.md`): „Belegung melden“ öffnet den Dialog.
 *
 * NICHT-PRIVILEGIERT (LFH-435): der Beobachter sieht keine Aktion — Vorbedingung vor der Messung —,
 * und belegt/frei stehen trotzdem im Bild.
 */

const HANDY = { width: 390, height: 844 };
const TABLET_HOCH = { width: 820, height: 1180 };

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

/** Der lange Name ist Absicht: er bestimmt die Breite der fixierten Kennung. */
const STELLE = 'Notunterkunft Turnhalle Gymnasium';

async function saeStelle(page: Page): Promise<string> {
  const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `Stellen schmal ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  const { id } = await senden(page, 'post', `${basis}/stellen`, {
    bezeichnung: STELLE,
    art: 'notunterkunft',
    kapazitaet_personen: 150,
  });
  await senden(page, 'patch', `${basis}/stellen/${id}`, { status: 'in_betrieb' });
  // „fast voll“: das Auslastungswort macht die Belegungszelle so breit wie im Einsatz.
  await senden(page, 'post', `${basis}/stellen/${id}/belegungen`, { belegt: 135 });
  return String(einsatzId);
}

const stellenTabelle = (page: Page) =>
  page.getByRole('region', { name: 'Betreuungsstellen', exact: true });

async function oeffne(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/betreuung`);
  // Inhaltsanker, nie `networkidle` (LFH-385).
  await expect(stellenTabelle(page).getByText(STELLE)).toBeVisible();
}

async function belegungImBild(page: Page) {
  const tabelle = stellenTabelle(page);
  for (const kopf of ['belegt', 'frei']) {
    const zelle = tabelle.getByRole('columnheader', { name: kopf, exact: true });
    await expect(zelle).toHaveCount(1);
    await expect(zelle, `Spaltenkopf „${kopf}“ ohne Querscrollen`).toBeInViewport({ ratio: 1 });
  }
}

test.describe('Betreuungsstellen am schmalen Schirm (LFH-967)', () => {
  for (const [name, mass] of [
    ['Handy 390', HANDY],
    ['Tablet hoch 820', TABLET_HOCH],
  ] as const) {
    test(`${name}: belegt, frei und „Belegung melden“ ohne Querscrollen`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await anmeldenAlsAdmin(page);
      const einsatzId = await saeStelle(page);
      await page.setViewportSize(mass);
      await oeffne(page, einsatzId);

      await belegungImBild(page);

      const melden = stellenTabelle(page).getByRole('button', {
        name: `Belegung melden für ${STELLE}`,
      });
      await expect(melden).toHaveCount(1);
      await expect(melden, '„Belegung melden“ ganz im Bild').toBeInViewport({ ratio: 1 });
      await melden.click();
      await expect(page.getByRole('dialog', { name: `Belegung melden: ${STELLE}` })).toBeVisible();
    });

    test(`${name}: als Beobachter ohne Aktion, Belegung trotzdem im Bild`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await anmeldenAlsAdmin(page);
      const einsatzId = await saeStelle(page);
      await wechsleZuRolle(page, 'beobachter', einsatzId);
      await page.setViewportSize(mass);
      await oeffne(page, einsatzId);

      // Vorbedingung: der Nur-Lese-Zweig steht.
      await expect(
        stellenTabelle(page).getByRole('button', { name: /Belegung melden/ }),
      ).toHaveCount(0);
      await belegungImBild(page);
    });
  }
});
