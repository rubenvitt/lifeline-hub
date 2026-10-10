import type { Page } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Lagemeldungen“ (`docs/anwender/kapitel/lagemeldungen.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep lagemeldungen`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   an-lage-uebergeben.png  frontend/src/meldungen/LagerelevantModal.tsx
 *   lagemeldungen.png       frontend/src/pages/LagemeldungenPage.tsx
 *
 * Die Demo enthält Meldungen, aber keine an die Lage übergebene; der Dialog-Test übergibt eine
 * verortete über die Oberfläche, der Zeitleisten-Test drei weitere über
 * `POST …/meldungen/{mid}/lagerelevant`, eine davon verortet. Bei der verorteten blendet der Lauf
 * den Ortsnamen aus (externer Geocoder, nicht deterministisch); die Peilung bleibt.
 */

const KAPITEL = 'lagemeldungen';

interface Meldung {
  id: number;
  lfd_nr: number;
  inhalt: string;
  lagerelevant: boolean;
  meldungsart: string;
}

/**
 * Offene Meldungen der Demo, die noch nicht an die Lage übergeben sind: Lagemeldungen zuerst, dann
 * nach laufender Nummer.
 */
async function offeneMeldungen(page: Page, einsatzId: number): Promise<Meldung[]> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/meldungen`);
  expect(antwort.ok()).toBe(true);
  const liste = (await antwort.json()) as Meldung[];
  const offen = liste
    .filter((m) => !m.lagerelevant)
    .sort(
      (a, b) =>
        Number(b.meldungsart === 'lagemeldung') - Number(a.meldungsart === 'lagemeldung') ||
        a.lfd_nr - b.lfd_nr,
    );
  expect(offen.length, 'Demo mit zu wenigen offenen Meldungen').toBeGreaterThanOrEqual(3);
  return offen;
}

test.describe(KAPITEL, () => {
  test('Dialog „An die Lage übergeben“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/meldungen`);
    // Die oberste Meldung: ganz unten läge der Knopf der Entwicklerwerkzeuge über ihrem Menü. Ab
    // drei Aktionen bündelt die Karte sie in einem Menü; eine neue Meldung hat mehr als drei.
    await page
      .getByRole('button', { name: /^Aktionen zu Meldung \d+$/ })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'An Lage übergeben' }).click();
    const dialog = page.getByRole('dialog', { name: 'An die Lage übergeben' });
    // Vorbelegt mit dem Inhalt der Meldung.
    await expect(dialog.getByLabel('Lage-Text')).not.toHaveValue('');
    await dialog.getByLabel('Lage-Text').blur();
    await fotografiere(dialog, KAPITEL, 'an-lage-uebergeben');
    // Ablauf weiter: verorten (im Gebiet des Demo-Szenarios) und übergeben.
    await dialog.getByPlaceholder('Koordinate eingeben').fill('50.9558, 10.2497');
    await dialog.getByRole('button', { name: 'Übergeben' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.ant-message').getByText('An die Lage übergeben')).toBeVisible();
  });

  test('Zeitleiste der Lagemeldungen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const offen = await offeneMeldungen(page, demo.id);
    // Eine verortet (in der Unterstadt des Demo-Szenarios), eine mit eigenem Lage-Text.
    await fuelle(page, 'post', `/api/einsaetze/${demo.id}/meldungen/${offen[0].id}/lagerelevant`, {
      lat: 50.952,
      lon: 10.246,
    });
    await fuelle(
      page,
      'post',
      `/api/einsaetze/${demo.id}/meldungen/${offen[1].id}/lagerelevant`,
      {},
    );
    await fuelle(page, 'post', `/api/einsaetze/${demo.id}/meldungen/${offen[2].id}/lagerelevant`, {
      text: offen[2].inhalt,
    });
    // Den Ortsnamen holt der Server bei einem externen Geocoder; das Bild zeigt nur, was er selbst
    // rechnet (die Peilung, sofern ein verorteter Bezug in der Nähe ist).
    await page.route(`**/api/einsaetze/${demo.id}/ort-vorschau*`, async (route) => {
      const antwort = await route.fetch();
      const json = (await antwort.json()) as Record<string, unknown>;
      await route.fulfill({ response: antwort, json: { ...json, ortsname: null } });
    });
    await uhrAnhalten(page);
    const ortVorschau = page.waitForResponse((r) => r.url().includes('/ort-vorschau'));
    await page.goto(`/einsaetze/${demo.id}/lagemeldungen`);
    // Dazu kommt die Übergabe aus dem Dialog-Test davor (dieselbe Datenbank).
    const eintraege = page.getByRole('region', { name: 'Lagemeldungen' }).getByRole('listitem');
    await expect(eintraege).toHaveCount(4);
    await expect(page.getByText('4 übergeben')).toBeVisible();
    await ortVorschau;
    await expect(page.getByText('Ort wird ermittelt …')).toHaveCount(0);
    await fotografiere(page, KAPITEL, 'lagemeldungen');
    // Ablauf weiter: suchen, Zeitfenster, Ort, Sprung zur Quellmeldung.
    const suche = page.getByPlaceholder('Meldungstext, Absender oder Nr.');
    await suche.fill('Kellerabgang');
    await expect(eintraege).toHaveCount(1);
    await suche.fill('');
    await page.getByRole('radio', { name: 'Heute' }).click();
    await expect(eintraege).toHaveCount(4);
    await page.getByRole('radio', { name: 'Mit Koordinaten' }).click();
    await expect(eintraege).toHaveCount(2);
    await expect(page.getByText('2 von 4 übergeben')).toBeVisible();
    await eintraege
      .first()
      .getByRole('link', { name: /^Meldung #\d+$/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${demo.id}/meldungen`));
  });
});
