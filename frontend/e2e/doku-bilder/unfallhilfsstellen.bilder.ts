import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Unfallhilfsstellen“ (`docs/anwender/kapitel/unfallhilfsstellen.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep unfallhilfsstellen`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   grundriss.png         frontend/src/pages/uhs/UhsDetailPage.tsx, frontend/src/pages/uhs/Grundriss.tsx
 *   patient-zuweisen.png  frontend/src/pages/uhs/Grundriss.tsx
 *   anlegen.png           frontend/src/pages/uhs/UhsAnlegenDrawer.tsx
 *   liste.png             frontend/src/pages/UnfallhilfsstellenPage.tsx, frontend/src/components/KatalogTabelle.tsx
 *
 * Daten: die UHS Turnhalle des Demo-Einsatzes. Die Demo-Daten stellen alle Aufgenommenen in den
 * Wartebereich; zwei davon kommen per API auf Behandlungsplätze (D3), damit der Grundriss belegt ist.
 * Für die Liste kommen zwei weitere Stellen dazu (eine geplant, eine aktiv); der Test steht zuletzt,
 * damit die Bilder davor nur die Turnhalle sehen.
 */

const KAPITEL = 'unfallhilfsstellen';

interface UhsDetail {
  id: number;
  bezeichnung: string;
  plaetze: { id: number; bezeichnung: string }[];
}
interface Person {
  id: number;
  name: string | null;
  aktuelle_uhs_id: number | null;
  aktueller_platz_id: number | null;
  registrier_nr: number;
}

/** Die Demo-UHS mit ihren Plätzen; Behandlungsplatz 1 und 2 sind danach belegt. */
async function grundrissBelegen(page: Page, einsatzId: number): Promise<UhsDetail> {
  const liste = await (await page.request.get(`/api/einsaetze/${einsatzId}/uhs`)).json();
  const uhsId = (liste as { id: number; bezeichnung: string }[]).find((u) =>
    u.bezeichnung.includes('Turnhalle'),
  )!.id;
  const uhs = (await (
    await page.request.get(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`)
  ).json()) as UhsDetail;
  const personen = (await (
    await page.request.get(`/api/einsaetze/${einsatzId}/personen`)
  ).json()) as Person[];
  for (const [name, platzName] of [
    ['Mustermann', 'Behandlungsplatz 1'],
    ['Beispielmann', 'Behandlungsplatz 2'],
  ] as const) {
    const platz = uhs.plaetze.find((p) => p.bezeichnung === platzName)!;
    // Ein Lauf teilt die Datenbank über alle Tests: nur belegen, was noch frei ist.
    if (personen.some((p) => p.aktueller_platz_id === platz.id)) continue;
    const person = personen.find((p) => p.name === name && p.aktuelle_uhs_id === uhs.id);
    expect(person, `Demo-Person ${name} in der UHS`).toBeDefined();
    await fuelle(page, 'post', `/api/einsaetze/${einsatzId}/personen/${person!.id}/uhs-belegung`, {
      art: 'wechsel',
      uhs_id: uhs.id,
      platz_id: platz.id,
    });
  }
  return uhs;
}

/** Zwei Stellen neben der Turnhalle, damit die Liste Typ und Status unterscheidet; einmal je Lauf. */
async function weitereStellenAnlegen(page: Page, einsatzId: number): Promise<void> {
  const basis = `/api/einsaetze/${einsatzId}/uhs`;
  const vorhanden = (await (await page.request.get(basis)).json()) as { bezeichnung: string }[];
  if (vorhanden.some((u) => u.bezeichnung === 'Patientenablage Mühlbachweg')) return;
  await fuelle(page, 'post', basis, {
    typ: 'patientenablage',
    bezeichnung: 'Patientenablage Mühlbachweg',
    standort: 'Wendeplatz Mühlbachweg',
  });
  const vss = await fuelle<{ id: number }>(page, 'post', basis, {
    typ: 'verletztensammelstelle',
    bezeichnung: 'Verletztensammelstelle Bahnhof',
    standort: 'Bahnhofsvorplatz',
  });
  await fuelle(page, 'post', `${basis}/${vss.id}/status`, { status: 'aktiv' });
}

test.describe(KAPITEL, () => {
  test('Grundriss einer Unfallhilfsstelle mit belegten Plätzen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const uhs = await grundrissBelegen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/unfallhilfsstellen/${uhs.id}`);
    await expect(page.getByText('Behandlungsplatz 3', { exact: true })).toBeVisible();
    await expect(page.getByText('belegt').first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'grundriss');
  });

  test('Dialog „Patient zuweisen“ an einem freien Platz', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const uhs = await grundrissBelegen(page, demo.id);
    const personen = (await (
      await page.request.get(`/api/einsaetze/${demo.id}/personen`)
    ).json()) as Person[];
    const wartend = personen.find((p) => p.name === 'Musterfrau')!;
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/unfallhilfsstellen/${uhs.id}`);
    await page.getByText('Behandlungsplatz 3', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Patient zuweisen — Behandlungsplatz 3' });
    await dialog
      .getByRole('radio', {
        name: new RegExp(`R-${String(wartend.registrier_nr).padStart(3, '0')} · Musterfrau`),
      })
      .check();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'patient-zuweisen');
  });

  test('Drawer „Unfallhilfsstelle anlegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/unfallhilfsstellen/liste`);
    await expect(page.getByRole('cell', { name: /Turnhalle Musterstadt/ })).toBeVisible();
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Unfallhilfsstelle anlegen' });
    await drawer.getByLabel('Bezeichnung').fill('Patientenablage Mühlbachweg');
    await waehleIn(drawer.getByRole('combobox', { name: 'Typ' }), 'Patientenablage');
    await drawer.getByLabel('Standort (optional)').fill('Wendeplatz Mühlbachweg');
    await drawer.getByLabel('Standort (optional)').blur();
    await fotografiere(drawer, KAPITEL, 'anlegen');
  });

  test('Liste der Unfallhilfsstellen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await weitereStellenAnlegen(page, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/unfallhilfsstellen/liste`);
    const tabelle = page.locator('.ant-table-wrapper').first();
    await expect(tabelle.getByRole('cell', { name: /Turnhalle Musterstadt/ })).toBeVisible();
    await expect(tabelle.getByRole('cell', { name: /Patientenablage Mühlbachweg/ })).toBeVisible();
    await expect(
      tabelle.getByRole('cell', { name: /Verletztensammelstelle Bahnhof/ }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(tabelle, KAPITEL, 'liste');
  });
});
