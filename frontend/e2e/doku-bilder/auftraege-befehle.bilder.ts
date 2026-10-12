import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Aufträge und Befehle“ (`docs/anwender/kapitel/auftraege-befehle.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep auftraege-befehle`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   auftraege-liste.png    frontend/src/pages/AuftraegePage.tsx, frontend/src/auftraege/AuftraegeListe.tsx,
 *                          frontend/src/auftraege/AuftragKarte.tsx
 *   auftrag-erteilen.png   frontend/src/auftraege/AuftragFormular.tsx
 *   auftrag-aufheben.png   frontend/src/auftraege/AuftragAufhebenDialog.tsx
 *   befehl-entwurf.png     frontend/src/pages/BefehlDetailPage.tsx
 */

const KAPITEL = 'auftraege-befehle';

/** Leert den Fokus, damit kein Fokusring und kein Cursor im Bild steht. */
async function fokusWeg(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe(KAPITEL, () => {
  test('Einzelaufträge mit offenen und vollzogenen Aufträgen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/auftraege`);
    await expect(page.getByRole('button', { name: 'Auftrag erteilen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vollzug melden' }).first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'auftraege-liste');
  });

  test('Formular „Neuer Auftrag“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/auftraege`);
    await page.getByRole('button', { name: 'Auftrag erteilen' }).click();
    const paneel = page.getByRole('region', { name: 'Neuer Auftrag' });
    await paneel
      .getByLabel('Auftrag / Was')
      .fill('Sandsäcke an der Unterführung Lindenstraße auslegen, Keller Nr. 6 sichern.');
    const empfaenger = paneel.getByRole('combobox', { name: 'Empfänger' });
    await empfaenger.fill('Logistiktrupp');
    await empfaenger.press('Enter');
    await waehleIn(paneel.getByRole('combobox', { name: 'Priorität' }), 'Dringend');
    await fokusWeg(page);
    await expect(paneel.getByTitle('Logistiktrupp')).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'auftrag-erteilen');
  });

  test('Rückfrage „Auftrag aufheben“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const auftrag = await fuelle<{ id: number; lfd_nr: number }>(
      page,
      'post',
      `/api/einsaetze/${demo.id}/auftraege`,
      {
        auftrag_text: 'Sandsäcke vom Bauhof zur Unterführung Lindenstraße bringen.',
        empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Logistiktrupp' }],
      },
    );
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/auftraege`);
    await page.getByRole('button', { name: `Aktionen zu Auftrag #${auftrag.lfd_nr}` }).click();
    await page.getByRole('menuitem', { name: 'Auftrag aufheben' }).click();
    const dialog = page.getByRole('dialog', { name: `Auftrag #${auftrag.lfd_nr} aufheben` });
    await dialog.getByLabel('Grund').fill('Material kommt direkt vom Bauhof.');
    await fokusWeg(page);
    await expect(dialog.getByRole('button', { name: 'Auftrag aufheben' })).toBeVisible();
    await fotografiere(dialog, KAPITEL, 'auftrag-aufheben');
  });

  test('Befehlsentwurf auf der Detailseite', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const befehl = await fuelle<{ id: number }>(page, 'post', `/api/einsaetze/${demo.id}/befehle`, {
      vorlage: 'befehl_lad',
      titel: 'Befehl an Logistiktrupp: Sicherung Lindenstraße',
      abschnitte: [
        {
          schluessel: 'lage',
          text: 'Wasser steht in der Unterführung Lindenstraße, Keller Nr. 4 bis 8 laufen voll.',
        },
        {
          schluessel: 'auftrag',
          text: 'Logistiktrupp sichert die Keller Lindenstraße 4 bis 8 mit Sandsäcken.',
        },
        {
          schluessel: 'durchfuehrung',
          text: 'Anfahrt über Mühlbachweg, Sandsäcke vom Bereitstellungsraum, Meldung bei Abschluss an ELW 1.',
        },
      ],
    });
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/auftraege/befehle/${befehl.id}`);
    await expect(page.getByRole('button', { name: 'Freigeben' })).toBeVisible();
    await expect(page.getByText('Logistiktrupp sichert die Keller').first()).toBeVisible();
    await fokusWeg(page);
    await fotografiere(page, KAPITEL, 'befehl-entwurf');
  });
});
