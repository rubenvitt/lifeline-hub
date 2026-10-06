import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmelden, einsatzAnlegen, post } from './fuehrungsorganisation-kern';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Knöpfe nennen ihre Handlung (LFH-959): „Bearbeitung beginnen" statt „In Bearbeitung",
 * „Zusage erfassen" statt „→ Zugesagt", „Erübrigt (zur Kenntnis)" und „Erledigt (durchgeführt)"
 * statt „Quittieren"/„Erledigt" mit Tooltip. Die Texte werden länger; hier steht, was jsdom
 * nicht belegt: auf Handy, Tablet hoch und quer und Desktop steht jeder Knopf als Wort sichtbar
 * innerhalb seiner Karte, und die Seite bekommt keinen waagerechten Überhang.
 *
 * Gemessen als Admin UND als Beobachter (`frontend/e2e/AGENTS.md`, Layout-Gate
 * nicht-privilegiert): ohne Schreibrecht fehlen die Knöpfe, die Karte bleibt.
 *
 * Mutationsprobe: in `kommunikation/phase.ts` `ERINNERUNG_HANDLUNG.quittiert` auf „Quittieren"
 * zurückstellen → die Sichtbarkeit „Erübrigt (zur Kenntnis)" wird rot.
 */

const BREITEN = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1440, height: 900 },
];

const MODULE = [
  {
    pfad: 'erinnerungen',
    anker: 'Lagemeldung an die Leitstelle',
    knoepfe: ['Erübrigt (zur Kenntnis)', 'Erledigt (durchgeführt)'],
  },
  { pfad: 'meldungen', anker: 'Brücke Nord gesperrt', knoepfe: ['Bearbeitung beginnen'] },
  {
    pfad: 'auftraege',
    anker: 'Erkundung Brücke Nord',
    knoepfe: ['Bearbeitung beginnen', 'Vollzug melden'],
  },
  { pfad: 'nachforderungen', anker: 'RTW Wortlaut', knoepfe: ['Zusage erfassen', 'Ablehnen'] },
] as const;

/** Waagerechter Überhang der Seite in px (Chromium rundet `scrollWidth`, 1 px Toleranz). */
async function ueberhang(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function seede(page: Page): Promise<string> {
  const einsatzId = await einsatzAnlegen(page, `E2E Knopfwortlaut ${Date.now()}`);
  const meldungId = await post(page, einsatzId, 'meldungen', {
    absender: 'Florian Nord 1',
    meldeweg: 'funk',
    inhalt: 'Brücke Nord gesperrt',
    ereigniszeit: new Date().toISOString(),
  });
  // Gesichtet: die Vorwärtsbewegung heißt dann „Bearbeitung beginnen", der längste Text.
  await post(page, einsatzId, `meldungen/${meldungId}/status`, { status: 'gesichtet' });
  await post(page, einsatzId, 'erinnerungen', {
    titel: 'Lagemeldung an die Leitstelle',
    faellig_at: '2026-01-01 10:00',
  });
  await post(page, einsatzId, 'nachforderungen', {
    art: 'Fahrzeug',
    bezeichnung: 'RTW Wortlaut',
    adressat_kategorie: 'leitstelle',
  });
  await post(page, einsatzId, 'auftraege', {
    auftrag_text: 'Erkundung Brücke Nord',
    empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EL' }],
  });
  return einsatzId;
}

/** Der Knopf steht innerhalb seiner Karte (1 px Toleranz für Subpixel). */
async function innerhalbDerKarte(knopf: Locator, wo: string) {
  const karte = knopf.locator('xpath=ancestor::*[@data-lfh="komm-karte"][1]');
  const k = await knopf.boundingBox();
  const r = await karte.boundingBox();
  expect(k, `${wo}: Knopf messbar`).not.toBeNull();
  expect(r, `${wo}: Karte messbar`).not.toBeNull();
  expect(k!.x, `${wo}: links in der Karte`).toBeGreaterThanOrEqual(r!.x - 1);
  expect(k!.x + k!.width, `${wo}: rechts in der Karte`).toBeLessThanOrEqual(r!.x + r!.width + 1);
}

async function pruefe(page: Page, einsatzId: string, rolle: 'admin' | 'beobachter') {
  for (const breite of BREITEN) {
    await page.setViewportSize(breite);
    for (const modul of MODULE) {
      const wo = `${rolle} ${breite.width} ${modul.pfad}`;
      await page.goto(`/einsaetze/${einsatzId}/${modul.pfad}`);
      const main = page.locator('main');
      await expect(main.getByText(modul.anker).first(), `${wo}: Datenanker`).toBeVisible();
      for (const name of modul.knoepfe) {
        const knopf = main.getByRole('button', { name, exact: true });
        if (rolle === 'beobachter') {
          await expect(knopf, `${wo}: ohne Schreibrecht kein „${name}"`).toHaveCount(0);
          continue;
        }
        await expect(knopf.first(), `${wo}: „${name}" als Wort`).toBeVisible();
        await innerhalbDerKarte(knopf.first(), `${wo} „${name}"`);
      }
      expect(await ueberhang(page), `${wo}: ohne Überhang`).toBeLessThanOrEqual(1);
    }
  }
}

test('Kommunikation: Knöpfe nennen ihre Handlung, in der Karte, ohne Überhang (Admin)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await anmelden(page);
  const einsatzId = await seede(page);
  await pruefe(page, einsatzId, 'admin');
});

test('Kommunikation: dasselbe als Beobachter, ohne Schreibrecht', async ({ page }) => {
  test.setTimeout(180_000);
  await anmelden(page);
  const einsatzId = await seede(page);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  // Vorbedingung: der Rollenzweig steht, bevor gemessen wird.
  await page.goto(`/einsaetze/${einsatzId}/erinnerungen`);
  await expect(page.getByText('Lagemeldung an die Leitstelle').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Erinnerung anlegen', exact: true }),
    'Vorbedingung: ohne Schreibrecht kein „Erinnerung anlegen"',
  ).toHaveCount(0);
  await pruefe(page, einsatzId, 'beobachter');
});
