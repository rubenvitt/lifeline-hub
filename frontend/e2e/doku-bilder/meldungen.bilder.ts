import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Meldungen“ (`docs/anwender/kapitel/meldungen.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep meldungen`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   meldungen-liste.png    frontend/src/pages/MeldungenPage.tsx, frontend/src/meldungen/MeldungKarte.tsx
 *   meldung-erfassen.png   frontend/src/meldungen/MeldungFormular.tsx
 *   meldung-berichtigt.png frontend/src/meldungen/MeldungKarte.tsx, frontend/src/meldungen/BerichtigtMarke.tsx
 */

const KAPITEL = 'meldungen';

/** Was die Szene aus `GET …/meldungen` braucht. */
interface Meldung {
  id: number;
  inhalt: string;
  absender: string;
  empfaenger?: string | null;
  etb_meldung_id?: number | null;
}

/** Öffnet die Meldungen des Demo-Einsatzes und wartet auf die Kennzahlen und die erste Karte. */
async function meldungenOeffnen(page: Page) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/meldungen`);
  await expect(page.getByRole('button', { name: 'Meldung erfassen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sichten' }).first()).toBeVisible();
}

test.describe(KAPITEL, () => {
  test('Meldungen mit Kennzahlen und offenen Karten', async ({ page }) => {
    await meldungenOeffnen(page);
    await fotografiere(page, KAPITEL, 'meldungen-liste');
  });

  test('Formular „Neue Meldung erfassen“ als Sofortmeldung', async ({ page }) => {
    await meldungenOeffnen(page);
    await page.getByRole('button', { name: 'Meldung erfassen' }).click();
    const paneel = page.getByRole('region', { name: 'Neue Meldung erfassen' });
    await paneel.getByRole('button', { name: 'Sofortmeldung' }).click();
    await paneel
      .getByLabel('Inhalt / Wortlaut')
      .fill('Gasgeruch im Keller Lindenstraße 6, Bewohner verlassen das Haus.');
    await paneel.getByLabel('Absender').fill('Florian Musterstadt 2/1');
    await paneel.getByLabel('Empfänger / Adressat').fill('ELW 1');
    await paneel.getByRole('button', { name: /^Weitere Angaben/ }).click();
    await expect(paneel.getByLabel('Bestätigungsfrist in Minuten')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(paneel, KAPITEL, 'meldung-erfassen');
  });

  // Zuletzt: die Berichtigung bleibt im Lauf stehen und käme sonst in die Bilder davor.
  test('Meldungskarte mit Marke „berichtigt“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const basis = `/api/einsaetze/${demo.id}`;
    // Die Rückmeldung der UHS aus dem Demo-Szenario; ihr ETB-Eintrag entstand beim Import.
    const antwort = await page.request.get(`${basis}/meldungen`);
    expect(antwort.ok(), `Meldungen: ${antwort.status()}`).toBe(true);
    const meldung = ((await antwort.json()) as Meldung[]).find((m) =>
      m.inhalt.startsWith('UHS Turnhalle: acht Patienten'),
    );
    expect(meldung?.etb_meldung_id, 'Demo-Meldung der UHS mit ETB-Eintrag').toBeTruthy();
    await fuelle(page, 'post', `${basis}/etb`, {
      typ: 'berichtigung',
      von: meldung!.absender,
      an: meldung!.empfaenger ?? 'Einsatzleitung',
      inhalt: 'UHS Turnhalle: neun Patienten in Behandlung, zwei zum Transport bereit.',
      berichtigt_eintrag_id: meldung!.etb_meldung_id,
    });

    await meldungenOeffnen(page);
    const karte = page.locator(`[data-meldung-id="${meldung!.id}"]`);
    await expect(karte.getByText('berichtigt', { exact: true })).toBeVisible();
    await expect(
      karte.getByRole('link', { name: /^Berichtigung im ETB, Nr\. \d+$/ }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(karte, KAPITEL, 'meldung-berichtigt');
  });
});
