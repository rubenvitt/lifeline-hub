import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Schäden“ (`docs/anwender/kapitel/schaeden.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep schaeden`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   liste.png       frontend/src/pages/SchaedenPage.tsx
 *   erfassen.png    frontend/src/pages/schaeden/SchadenErfassenModal.tsx
 *   uebergeben.png  frontend/src/pages/SchaedenDetailPage.tsx
 *
 * Daten: der Demo-Einsatz hat keine Schäden. Vier kommen per API dazu (D3), in allen drei Status;
 * zwei sind verortet (Koordinaten in der Unterstadt des Demo-Szenarios).
 */

const KAPITEL = 'schaeden';

interface Schaden {
  id: number;
  ort: string;
}

/** Legt die Schäden einmal je Lauf an (die Datenbank gilt für alle Tests eines Laufs). */
async function schaedenAnlegen(page: Page, einsatzId: number): Promise<Schaden[]> {
  const basis = `/api/einsaetze/${einsatzId}/schaeden`;
  const vorhanden = (await (await page.request.get(basis)).json()) as Schaden[];
  if (vorhanden.length > 0) return vorhanden;
  await fuelle(page, 'post', basis, {
    typ: 'umweltschaden',
    ausmass: 'gross',
    ort: 'Mühlbachweg 12',
    beschreibung: 'Heizöltank im Keller aufgeschwommen, Ölfilm auf dem Wasser',
    lat: 50.953,
    lon: 10.246,
  });
  const baum = await fuelle<Schaden>(page, 'post', basis, {
    typ: 'verkehrshindernis',
    ausmass: 'mittel',
    ort: 'L 235 km 12,5',
    beschreibung: 'Baum auf der Fahrbahn, halbseitig gesperrt',
  });
  await fuelle(page, 'post', `${basis}/${baum.id}/uebergeben`, {
    uebergeben_an: 'Straßenmeisterei',
  });
  const mauer = await fuelle<Schaden>(page, 'post', basis, {
    typ: 'sachschaden',
    ausmass: 'gering',
    ort: 'Uferstraße 6',
    beschreibung: 'Gartenmauer teilweise eingestürzt, keine Gefahr für Passanten',
  });
  await fuelle(page, 'post', `${basis}/${mauer.id}/abschliessen`, {
    abschluss_grund: 'kein_handlungsbedarf',
  });
  await fuelle(page, 'post', basis, {
    typ: 'infrastruktur',
    ausmass: 'gross',
    ort: 'Brücke Mühlbachweg',
    beschreibung: 'Widerlager unterspült, Brücke für Fahrzeuge gesperrt',
    lat: 50.951,
    lon: 10.243,
  });
  return (await (await page.request.get(basis)).json()) as Schaden[];
}

test.describe(KAPITEL, () => {
  test('Liste der Schäden in der Sicht „Alle“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await schaedenAnlegen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/schaeden`);
    await page.getByRole('radio', { name: 'Alle', exact: true }).click();
    await expect(page.getByText('Uferstraße 6').first()).toBeVisible();
    await expect(page.getByText('Brücke Mühlbachweg').first()).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'liste');
  });

  test('Dialog „Schaden erfassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/schaeden`);
    await page.getByRole('button', { name: 'Schnellerfassung' }).click();
    const dialog = page.getByRole('dialog', { name: 'Schaden erfassen' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Typ' }), 'Sachschaden');
    await waehleIn(dialog.getByRole('combobox', { name: 'Ausmaß' }), 'mittel');
    await dialog.getByLabel('Ort').fill('Mühlbachweg 18');
    await dialog.getByLabel('Beschreibung').fill('Garagentor eingedrückt, Fahrzeug im Wasser');
    await dialog.getByLabel('Beschreibung').blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'erfassen');
  });

  test('Dialog „Schaden übergeben“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const schaeden = await schaedenAnlegen(page, demo.id);
    const oel = schaeden.find((s) => s.ort === 'Mühlbachweg 12')!;
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/schaeden/${oel.id}`);
    await page.getByRole('button', { name: 'Übergeben', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Schaden übergeben' });
    await dialog.getByLabel('Übergeben an').fill('Untere Wasserbehörde');
    await dialog.getByLabel('Übergeben an').blur();
    await fotografiere(dialog, KAPITEL, 'uebergeben');
  });
});
