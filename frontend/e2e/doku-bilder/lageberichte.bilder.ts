import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Lageberichte“ (`docs/anwender/kapitel/lageberichte.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep lageberichte`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   lageberichte.png       frontend/src/pages/LageberichtePage.tsx,
 *                          frontend/src/lageberichte/LageberichtUebersicht.tsx,
 *                          frontend/src/lageberichte/NeuerLagevortragKnopf.tsx
 *   entwurf.png            frontend/src/pages/LageberichtDetailPage.tsx,
 *                          frontend/src/entwurf/VerteilerField.tsx,
 *                          frontend/src/entwurf/DokumentEntwurf.tsx,
 *                          frontend/src/lageberichte/AbschnittUebernahme.tsx,
 *                          frontend/src/lageberichte/LeereAbschnitteFuellen.tsx,
 *                          frontend/src/lageberichte/UebernahmeStand.tsx,
 *                          frontend/src/lageberichte/eigeneLageUebernahme.ts
 *   freigeben.png          frontend/src/pages/LageberichtDetailPage.tsx (FreigabeDialog)
 *   freigegeben.png        frontend/src/pages/LageberichtDetailPage.tsx (Lesezweig)
 *
 * Die Demo bringt einen freigegebenen Lagebericht mit; den Entwurf legt der Lauf über die API an.
 * Die Übernahme zeigt „Eigene Lage“: sie liest nur Daten des Hubs. Die Gefahren-/Schadenlage
 * läse Wetter und Pegel aus externen Quellen und wäre im Bild nicht reproduzierbar.
 */

const KAPITEL = 'lageberichte';
const ENTWURF = 'Lagevortrag 13. Stunde';

/** Legt einen Entwurf „Lagevortrag zur Information“ mit gefülltem Auftrag an. */
async function entwurfAnlegen(page: Page, einsatzId: number): Promise<number> {
  const bericht = await fuelle<{ id: number }>(
    page,
    'post',
    `/api/einsaetze/${einsatzId}/lageberichte`,
    {
      vorlage: 'lagebericht',
      titel: ENTWURF,
      abschnitte: [
        {
          schluessel: 'auftrag',
          text: 'Schutz der Bevölkerung in der Unterstadt, Versorgung und Betreuung Betroffener.',
        },
      ],
    },
  );
  // Verteiler (LLH-1172): übergeordnete Führung und Einsatzleitung.
  await fuelle(page, 'patch', `/api/einsaetze/${einsatzId}/lageberichte/${bericht.id}`, {
    verteiler: [
      {
        empfaenger_typ: 'extern',
        extern_kategorie: 'uebergeordnet',
        extern_bezeichnung: 'Krisenstab Landkreis',
      },
      { empfaenger_typ: 'funktion', funktion: 'el' },
    ],
  });
  return bericht.id;
}

/**
 * Kennung des freigegebenen Demo-Lageberichts — nicht des Entwurfs, den der Test davor freigibt
 * (dieselbe Datenbank).
 */
async function freigegebenerBericht(page: Page, einsatzId: number): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/lageberichte`);
  expect(antwort.ok()).toBe(true);
  const liste = (await antwort.json()) as { id: number; status: string; titel: string }[];
  const bericht = liste.find((b) => b.status === 'freigegeben' && b.titel !== ENTWURF);
  expect(bericht, 'Demo ohne freigegebenen Lagebericht').toBeTruthy();
  return bericht!.id;
}

test.describe(KAPITEL, () => {
  test('Übersicht der Lageberichte', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await entwurfAnlegen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lageberichte`);
    await expect(page.getByRole('region', { name: 'Aktueller Lagevortrag' })).toBeVisible();
    const inArbeit = page.getByRole('region', { name: 'In Arbeit' });
    await expect(inArbeit.getByRole('link', { name: ENTWURF })).toBeVisible();
    // Füllstand und „zuletzt gespeichert“ kommen aus dem Einzelabruf: erst danach fotografieren.
    await expect(inArbeit.getByText(/^\d+\/8 Abschnitte$/)).toBeVisible();
    await fotografiere(page, KAPITEL, 'lageberichte');
    // Ablauf weiter: den Entwurf öffnen.
    await inArbeit.getByRole('link', { name: ENTWURF }).click();
    await expect(page.getByRole('button', { name: 'Entwurf speichern' })).toBeVisible();
  });

  test('„Neuer Lagevortrag“ öffnet den Entwurf', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lageberichte`);
    await page.getByRole('button', { name: 'Neuer Lagevortrag' }).click();
    // Kein Dialog: der Entwurf öffnet sich, der Titel nennt „Lageüberblick“ und die Uhrzeit.
    await expect(page.getByRole('button', { name: 'Entwurf speichern' })).toBeVisible();
    await expect(page.getByLabel('Titel')).toHaveValue(/^Lageüberblick \d{4}$/);
  });

  test('Entwurf mit Übernahme in die Eigene Lage', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const id = await entwurfAnlegen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lageberichte/${id}`);
    // Alle Abschnitte stehen offen; die Übernahme steht im Kopf der Eigenen Lage.
    await page
      .getByRole('button', { name: 'Aus Meldebild und Führungsorganisation übernehmen' })
      .click();
    const feld = page.getByRole('textbox', { name: 'Eigene Lage' });
    await expect(feld).not.toHaveValue('');
    await expect(page.getByText(/^(zuletzt gespeichert|ungespeicherte Änderungen)/)).toBeVisible();
    await page.mouse.move(0, 0);
    // Der Klick auf die Übernahme hat die Seite verschoben; das Bild zeigt sie vom Kopf an.
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await fotografiere(page, KAPITEL, 'entwurf');
    // Ablauf weiter: einen Abschnitt von Hand schreiben und speichern.
    await page
      .getByRole('textbox', { name: 'Zusammenfassung' })
      .fill('Lage in der Unterstadt angespannt, Betreuung gesichert.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page.getByText(/^zuletzt gespeichert \d{4}/)).toBeVisible();
  });

  test('Rückfrage vor dem Freigeben', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const id = await entwurfAnlegen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lageberichte/${id}`);
    await page.getByRole('button', { name: 'Freigeben' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lagebericht freigeben?' });
    await expect(dialog.getByText(/^Endgültig: geht ins ETB/)).toBeVisible();
    // Erst nach dem Einblenden: mitten in der Animation ist der Dialog noch durchsichtig.
    await expect(dialog).not.toHaveClass(/ant-zoom-appear/);
    await fotografiere(dialog, KAPITEL, 'freigeben');
    await dialog.getByRole('button', { name: 'Freigeben' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Fortschreiben' })).toBeVisible();
  });

  test('Freigegebener Bericht mit Fortschreiben', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const id = await freigegebenerBericht(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lageberichte/${id}`);
    await expect(page.getByRole('region', { name: 'Berichtstext' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fortschreiben' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'freigegeben');
    // Der Ablauf geht weiter: Fortschreiben öffnet die neue Fassung als Entwurf.
    await page.getByRole('button', { name: 'Fortschreiben' }).click();
    await expect(page.getByRole('button', { name: 'Freigeben' })).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`/lageberichte/${id}$`));
  });
});
