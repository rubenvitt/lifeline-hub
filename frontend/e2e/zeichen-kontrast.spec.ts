import { expect, test, type Locator, type Page } from '@playwright/test';
import { einsatzAnlegen } from './fernmeldeskizze-kern';
import { FUEKW, anmelden, post } from './fuehrungsorganisation-kern';
import {
  hinterlegteZeichen,
  messzeile,
  mitHinterlegung,
  unterDrei,
  zeichenKontraste,
} from './zeichen-kontrast-kern';

/**
 * Zeichenkontrast in Meldebild und Organigramm (LFH-1120, LLH-1409): jedes taktische Zeichen hält
 * am Schirm in beiden Modi 3 : 1. Nachts zeichnet die Bibliothek es mit dem Render-Theme `dark`
 * selbst hell (`zeichen/zeichenTheme.ts`): die Kontur hält gegen ihre Hinterlegung, die
 * Hinterlegung gegen den Grund, ein helles Quadrat dahinter gibt es nicht. Am Tag und im Druck
 * bleibt die Referenzpalette. Messkern: `zeichen-kontrast-kern.ts`, geteilt mit „Zeichenkontrast“
 * der Fernmeldeskizze. jsdom rechnet keine Farben. Der Einsatz entsteht über die API: der Test
 * prüft den Anlegedialog nicht (`e2e/AGENTS.md`, LFH-1114).
 *
 * Mutationsprobe: ohne Theme an `EinheitZeichen` bzw. im Organigramm hält der schwarze Umriss
 * eines Zeichens ohne Organisation im Nachtbetrieb 1,10 : 1, und die Vorbedingung „hinterlegt“
 * fällt, der Test wird rot. Bleibt das Theme im Druck stehen (ohne `useDruckModus` in
 * `useZeichenTheme`), wird die Druckprobe rot.
 */

/**
 * Ein Abschnitt mit zwei Einheiten: eine ohne Organisation (der schwarze Umriss, um den es geht)
 * und eine der Feuerwehr (Farbe nach DV 102).
 */
async function seede(page: Page, einsatzId: string) {
  const abschnitt = await post(page, einsatzId, 'abschnitte', { name: 'Deich Nord' });
  await post(page, einsatzId, 'einheiten', {
    name: 'Gruppe ohne Organisation',
    abschnitt_id: abschnitt,
  });
  const fw = await post(page, einsatzId, 'einheiten', {
    name: 'Gruppe Feuerwehr',
    abschnitt_id: abschnitt,
  });
  const antwort = await page.request.patch(`/api/einsaetze/${einsatzId}/einheiten/${fw}/position`, {
    data: { tz_organisation: 'feuerwehr' },
  });
  expect(antwort.ok(), `Organisation: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

/**
 * Im Druck steht jedes Zeichen ohne Theme und ohne eigenen Hintergrund auf dem Papier. Der Druck
 * schaltet über `beforeprint` um (`useDruckModus`), wie Strg+P und der Druckknopf.
 */
async function imDruck(page: Page, zeichen: Locator) {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  const hinterlegt = await hinterlegteZeichen(zeichen);
  const hintergruende = await zeichen.evaluateAll((alle) =>
    alle.map((svg) => getComputedStyle(svg).backgroundColor),
  );
  await page.emulateMedia({ media: null });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  return { hinterlegt, hintergruende };
}

const SEITEN = [
  {
    name: 'Meldebild',
    pfad: (id: string) => `/einsaetze/${id}/kraefteuebersicht`,
    zeichen: (page: Page) => page.locator('[data-lfh="einheit-zeichen"] svg'),
    // Beide Einheiten; der Abschnitt trägt im Meldebild kein Zeichen.
    anzahl: 2,
  },
  {
    name: 'Organigramm',
    pfad: (id: string) => `/einsaetze/${id}/einsatzabschnitte?ansicht=organigramm`,
    zeichen: (page: Page) => page.locator('[data-lfh="org-zeichen"] svg'),
    // Abschnitt und beide Einheiten.
    anzahl: 3,
  },
] as const;

for (const modus of ['dark', 'light'] as const) {
  test(`Zeichenkontrast: jedes taktische Zeichen in Meldebild und Organigramm hält am Schirm im Modus ${modus} 3 : 1, nachts über das Theme \`dark\`, im Druck ohne`, async ({
    page,
  }) => {
    await page.setViewportSize(FUEKW);
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Zeichenkontrast ${modus} ${Date.now()}`);
    await seede(page, einsatzId);
    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);

    for (const seite of SEITEN) {
      await page.goto(seite.pfad(einsatzId));
      // Der Zeiger stünde sonst womöglich über einer Zeile (Hover-Tönung).
      await page.mouse.move(0, 0);
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const zeichen = seite.zeichen(page);
      // Datenanker: im Organigramm kommen Abschnitte und Einheiten aus getrennten Abfragen, das
      // Zeichen des Abschnitts steht vor denen der Einheiten.
      await expect(zeichen, `${seite.name}: Zeichen`).toHaveCount(seite.anzahl);

      const werte = await zeichenKontraste(zeichen);
      test.info().annotations.push({
        type: 'messwert',
        description: `${seite.name} ${modus}: ${messzeile(werte)}`,
      });
      // Vorbedingung: ein Zeichen ohne Organisation steht da, sonst misst der Test nichts.
      expect(
        werte.some((w) => !w.beschreibung.includes('Organisation:')),
        `${seite.name}: Zeichen ohne Organisation`,
      ).toBe(true);
      // Vorbedingung: nachts trägt jedes Zeichen das Theme `dark`, am Tag keins.
      expect(
        mitHinterlegung(werte, modus !== 'dark'),
        `${seite.name}: Theme ${modus === 'dark' ? 'fehlt' : 'am Tag'}`,
      ).toEqual([]);
      expect(unterDrei(werte), `${seite.name}: unter 3 : 1 (${modus})`).toEqual([]);

      const druck = await imDruck(page, zeichen);
      expect(druck.hinterlegt, `${seite.name}: Zeichen mit Theme im Druck`).toBe(0);
      expect(
        druck.hintergruende.filter((f) => f !== 'rgba(0, 0, 0, 0)'),
        `${seite.name}: Fläche hinter dem Zeichen im Druck`,
      ).toEqual([]);
    }
  });
}
