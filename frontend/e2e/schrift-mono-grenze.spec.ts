import { expect, test } from '@playwright/test';
import { anmelden, FUEKW } from './trefflaeche-kern';
import { einsatzMitEtb, ladeSeite, textproben } from './schrift-kern';

/**
 * Mono nur für Zahl, Zeit, Kennung und Funkrufname (LLH-1777, Spec `schriftrollen`).
 *
 * GEPRÜFT auf Überblick, ETB, Einsatzdaten und Betroffenen in `kompakt`: kein Textknoten in
 * JetBrains Mono enthält ein Wort aus vier oder mehr Kleinbuchstaben, außer er steht in einem
 * Element mit `data-schrift="kennung"` (Funkrufname, Typwort, Tastenkürzel, Wortmarke). Die ETB-
 * Einträge tragen die Metazeile „von Leitstelle Musterstadt · an Einsatzleitung“, die vorher in
 * Mono stand.
 *
 * Mutationsprobe: die Von→An-Zelle der ETB-Spaltenzeile (`etb/EtbSpaltenzeile.tsx`) auf
 * `fontFamily: 'var(--lfh-schrift-zahl)'` → rot im ETB („Leitstelle Musterstadt“).
 */

const WORT = /[a-zäöüß]{4,}/;

test('Mono trägt keine Wörter: Überblick, ETB, Einsatzdaten, Betroffene', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page, { startseite: false });
  const id = await einsatzMitEtb(page, `E2E Mono-Grenze ${Date.now()}`);

  for (const pfad of ['', '/etb', '/einsatzdaten', '/personen']) {
    await ladeSeite(page, `/einsaetze/${id}${pfad}`, 'kompakt', '[data-lfh="seitenkopf"]');
    if (pfad === '/etb') await expect(page.getByText('Pegel am Deichtor')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await textproben(page))
            .filter((p) => p.familie === 'LFH JetBrains Mono' && !p.kennung && WORT.test(p.text))
            .map((p) => p.text),
        { message: `Wörter in Mono auf ${pfad || 'Überblick'}` },
      )
      .toEqual([]);
  }
});
