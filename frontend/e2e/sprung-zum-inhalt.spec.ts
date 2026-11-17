import { expect, test, type Page } from '@playwright/test';
import { pruefeFokusVerdeckung } from './fokus-kern';
import { einsatzPerApi } from './einsatz-kern';
import { anmelden, FUEKW, HANDSCHIRM } from './trefflaeche-kern';

/**
 * Sprunglink zum Inhalt (nufmon70, Spec `einsatztauglichkeit-layout`, „Ein Sprunglink führt zum
 * Inhalt“; Regel `frontend/AGENTS.md`, Rahmen). Im Browser, weil nur er zeigt, ob der Link mit
 * Fokus sichtbar und nicht verdeckt ist, ob der Rahmen dabei springt und wohin Tab danach führt.
 * Reihenfolge, Ziel je Rahmen und Adresse prüft Vitest
 * (`src/components/SprungZumInhalt.rahmen.test.tsx`).
 *
 * Je Seite: geladen, ein Tab → der Link hat den Fokus, steht sichtbar und unverdeckt oben links,
 * und Kopf, Inhalt und Seitentitel stehen wo vorher (`fixed`, kein Platz im Fluss). Enter → der
 * Fokus liegt auf dem Sprungziel, die Adresse ist dieselbe. Noch ein Tab → das erste Bedienelement
 * im Inhalt, nicht in Kopf, Rail, Modulpanel oder Verwaltungsmenü.
 *
 * Mutationsprobe (17.11.2026, Chromium): `position: relative` statt `fixed` am fokussierten Link
 * → rot „Rahmen verschoben“ in allen vier Fällen; `zIndex: 1` statt über `RAHMEN_EBENE` → rot
 * „Link verdeckt“ in allen vier; die Verwaltung ohne eigenes Ziel (der Sprung landet im äußeren
 * `main`) → rot „Tab nach dem Sprung im Rahmen“ bei 1366 und 390 px.
 */

const SPRUNG = '[data-lfh="sprung-zum-inhalt"]';
const ZIEL = '[data-lfh="sprungziel-inhalt"]';
/** Was vor dem Inhalt liegt und nach dem Sprung keinen Fokus mehr haben darf. */
const RAHMEN_TEILE = [
  '[data-lfh="rahmen-kopf"]',
  '[data-lfh="betriebszeile"]',
  '[data-lfh="rail-spalte"]',
  '[data-lfh="modul-panel"]',
  '[data-lfh="verwaltung-menue"]',
  'nav[aria-label="Verwaltung"]',
];

type Box = { x: number; y: number; width: number; height: number };

/** Lage der Rahmenteile und des Seitentitels: vor und nach dem Fokus auf dem Link gleich. */
async function lage(page: Page): Promise<Record<string, Box | null>> {
  const ergebnis: Record<string, Box | null> = {};
  for (const sel of ['[data-lfh="rahmen-kopf"]', 'main', 'h1']) {
    ergebnis[sel] = await page.locator(sel).first().boundingBox();
  }
  return ergebnis;
}

