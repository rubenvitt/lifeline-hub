import type { Locator, Page } from '@playwright/test';
import {
  kachelnBeantworten,
  kartenConfigBeantworten,
  vektorStilBeantworten,
} from '../kartenFixture';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Evakuierung“ (`docs/anwender/kapitel/evakuierung.md`, LLH-1034).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep evakuierung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   uebersicht.png       frontend/src/pages/EvakuierungPage.tsx,
 *                        frontend/src/betreuung/EvakuierungKennzahlen.tsx,
 *                        frontend/src/betreuung/BezirkTabelle.tsx
 *   bezirk-anlegen.png   frontend/src/betreuung/BetreuungDialoge.tsx
 *   stand-melden.png     frontend/src/betreuung/BetreuungDialoge.tsx
 *   bezirk-detail.png    frontend/src/pages/EvakuierungsbezirkPage.tsx,
 *                        frontend/src/betreuung/BezirkKennzahlen.tsx,
 *                        frontend/src/betreuung/BezirkStammdaten.tsx,
 *                        frontend/src/betreuung/BezirkGebiet.tsx,
 *                        frontend/src/betreuung/BezirkStandlinie.tsx
 *   bezirk-gebiet-zeichnen.png
 *                        frontend/src/betreuung/useBezirkHandlungen.tsx,
 *                        frontend/src/pages/LagekartePage.tsx,
 *                        frontend/src/pages/lagekarte/bezirkZeichnen.ts,
 *                        frontend/src/pages/lagekarte/PlatzierSteuerung.tsx (Rückmeldung),
 *                        frontend/src/pages/lagekarte/Sidebar.tsx
 *
 * Daten: der Demo-Einsatz hat einen Bezirk. Ein zweiter, geräumter Bezirk kommt per API dazu (D3),
 * damit Räumung und Kennzahlenband zu sehen sind. Die Lagekarte steht auf der Fixture-Grundlage
 * aus `e2e/kartenFixture.ts` (kein Netz).
 */

const KAPITEL = 'evakuierung';
const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';
const KACHEL_LAYER = 'strassen';
const GRUNDKARTE = { name: 'Grundkarte', stil: '/api/karte/proxy/9/a/style.json', quelle: 'grund' };

/** Beantwortet Kartenkonfiguration, Stil und Kacheln aus der Fixture (vor dem ersten `goto`). */
async function karteVorbereiten(page: Page) {
  await kartenConfigBeantworten(page, {
    online_styles: [{ name: GRUNDKARTE.name, typ: 'vektor', url: GRUNDKARTE.stil }],
  });
  await vektorStilBeantworten(page, GRUNDKARTE.stil, {
    id: GRUNDKARTE.quelle,
    kachelVorlage: `${KACHEL_PRAEFIX}{z}/{x}/{y}.pbf`,
    layer: KACHEL_LAYER,
  });
  await kachelnBeantworten(page, KACHEL_PRAEFIX, KACHEL_LAYER);
}

/** Wartet auf den geladenen Kartenstil und gibt die Zeichenfläche zurück. */
async function karteBereit(page: Page): Promise<Locator> {
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __lfhKarte?: { isStyleLoaded(): boolean } }
          ).__lfhKarte?.isStyleLoaded() ?? false,
      ),
    )
    .toBe(true);
  return canvas;
}

/** Klickt relativ zur Kartenmitte. */
async function tippe(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.click(x, y);
}

interface Uebersicht {
  bezirke: { id: number; bezeichnung: string }[];
}

