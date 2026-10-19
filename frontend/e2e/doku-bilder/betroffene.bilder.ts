import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Betroffene und Sichtung“ (`docs/anwender/kapitel/betroffene.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep betroffene`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   liste.png        frontend/src/pages/PersonenPage.tsx, frontend/src/personen/BetroffenenSeitenleiste.tsx,
 *                    frontend/src/personen/personenSpalten.tsx, frontend/src/personen/ZeilenSichtung.tsx
 *   erfassen.png     frontend/src/personen/PersonErfassungModal.tsx, frontend/src/personen/AufnahmeFelder.tsx
 *   kurzeingabe.png  frontend/src/personen/BetroffeneZeile.tsx
 *   verbleib.png     frontend/src/personen/Patientenkopf.tsx, frontend/src/personen/VerbleibErfassung.tsx,
 *                    frontend/src/personen/RettungsmittelFeld.tsx
 *   koerperschema.png frontend/src/personen/Patientenkopf.tsx, frontend/src/personen/PatKennzeichen.tsx,
 *                    frontend/src/personen/koerperschema/Koerperschema.tsx, frontend/src/personen/koerperschema/KoerperFigur.tsx
 *
 * Daten: die Betroffenen des Demo-Einsatzes reichen; nur für den vollen PAT-Kern füllt die Spec
 * eine eigene Person (Transport, PAT-Nummer, Kontamination, Maßnahmen, Verletzungen) über die API.
 */

const KAPITEL = 'betroffene';

/** Kennung einer Demo-Person über ihren Nachnamen. */
async function personId(page: Page, einsatzId: number, name: string): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/personen`);
  expect(antwort.ok(), `Personen des Demo-Einsatzes: ${antwort.status()}`).toBe(true);
  const personen = (await antwort.json()) as { id: number; name: string | null }[];
  const person = personen.find((p) => p.name === name);
  expect(person, `Demo-Person ${name}`).toBeDefined();
  return person!.id;
}

test.describe(KAPITEL, () => {
  test('Liste der Betroffenen mit Seitenleiste', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen`);
    await expect(page.getByRole('cell', { name: 'Mustermann, Erika' })).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Lagebild der Betroffenen' }),
    ).toBeVisible();
    await fotografiere(page, KAPITEL, 'liste');
  });

  test('Maske „Betroffene erfassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen`);
    await page.getByRole('button', { name: 'Betroffene erfassen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Betroffene erfassen' });
    await dialog.getByRole('radio', { name: /^SK II,/ }).click();
    await expect(dialog.getByRole('radio', { name: /^SK II,/ })).toBeChecked();
    await waehleIn(dialog.getByRole('combobox', { name: 'Geschlecht' }), 'männlich');
    await dialog.getByLabel('Geschätztes Alter (Jahre)').fill('45');
    await dialog.getByLabel('Fundort').fill('Mühlbachweg 12, Keller');
    await dialog.getByLabel('Fundort').blur();
    await fotografiere(dialog, KAPITEL, 'erfassen');
  });

  test('Kurzeingabe „/person“ mit erkannten Angaben', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen`);
    const band = page.locator('[data-lfh="erfassungsband"]');
    const feld = band.getByRole('textbox', { name: 'Kurzeingabe Person' });
    await feld.fill('Kowalski, Anna w 34 sk3 @Turnhalle');
    await expect(band.locator('[data-lfh="erkannt"]')).toContainText('UHS Turnhalle');
    await feld.blur();
    await fotografiere(band, KAPITEL, 'kurzeingabe');
  });

  test('Patientenkopf mit Paneel „Verbleib erfassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const id = await personId(page, demo.id, 'Vorlage');
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen/${id}`);
    const kopf = page.getByRole('region', { name: 'Patientenkopf' });
    await kopf.getByRole('button', { name: 'Verbleib erfassen' }).click();
    const paneel = page.getByRole('region', { name: 'Verbleib erfassen' });
    await waehleIn(paneel.getByRole('combobox', { name: 'Art' }), 'Transport');
    await paneel.getByLabel('Ziel').fill('Klinikum Musterstadt');
    // Fremdes Rettungsmittel (LLH-1332): getippt, die Marke zeigt „fremdes Rettungsmittel“.
    await paneel.getByRole('combobox', { name: /Rettungsmittel/ }).fill('KTW 1');
    await paneel.getByRole('combobox', { name: /Rettungsmittel/ }).blur();
    await fotografiere(kopf, KAPITEL, 'verbleib');
  });

  test('Patientenkopf mit vollem PAT-Kern und Paneel „Verletzung markieren“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const basis = `/api/einsaetze/${demo.id}/personen`;
    const person = await fuelle<{ id: number }>(page, 'post', basis, {
      name: 'Brandt',
      vorname: 'Jonas',
      geschlecht: 'maennlich',
      alter_geschaetzt: 52,
      sichtung: 'sk2',
      zustand: 'Verdacht auf Unterarmfraktur links',
    });
    const pfad = `${basis}/${person.id}`;
    await fuelle(page, 'patch', pfad, { pat_nummer: 'A-4711', kontamination: true });
    await fuelle(page, 'post', `${pfad}/transport`, {
      prioritaet: 'dringlich',
      art: 'liegend',
      fachrichtung: 'unfallchirurgie',
    });
    for (const art of ['blutstillung', 'immobilisation']) {
      await fuelle(page, 'post', `${pfad}/massnahmen`, { art });
    }
    for (const verletzung of [
      { ansicht: 'vorn', region: 'kopf', art: 'wunde_blutung', schwere: 'leicht' },
      { ansicht: 'hinten', region: 'ruecken', art: 'prellung_schwellung' },
    ]) {
      await fuelle(page, 'post', `${pfad}/verletzungen`, verletzung);
    }
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/personen/${person.id}`);
    const kopf = page.getByRole('region', { name: 'Patientenkopf' });
    await expect(kopf.locator('[data-lfh="transport"]')).toContainText('dringlich · liegend');
    await kopf.getByRole('button', { name: 'Verletzung markieren' }).click();
    const paneel = page.getByRole('region', { name: 'Verletzung markieren' });
    await paneel.getByRole('button', { name: 'Unterarm links, vorn' }).click();
    await expect(
      paneel.getByRole('group', { name: 'Verletzung an Unterarm links, vorn' }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(kopf, KAPITEL, 'koerperschema');

    // Nachgeklickt: der zweite Tipp speichert, Sternchen und Liste tragen die Nummer 3.
    await paneel.getByRole('radio', { name: 'Fraktur-Verdacht' }).click();
    await expect(paneel.getByRole('list', { name: 'Verletzungen' })).toContainText(
      'Unterarm links, vorn · Fraktur-Verdacht',
    );
  });
});
