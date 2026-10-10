import type { Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
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
 * Bilder des Kapitels „Stab, Checkliste und Lagebesprechung“ (`docs/anwender/kapitel/stab.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep stab`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   besetzung.png           frontend/src/stab/BesetzungModal.tsx
 *   vorbereitung.png        frontend/src/stab/VorbereitungPaneel.tsx
 *   lagebesprechung.png     frontend/src/stab/LagebesprechungModal.tsx
 *   arbeitsaufnahme.png     frontend/src/stab/ChecklistePaneel.tsx
 *
 * Füllung (D3): der Demo-Einsatz hat keinen Stab. Vier Sachgebiete werden besetzt, drei Punkte
 * der Arbeitsaufnahme abgehakt und eine Lagebesprechung abgeschlossen, jeweils nur, wenn es noch
 * fehlt (ein Lauf aller Kapitel teilt eine Datenbank; die Besetzung setzt der Server
 * idempotent).
 */

const KAPITEL = 'stab';

/**
 * Meldet der Seite die Benachrichtigungs-Freigabe als erteilt. Der kopflose Chromium sagt sonst
 * „denied“ (auch mit `permissions: ['notifications']`), und die Kopfleiste zeigte „Benachrichtigung
 * blockiert“ — ein Zustand des Bildlaufs, nicht der Arbeitsplätze, die das Bild zeigen soll.
 */
async function benachrichtigungErlaubt(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    }
  });
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    const { id } = await demoEinsatz(api);
    const personal = (await (await api.get(`/api/einsaetze/${id}/personal`)).json()) as {
      id: number;
      name: string;
    }[];
    const person = (name: string) => {
      const p = personal.find((x) => x.name.includes(name));
      expect(p, `Demo-Personal „${name}“`).toBeDefined();
      return p!.id;
    };
    const stab = `/api/einsaetze/${id}/stab`;
    await fuelle(api, 'put', `${stab}/besetzung/s1`, {
      besetzung_art: 'personal',
      personal_id: person('Lena Beispiel'),
    });
    await fuelle(api, 'put', `${stab}/besetzung/s2`, {
      besetzung_art: 'personal',
      personal_id: person('Max Mustermann'),
    });
    await fuelle(api, 'put', `${stab}/besetzung/s3`, { besetzung_art: 'einsatzleitung' });
    await fuelle(api, 'put', `${stab}/besetzung/s6`, {
      besetzung_art: 'rueckwaertig',
      bezeichnung: 'Integrierte Leitstelle Musterstadt',
    });
    for (const punkt of ['aufstellort', 'einweisung', 'etb_eroeffnet']) {
      await fuelle(api, 'put', `${stab}/checkliste/${punkt}`, { erledigt: true });
    }
    await fuelle(api, 'put', `${stab}/checkliste/aufstellort`, {
      bemerkung: 'Parkplatz Feuerwehrhaus Nord',
    });
    const stand = (await (await api.get(stab)).json()) as { anzahl_lagebesprechungen: number };
    if (stand.anzahl_lagebesprechungen === 0) {
      await fuelle(api, 'post', `${stab}/lagebesprechungen`, {
        entschluss: 'Evakuierung Ortsteil Nord fortführen, UHS Turnhalle verstärken',
        abgehalten_at: new Date(Date.now() - 30 * 60_000).toISOString(),
        naechste_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
    }
    await api.dispose();
  });

  test('Dialog „Besetzung S4 · …“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab`);
    await page.getByRole('button', { name: /^Besetzung ändern – S4 / }).click();
    const dialog = page.getByRole('dialog', { name: /^Besetzung S4 · / });
    await waehleIn(dialog.getByRole('combobox', { name: 'Besetzung' }), 'disponierte Person');
    // Die Option trägt Name und Funktion, wie sie das Personal im Einsatz führt.
    const jonas = (
      (await (await page.request.get(`/api/einsaetze/${demo.id}/personal`)).json()) as {
        name: string;
        funktion: string | null;
      }[]
    ).find((p) => p.name === 'Jonas Beispiel');
    expect(jonas, 'Demo-Personal „Jonas Beispiel“').toBeDefined();
    const option = jonas!.funktion ? `${jonas!.name} · ${jonas!.funktion}` : jonas!.name;
    await waehleIn(dialog.getByRole('combobox', { name: 'Person' }), option);
    await dialog.getByRole('combobox', { name: 'Person' }).blur();
    await page.mouse.move(0, 0);
    await expect(dialog.getByRole('button', { name: 'Übernehmen' })).toBeVisible();
    await fotografiere(dialog, KAPITEL, 'besetzung');
  });

  test('Paneel „Vorbereitung“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab`);
    const paneel = page.getByRole('region', { name: 'Vorbereitung' });
    await expect(paneel.getByText('Letzte Lagebesprechung')).toBeVisible();
    await expect(paneel.getByText('Nr. 1').first()).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'vorbereitung');
  });

  test('Dialog „Lagebesprechung abschließen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await benachrichtigungErlaubt(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab`);
    await expect(page.getByRole('region', { name: 'Lagebesprechung' })).toBeVisible();
    await page.getByRole('button', { name: 'Lagebesprechung abschließen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lagebesprechung abschließen' });
    await dialog
      .getByLabel('Entschluss')
      .fill('Lage unverändert, Sandsackverbau am Nordufer bis 18 Uhr abschließen');
    const schnellwahl = dialog.getByRole('button', { name: '+1 h' });
    await schnellwahl.click();
    // Fokus und Zeiger stünden sonst auf der Schnellwahl (hervorgehoben im Bild).
    await schnellwahl.blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'lagebesprechung');
  });

  test('Paneel „Arbeitsaufnahme“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab`);
    const paneel = page.getByRole('region', { name: 'Arbeitsaufnahme' });
    await expect(paneel.getByText('Parkplatz Feuerwehrhaus Nord')).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'arbeitsaufnahme');
  });
});
