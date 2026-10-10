import type { APIRequestContext } from '@playwright/test';
import {
  apiAlsAdmin,
  anmelden,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Einsatzdaten und Führungsstelle“ (`docs/anwender/kapitel/einsatzdaten.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep einsatzdaten`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   einsatzdaten.png          frontend/src/pages/EinsatzdatenPage.tsx
 *   fuehrungsstelle.png       frontend/src/pages/EinsatzdatenPage.tsx (FuehrungsstellePaneel)
 *   mitglied-stelle.png       frontend/src/pages/MitgliederAbschnitt.tsx (FuehrungsstelleModal)
 *
 * Füllung (D3): der Demo-Einsatz trägt nur Bezeichnung, Stichwort, Art und Alarmzeit. Einsatzort,
 * Koordinate, Lagedaten, die eigene Führungsstelle samt zwei einsatzlokalen Sprechgruppen und die
 * Führungsstelle der Einsatzleitung kommen über die API, jeweils nur, wenn sie noch fehlen (ein
 * Lauf aller Kapitel teilt eine Datenbank).
 */

const KAPITEL = 'einsatzdaten';

interface Sprechgruppe {
  id: number;
  bezeichnung: string;
  betriebsart: 'TMO' | 'DMO';
}

/** Einsatzlokale Sprechgruppe, angelegt nur, wenn es sie im Einsatz noch nicht gibt. */
async function sprechgruppe(
  api: APIRequestContext,
  einsatzId: number,
  bezeichnung: string,
  betriebsart: 'TMO' | 'DMO',
): Promise<Sprechgruppe> {
  const liste = await api.get(`/api/einsaetze/${einsatzId}/sprechgruppen`);
  expect(liste.ok(), `Sprechgruppen: ${liste.status()}`).toBe(true);
  const vorhanden = ((await liste.json()) as Sprechgruppe[]).find(
    (s) => s.bezeichnung === bezeichnung,
  );
  return (
    vorhanden ??
    fuelle<Sprechgruppe>(api, 'post', `/api/einsaetze/${einsatzId}/sprechgruppen`, {
      bezeichnung,
      betriebsart,
    })
  );
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    const demo = await demoEinsatz(api);
    const id = demo.id;
    const einsatz = await (await api.get(`/api/einsaetze/${id}`)).json();
    if (!einsatz.einsatzort) {
      await fuelle(api, 'patch', `/api/einsaetze/${id}`, {
        einsatzort: 'Musterstadt, Mühlbachstraße 12',
        einsatzort_lat: 50.9525,
        einsatzort_lon: 10.2465,
        meldende_stelle: 'Integrierte Leitstelle Musterstadt',
        sachverhalt:
          'Starkregen seit dem Morgen, Mühlbach über die Ufer getreten. Keller und Straßen im ' +
          'Ortsteil Nord überflutet, Evakuierung einzelner Straßenzüge.',
        anzahl_betroffene_initial: 40,
        naechste_lagebesprechung_at: new Date(Date.now() + 45 * 60_000).toISOString(),
      });
    }
    const sg1 = await sprechgruppe(api, id, 'TMO 311_F_EL', 'TMO');
    const sg2 = await sprechgruppe(api, id, 'DMO 505', 'DMO');
    const fs = await (await api.get(`/api/einsaetze/${id}/fuehrungsstelle`)).json();
    if (!fs.rufname) {
      const fahrzeuge = (await (await api.get(`/api/einsaetze/${id}/fahrzeuge`)).json()) as {
        id: number;
        funkrufname: string;
      }[];
      const elw = fahrzeuge.find((f) => f.funkrufname === 'Musterstadt 11-1') ?? fahrzeuge[0];
      await fuelle(api, 'patch', `/api/einsaetze/${id}/fuehrungsstelle`, {
        rufname: 'Florian Musterstadt 11-1',
        kommunikationsmittel: 'digitalfunk',
        erreichbarkeit: '0561 123 4567',
        sprechgruppe_ids: [sg1.id, sg2.id],
        fahrzeug_ids: elw ? [elw.id] : [],
      });
    }
    await api.dispose();
  });

  test('Einsatzdaten mit Kopfleiste und Lagedaten', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    const ortVorschau = page.waitForResponse((r) => r.url().includes('/ort-vorschau'));
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
    await expect(page.getByRole('region', { name: 'Lagedaten' })).toBeVisible();
    await ortVorschau;
    await expect(page.getByText('Integrierte Leitstelle Musterstadt')).toBeVisible();
    // Die Ortszeile unter der Koordinate fragt den Server; ohne Netz bleibt sie leer.
    await expect(page.getByText('Ort wird ermittelt …')).toHaveCount(0);
    await fotografiere(page, KAPITEL, 'einsatzdaten');
  });

  test('Paneel „Eigene Führungsstelle“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
    const paneel = page.getByRole('region', { name: 'Eigene Führungsstelle' });
    await expect(paneel.getByText('Florian Musterstadt 11-1')).toBeVisible();
    await expect(paneel.getByText('Musterstadt 11-1', { exact: false }).last()).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'fuehrungsstelle');
  });

  test('Dialog „Führungsstelle für …“ eines Mitglieds', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const mitglieder = (await (
      await page.request.get(`/api/einsaetze/${demo.id}/mitglieder`)
    ).json()) as { benutzer_id: number; einsatz_rolle: string; fuehrungsfunktion: string | null }[];
    const leitung = mitglieder.find((m) => m.einsatz_rolle === 'einsatzleitung');
    expect(leitung, 'der Demo-Einsatz hat eine Einsatzleitung').toBeDefined();
    if (!leitung!.fuehrungsfunktion) {
      await fuelle(page, 'put', `/api/einsaetze/${demo.id}/mitglieder/${leitung!.benutzer_id}`, {
        einsatz_rolle: 'einsatzleitung',
        fuehrungsfunktion: 'el',
        fuehrungsstelle: null,
      });
    }
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einsatzdaten`);
    await page.getByRole('button', { name: /^Führungsstelle für .+ bearbeiten$/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Führungsstelle für / });
    await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeVisible();
    // Der Fokus stünde sonst im Feld (Fokusring und Cursor im Bild).
    await dialog.getByRole('combobox', { name: 'Führungsstelle' }).blur();
    await fotografiere(dialog, KAPITEL, 'mitglied-stelle');
  });
});