async function sprungProbe(page: Page, pfad: string, anker: () => Promise<void>) {
  await page.goto(pfad);
  await anker();
  const adresse = page.url();
  const vorher = await lage(page);
  const rollenVorher = await page.evaluate(() => window.scrollY);

  // Erster Tab-Halt: der Link (über den Messkern, der zugleich die Verdeckung prüft).
  const befund = await pruefeFokusVerdeckung(page, 1);
  const link = page.locator(SPRUNG);
  await expect(link, `${pfad}: erster Tab-Halt`).toBeFocused();
  await expect(link).toHaveText('Zum Inhalt springen');
  await expect(link).toBeVisible();
  expect(befund.stoppsGesamt, `${pfad}: Vorbedingung, ein gemessener Stopp`).toBe(1);
  expect(befund.stoppsBeruehrt, `${pfad}: Vorbedingung, der Link liegt am klebenden Kopf`).toBe(1);
  expect(befund.verdeckt, `${pfad}: Link verdeckt`).toEqual([]);
  const box = (await link.boundingBox())!;
  expect(box.x, `${pfad}: links`).toBeLessThanOrEqual(1);
  expect(box.y, `${pfad}: oben`).toBeLessThanOrEqual(1);
  expect(box.height, `${pfad}: Steuerhöhe`).toBeGreaterThanOrEqual(30 - 0.5);
  // Was am Mittelpunkt liegt, ist der Link selbst (über dem Rahmen, `z-index`).
  expect(
    await link.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const oben = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return oben != null && el.contains(oben);
    }),
    `${pfad}: Link liegt oben`,
  ).toBe(true);

  // Ohne Layoutsprung und ohne Rollen.
  expect(await lage(page), `${pfad}: Rahmen verschoben`).toEqual(vorher);
  expect(await page.evaluate(() => window.scrollY)).toBe(rollenVorher);

  // Enter: Fokus auf dem Ziel, die Adresse bleibt.
  await page.keyboard.press('Enter');
  const ziel = page.locator(ZIEL).last();
  await expect(ziel, `${pfad}: Fokus auf dem Sprungziel`).toBeFocused();
  expect(page.url(), `${pfad}: Adresse`).toBe(adresse);
  // Ohne Fokus ist der Link wieder aus dem Bild und nimmt keinen Platz.
  const zu = (await link.boundingBox())!;
  expect(zu.width * zu.height, `${pfad}: Link ohne Fokus`).toBeLessThanOrEqual(1);

  // Noch ein Tab: das erste Bedienelement im Inhalt, nicht im Rahmen.
  await page.keyboard.press('Tab');
  const ort = await page.evaluate(
    ({ ziel, teile }) => {
      const fokus = document.activeElement;
      const alle = document.querySelectorAll(ziel);
      const zielEl = alle[alle.length - 1];
      return {
        imInhalt: fokus != null && fokus !== zielEl && zielEl?.contains(fokus) === true,
        imRahmen: teile.filter((t) => fokus?.closest(t) != null),
        beschreibung: fokus ? `${fokus.tagName} ${fokus.textContent?.trim().slice(0, 40)}` : '',
      };
    },
    { ziel: ZIEL, teile: RAHMEN_TEILE },
  );
  expect(ort.imInhalt, `${pfad}: Tab nach dem Sprung (${ort.beschreibung})`).toBe(true);
  expect(ort.imRahmen, `${pfad}: Tab nach dem Sprung im Rahmen`).toEqual([]);
}

test.describe('Sprunglink zum Inhalt', () => {
  for (const ansicht of [FUEKW, HANDSCHIRM]) {
    test(`Überblick und Betroffene bei ${ansicht.width} px`, async ({ page }) => {
      await anmelden(page, { startseite: false });
      const einsatzId = await einsatzPerApi(page, `E2E Sprung ${ansicht.width} ${Date.now()}`);
      await page.setViewportSize(ansicht);

      await sprungProbe(page, `/einsaetze/${einsatzId}/ueberblick`, () =>
        expect(page.getByRole('heading', { level: 1, name: /Überblick/ })).toBeVisible(),
      );
      await sprungProbe(page, `/einsaetze/${einsatzId}/personen`, () =>
        expect(page.getByRole('heading', { level: 1, name: /Betroffene/ })).toBeVisible(),
      );
    });

    test(`Verwaltung bei ${ansicht.width} px: Tab nach dem Sprung liegt neben dem Menü`, async ({
      page,
    }) => {
      await anmelden(page, { startseite: false });
      await page.setViewportSize(ansicht);
      await sprungProbe(page, '/admin/benutzer', () =>
        expect(page.locator('tr.ant-table-row').first()).toBeVisible(),
      );
      await expect(page.locator('main'), 'genau ein <main>').toHaveCount(1);
    });
  }
});
