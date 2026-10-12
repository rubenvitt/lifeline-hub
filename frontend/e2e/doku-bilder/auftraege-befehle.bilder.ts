import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Aufträge und Befehle“ (`docs/anwender/kapitel/auftraege-befehle.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep auftraege-befehle`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   auftraege-liste.png    frontend/src/pages/AuftraegePage.tsx, frontend/src/auftraege/AuftraegeListe.tsx,
 *                          frontend/src/components/ListeDetail.tsx,
 *                          frontend/src/auftraege/AuftragListenKarte.tsx,
 *                          frontend/src/auftraege/AuftragDetail.tsx
 *   auftrag-erteilen.png   frontend/src/auftraege/AuftragErteilenDialog.tsx,
 *                          frontend/src/auftraege/AuftragFormular.tsx,
 *                          frontend/src/auftraege/auftragsschemaKern.ts
 *   auftrag-aufheben.png   frontend/src/auftraege/AuftragAufhebenDialog.tsx
 *   befehl-detail.png      frontend/src/auftraege/BefehlListe.tsx,
 *                          frontend/src/auftraege/BefehlListenKarte.tsx,
 *                          frontend/src/auftraege/BefehlDetail.tsx
 *   befehl-entwurf.png     frontend/src/pages/BefehlDetailPage.tsx,
 *                          frontend/src/entwurf/VerteilerFeld.tsx,
 *                          frontend/src/fuehrung/EmpfaengerWahl.tsx,
 *                          frontend/src/fuehrung/ExterneEmpfaenger.tsx
 */

const KAPITEL = 'auftraege-befehle';

/** Leert den Fokus, damit kein Fokusring und kein Cursor im Bild steht. */
async function fokusWeg(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe(KAPITEL, () => {
  test('Einzelaufträge: Liste und gewählter Auftrag', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/auftraege`);
    await expect(page.getByRole('button', { name: 'Auftrag erteilen' })).toBeVisible();
    // Ab lg ist der oberste Auftrag gewählt; sein Detail trägt die Handlungen.
    const detail = page.locator('[data-lfh="liste-detail-detail"]');
    await expect(detail.getByRole('button', { name: 'Vollzug melden' })).toBeVisible();
    await fokusWeg(page);
    await fotografiere(page.locator('[data-lfh="liste-detail"]'), KAPITEL, 'auftraege-liste');
  });

  test('Dialog „Auftrag erteilen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/auftraege`);
    await page.getByRole('button', { name: 'Auftrag erteilen' }).click();
    const dialog = page.getByRole('dialog');
    // Reihenfolge der FwDV 100 (LLH-1091): erst die Einheit, dann der Auftrag.
    const empfaenger = dialog.getByRole('combobox', { name: 'Empfänger' });
    await empfaenger.fill('Logistiktrupp');
    await empfaenger.press('Enter');
    await dialog
      .getByLabel('Auftrag / Was')
      .fill('Sandsäcke an der Unterführung Lindenstraße auslegen, Keller Nr. 6 sichern.');
    await waehleIn(dialog.getByRole('combobox', { name: 'Priorität' }), 'Dringend');
    await fokusWeg(page);
    await expect(dialog.getByTitle('Logistiktrupp')).toBeVisible();
    await fotografiere(dialog, KAPITEL, 'auftrag-erteilen');
  });

  test('Einsatzbefehle: Liste und gewählter Entwurf', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await fuelle(page, 'post', `/api/einsaetze/${demo.id}/befehle`, {
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
      ],
    });
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/auftraege?reiter=befehle`);
    const detail = page.locator('[data-lfh="liste-detail-detail"]');
    await expect(detail.getByRole('button', { name: 'Freigeben' })).toBeVisible();
    await expect(detail.getByText('Logistiktrupp sichert die Keller')).toBeVisible();
    await fokusWeg(page);
    await fotografiere(page.locator('[data-lfh="liste-detail"]'), KAPITEL, 'befehl-detail');
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
    await page.goto(`/einsaetze/${demo.id}/auftraege?auftrag=${auftrag.id}`);
    // Der Knopf der TanStack-Devtools (nur am Vite-Entwicklungsserver) liegt sonst über dem Menü,
    // wie in `e2e/dialoge-handy.spec.ts`.
    await page.addStyleTag({ content: '[class*="tsqd-open-btn"] { display: none !important; }' });
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
    // Verteiler (LLH-1172): ein Abschnitt des Demo-Einsatzes, S3 und die Leitstelle.
    const antwort = await page.request.get(`/api/einsaetze/${demo.id}/abschnitte`);
    expect(antwort.ok()).toBe(true);
    const abschnitte = (await antwort.json()) as { id: number }[];
    expect(abschnitte.length, 'Demo ohne Einsatzabschnitt').toBeGreaterThan(0);
    await fuelle(page, 'patch', `/api/einsaetze/${demo.id}/befehle/${befehl.id}`, {
      verteiler: [
        { empfaenger_typ: 'abschnitt', abschnitt_id: abschnitte[0].id },
        { empfaenger_typ: 'funktion', funktion: 's4' },
        {
          empfaenger_typ: 'extern',
          extern_kategorie: 'leitstelle',
          extern_bezeichnung: 'ILS Musterstadt',
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