/** Ergänzt die Demo-Lage einmal je Lauf (die Datenbank gilt für alle Tests eines Laufs). */
async function lageErgaenzen(page: Page, einsatzId: number): Promise<void> {
  const basis = `/api/einsaetze/${einsatzId}/evakuierung`;
  const lage = (await (await page.request.get(basis)).json()) as Uebersicht;
  if (!lage.bezirke.some((b) => b.bezeichnung === 'Uferstraße 2–18')) {
    const bezirk = await fuelle<{ id: number }>(page, 'post', `${basis}/bezirke`, {
      bezeichnung: 'Uferstraße 2–18',
      plan_personen: 64,
      plan_erhebung: 'gezaehlt',
      sammelstelle: 'Parkplatz Uferstraße',
    });
    await fuelle(page, 'patch', `${basis}/bezirke/${bezirk.id}`, { raeumung: 'laeuft' });
    // Eine frühere Meldung, damit die Detailseite eine Stufenlinie zeigt (LLH-1076).
    const frueher = new Date(Date.now() - 45 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    await fuelle(page, 'post', `${basis}/bezirke/${bezirk.id}/staende`, {
      evakuiert: 30,
      erhebung: 'geschaetzt',
      zeitpunkt_at: frueher,
    });
    await fuelle(page, 'post', `${basis}/bezirke/${bezirk.id}/staende`, {
      evakuiert: 64,
      erhebung: 'gezaehlt',
    });
    await fuelle(page, 'patch', `${basis}/bezirke/${bezirk.id}`, { raeumung: 'geraeumt' });
  }
}

test.describe(KAPITEL, () => {
  test('Übersicht mit Kennzahlenband und Bezirkstabelle', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await lageErgaenzen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
    await expect(page.getByText('Uferstraße 2–18').first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Räumung in Zahlen' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'uebersicht');
  });

  test('Dialog „Evakuierungsbezirk anlegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
    await page.getByRole('button', { name: 'Evakuierungsbezirk anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    await dialog.getByLabel('Bezeichnung').fill('Lindenstraße 1–20');
    await dialog.getByLabel('Plangröße (Personen)').fill('85');
    await dialog.getByRole('button', { name: 'Weitere Angaben' }).click();
    await dialog.getByLabel('Sammelstelle').fill('Bushaltestelle Lindenplatz');
    await dialog.getByLabel('Sammelstelle').blur();
    await fotografiere(dialog, KAPITEL, 'bezirk-anlegen');
  });

  test('Bezirk mit Gebiet anlegen', async ({ page }) => {
    await karteVorbereiten(page);
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
    await page.getByRole('button', { name: 'Evakuierungsbezirk anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    await dialog.getByLabel('Bezeichnung').fill('Lindenstraße 1–20');
    await dialog.getByLabel('Plangröße (Personen)').fill('85');
    await expect(dialog.getByRole('radio', { name: 'Fläche zeichnen' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect(page).toHaveURL(/\/lagekarte$/);
    const canvas = await karteBereit(page);
    await expect(page.getByText('Bezirk Lindenstraße 1–20 · Fläche')).toBeVisible();
    await tippe(page, canvas, -180, -140);
    await tippe(page, canvas, 60, -190);
    await tippe(page, canvas, 140, -40);
    await tippe(page, canvas, -120, 0);
    await page.getByRole('button', { name: 'Abschließen' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Gebiet für Bezirk Lindenstraße 1–20 gespeichert')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'bezirk-gebiet-zeichnen');
    await page.getByRole('button', { name: 'Zurück zu Bezirk Lindenstraße 1–20' }).click();
    await expect(page.getByRole('heading', { name: /Lindenstraße 1–20/ })).toBeVisible();
  });

  test('Dialog „Stand melden“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
    await page.getByRole('button', { name: 'Stand melden für Bezirk Mühlbachweg 1–40' }).click();
    const dialog = page.getByRole('dialog', { name: 'Stand melden: Mühlbachweg 1–40' });
    await dialog.getByLabel('Evakuiert gesamt (Personen)').fill('104');
    await dialog.getByLabel('Evakuiert gesamt (Personen)').blur();
    await fotografiere(dialog, KAPITEL, 'stand-melden');
  });

  test('Detailseite eines Bezirks', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await lageErgaenzen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/evakuierung`);
    await page.getByRole('link', { name: 'Uferstraße 2–18' }).click();
    await expect(page.getByRole('group', { name: 'Bezirk in Zahlen' })).toBeVisible();
    await expect(page.locator('[data-lfh="bezirk-standlinie"]')).toBeVisible();
    await fotografiere(page, KAPITEL, 'bezirk-detail');
  });
});
