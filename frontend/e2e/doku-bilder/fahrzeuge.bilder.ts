import type { APIRequestContext } from '@playwright/test';
import { offeneAuswahl, waehleStehend } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Fahrzeuge und FMS“ (`docs/anwender/kapitel/fahrzeuge.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep fahrzeuge`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   fahrzeuge.png    frontend/src/pages/FahrzeugePage.tsx (Ansicht „Liste“),
 *                    frontend/src/components/Datensicht.tsx
 *   besatzung.png    frontend/src/pages/FahrzeugePage.tsx (`BesatzungsBlock`)
 *   beladung.png     frontend/src/pages/FahrzeugePage.tsx (Block „Beladung“ im Aufklapper),
 *                    frontend/src/kraefte/MaterialAmOrt.tsx
 *   fahrzeuge-disponieren.png frontend/src/kraefte/FahrzeugeDisponierenModal.tsx
 *   fms-tableau.png  frontend/src/kraefte/FmsTableau.tsx, frontend/src/kraefte/fmsTableauKern.ts
 *   entlassen.png    frontend/src/kraefte/EntlassenBlock.tsx (Block unter der Liste)
 *   angaben-aendern.png frontend/src/kraefte/FahrzeugAngabenDialog.tsx,
 *                    frontend/src/kraefte/AdhocFahrzeugFelder.tsx (Zeilenmenü „Angaben ändern …“)
 *   eigene-einheit.png frontend/src/kraefte/EigeneEinheitDialog.tsx,
 *                    frontend/src/kraefte/eigeneEinheit.ts (Zeilenmenü „Als eigene Einheit führen …“)
 *   personal-uebernehmen.png frontend/src/kraefte/BesatzungUebernehmenDialog.tsx,
 *                    frontend/src/kraefte/besatzungVorschlag.ts (Knopf im `BesatzungsBlock`)
 *
 * Demo-Lücke (D3): die Demo-Fahrzeuge haben keine Besatzung. Die Spec setzt Anna und Paul Probe
 * (Rettungsstaffel) und Lena Beispiel (andere Einheit) auf den RTW „83-1“. Für den Dialog
 * „Fahrzeuge disponieren“ legt sie zwei Stamm-Fahrzeuge an, die noch nicht im Einsatz sind
 * (LLH-1100): die Demo-Fahrzeuge sind alle disponiert. Für den Block „Entlassen“ disponiert sie
 * ein Ad-hoc-Fahrzeug und entlässt es (LLH-1079 Teil II); die Bilder davor zeigen es nicht. Für den
 * Dialog „Angaben ändern“ disponiert sie ein weiteres Ad-hoc-Fahrzeug (LLH-1073). Für den Dialog
 * „Als eigene Einheit führen“ disponiert sie zuletzt ein Ad-hoc-Fahrzeug einer Nachbarwehr mit zwei
 * Ad-hoc-Kräften als Besatzung (LLH-1073 Teil II). „Personal der Einheit übernehmen“ zeigt den RTW
 * „83-2“ der Rettungsstaffel mit ihren freien Kräften, ohne weitere Füllung. Für die Beladung
 * (LLH-1225 Teil II) lädt sie Rettungsdecken und eine defekte Absaugpumpe auf den RTW „83-1“ und
 * legt einen freien Posten an.
 */

const KAPITEL = 'fahrzeuge';

/** Stamm-Fahrzeuge für den Dialog „Fahrzeuge disponieren“, nicht im Demo-Einsatz. */
const NEUE_STAMMFAHRZEUGE = [
  { funkrufname: 'Musterstadt 83-3', fahrzeugtyp: 'RTW', traegerorganisation: 'DRK Musterstadt' },
  { funkrufname: 'Musterstadt 85-3', fahrzeugtyp: 'KTW', traegerorganisation: 'DRK Musterstadt' },
];

interface Fahrzeug {
  id: number;
  funkrufname: string;
}
interface Person {
  id: number;
  name: string;
}

async function liste<T>(api: APIRequestContext, pfad: string): Promise<T[]> {
  const antwort = await api.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  return (await antwort.json()) as T[];
}

test.describe(KAPITEL, () => {
  test('Fahrzeuge im Einsatz', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await expect(page.locator('[data-lfh="besatzung-urteil"]').first()).toBeVisible();
    await expect(page.getByText(/83-1/).first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'fahrzeuge');
  });

  test('Besatzung eines Fahrzeugs', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    // Erst hier gefüllt: mit Besatzung wird die Liste breiter als die Fläche, das Listenbild
    // davor zeigt den Stand der Demo-Daten.
    const fahrzeuge = await liste<Fahrzeug>(page.request, `/api/einsaetze/${demo.id}/fahrzeuge`);
    const rtw = fahrzeuge.find((f) => f.funkrufname.endsWith('83-1'));
    expect(rtw, 'RTW 83-1 im Demo-Einsatz').toBeDefined();
    const personal = await liste<Person>(page.request, `/api/einsaetze/${demo.id}/personal`);
    for (const name of ['Anna Probe', 'Paul Probe', 'Lena Beispiel']) {
      const person = personal.find((p) => p.name === name);
      expect(person, `${name} im Demo-Einsatz`).toBeDefined();
      await fuelle(
        page,
        'put',
        `/api/einsaetze/${demo.id}/fahrzeuge/${rtw!.id}/besatzung/${person!.id}`,
      );
    }
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await page.getByRole('button', { name: /^Besatzung zu .*83-1$/ }).click();
    const block = page.locator('[data-lfh="besatzung-block"]');
    await expect(block.getByText('andere Einheit')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(block, KAPITEL, 'besatzung');
  });

  test('Beladung eines Fahrzeugs', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    // Demo-Lücke (LLH-1225): kein Demo-Fahrzeug trägt Material. Die Spec lädt zwei Posten auf den
    // RTW „83-1“, einen davon defekt, gibt von den Decken einen Teil aus und legt einen freien
    // Posten an, den die Auswahl anbietet.
    const fahrzeuge = await liste<Fahrzeug>(page.request, `/api/einsaetze/${demo.id}/fahrzeuge`);
    const rtw = fahrzeuge.find((f) => f.funkrufname.endsWith('83-1'));
    expect(rtw, 'RTW 83-1 im Demo-Einsatz').toBeDefined();
    const basis = `/api/einsaetze/${demo.id}/material`;
    const decken = await fuelle<{ id: number }>(page, 'post', basis, {
      adhoc: { bezeichnung: 'Rettungsdecken' },
      menge: 10,
      art: 'verbrauchsgut',
      einsatz_fahrzeug_id: rtw!.id,
    });
    await fuelle(page, 'patch', `${basis}/${decken.id}`, { ausgegeben: 4 });
    const absauger = await fuelle<{ id: number }>(page, 'post', basis, {
      adhoc: { bezeichnung: 'Absaugpumpe' },
      einsatz_fahrzeug_id: rtw!.id,
    });
    await fuelle(page, 'patch', `${basis}/${absauger.id}`, { status: 'defekt' });
    // Ein freier Posten, damit „Material zuordnen …“ etwas anbietet.
    await fuelle(page, 'post', basis, { adhoc: { bezeichnung: 'Stromerzeuger' } });
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await page.getByRole('button', { name: /^Besatzung zu .*83-1$/ }).click();
    const block = page.locator('[data-lfh="beladung-block"]');
    await expect(block.getByText('6 von 10 übrig')).toBeVisible();
    await expect(block.getByRole('combobox', { name: 'Material zuordnen' })).toBeEnabled();
    await page.mouse.move(0, 0);
    await fotografiere(block, KAPITEL, 'beladung');
  });

  test('FMS-Tableau', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=tableau`);
    const tableau = page.getByRole('region', { name: 'FMS-Tableau' });
    await expect(tableau.locator('[data-lfh="fms-kachel"]').first()).toBeVisible();
    await fotografiere(tableau, KAPITEL, 'fms-tableau');
  });

  test('Dialog „Fahrzeuge disponieren“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    for (const fahrzeug of NEUE_STAMMFAHRZEUGE)
      await fuelle(page, 'post', '/api/fahrzeuge', fahrzeug);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await page.getByRole('button', { name: 'Fahrzeuge disponieren' }).click();
    const dialog = page.getByRole('dialog', { name: 'Fahrzeuge disponieren' });
    const titel = dialog.locator('.ant-modal-title');
    const auswahl = dialog.getByRole('combobox', { name: 'Fahrzeuge' });
    for (const fahrzeug of NEUE_STAMMFAHRZEUGE) {
      await auswahl.click();
      await auswahl.fill(fahrzeug.funkrufname);
      await waehleStehend(page, `${fahrzeug.funkrufname} (${fahrzeug.fahrzeugtyp})`);
    }
    await titel.click();
    await expect(offeneAuswahl(page)).toHaveCount(0);
    await dialog.getByRole('combobox', { name: 'In Einheit' }).click();
    await waehleStehend(page, 'Sanitätszug Musterstadt');
    await titel.click();
    await expect(offeneAuswahl(page)).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'fahrzeuge-disponieren');
  });

  test('Block „Entlassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const weg = await fuelle<Fahrzeug>(page, 'post', `/api/einsaetze/${demo.id}/fahrzeuge`, {
      adhoc: {
        funkrufname: 'Musterstadt 19-1',
        fahrzeugtyp: 'MTW',
        traegerorganisation: 'DRK Musterstadt',
      },
    });
    await fuelle(page, 'post', `/api/einsaetze/${demo.id}/fahrzeuge/${weg.id}/entlassen`);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    const block = page.locator('[data-lfh="entlassen-block"]');
    await block.getByText('Entlassen (1)').click();
    await expect(
      block.getByRole('button', { name: 'Erneut disponieren: Musterstadt 19-1' }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(block, KAPITEL, 'entlassen');
  });

  test('Dialog „Angaben ändern“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await fuelle(page, 'post', `/api/einsaetze/${demo.id}/fahrzeuge`, {
      adhoc: {
        funkrufname: 'Bereitschaft 12-1',
        fahrzeugtyp: 'GW-San',
        traegerorganisation: 'DRK Nachbarstadt',
      },
    });
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await page.getByRole('button', { name: 'Weitere Aktionen zu Bereitschaft 12-1' }).click();
    await page.getByRole('menuitem', { name: 'Angaben ändern …' }).click();
    const dialog = page
      .locator('.ant-modal')
      .filter({ hasText: 'Angaben zu Bereitschaft 12-1 ändern' });
    await expect(dialog.getByLabel('Funkrufname')).toHaveValue('Bereitschaft 12-1');
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'angaben-aendern');
  });

  test('Dialog „Als eigene Einheit führen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const fahrzeug = await fuelle<Fahrzeug>(page, 'post', `/api/einsaetze/${demo.id}/fahrzeuge`, {
      adhoc: {
        funkrufname: 'Nachbarstadt 44/1',
        fahrzeugtyp: 'HLF 20',
        traegerorganisation: 'FF Nachbarstadt',
      },
    });
    for (const name of ['Jonas Nachbar', 'Mia Nachbar']) {
      const kraft = await fuelle<Person>(page, 'post', `/api/einsaetze/${demo.id}/personal`, {
        adhoc: { name, traegerorganisation: 'FF Nachbarstadt' },
      });
      await fuelle(
        page,
        'put',
        `/api/einsaetze/${demo.id}/fahrzeuge/${fahrzeug.id}/besatzung/${kraft.id}`,
      );
    }
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await page.getByRole('button', { name: 'Weitere Aktionen zu Nachbarstadt 44/1' }).click();
    await page.getByRole('menuitem', { name: 'Als eigene Einheit führen …' }).click();
    const dialog = page
      .locator('.ant-modal')
      .filter({ hasText: 'Nachbarstadt 44/1 als eigene Einheit führen' });
    await expect(dialog.getByLabel('Name')).toHaveValue('Nachbarstadt 44/1');
    await expect(dialog.getByText('Besatzung: Jonas Nachbar, Mia Nachbar')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'eigene-einheit');
  });

  test('Dialog „Personal der Einheit übernehmen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await page.getByRole('button', { name: /^Besatzung zu .*83-2$/ }).click();
    await page.getByRole('button', { name: 'Personal der Einheit übernehmen' }).click();
    const dialog = page
      .locator('.ant-modal')
      .filter({ hasText: /Personal der Einheit auf .*83-2/ });
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(2);
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'personal-uebernehmen');
  });
});
