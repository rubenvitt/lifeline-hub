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
 * Bilder des Kapitels „Lagebesprechung“ (`docs/anwender/kapitel/lagebesprechung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep lagebesprechung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   termin.png              frontend/src/lagebesprechung/TerminPaneel.tsx
 *   vorbereitung.png        frontend/src/lagebesprechung/VorbereitungPaneel.tsx
 *   lagebesprechung.png     frontend/src/lagebesprechung/LagebesprechungModal.tsx
 *
 * Füllung (D3): der Demo-Einsatz hat keine Lagebesprechung. Eine abgeschlossene Besprechung
 * entsteht nur, wenn noch keine da ist (ein Lauf aller Kapitel teilt eine Datenbank); den Termin
 * der nächsten setzt der Lauf jedes Mal neu ab jetzt, damit das Paneel „Termin“ einen kommenden
 * Termin zeigt und keinen überfälligen.
 */

const KAPITEL = 'lagebesprechung';

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    const { id } = await demoEinsatz(api);
    const stand = (await (await api.get(`/api/einsaetze/${id}/lagebesprechung`)).json()) as {
      anzahl_lagebesprechungen: number;
    };
    if (stand.anzahl_lagebesprechungen === 0) {
      await fuelle(api, 'post', `/api/einsaetze/${id}/lagebesprechungen`, {
        entschluss: 'Evakuierung Ortsteil Nord fortführen, UHS Turnhalle verstärken',
        abgehalten_at: new Date(Date.now() - 30 * 60_000).toISOString(),
        naechste_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
    }
    // Auf die Minute, damit das Bild „in 25 min“ zeigt und keinen Sekundenrest.
    const termin = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 25 * 60_000);
    await fuelle(api, 'put', `/api/einsaetze/${id}/lagebesprechung/termin`, {
      naechste_at: termin.toISOString(),
    });
    await api.dispose();
  });

  test('Paneel „Termin“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lagebesprechung`);
    const paneel = page.getByRole('region', { name: 'Termin', exact: true });
    await expect(paneel.getByText(/^in \d+ min$/)).toBeVisible();
    await expect(paneel.getByText('zuletzt Nr. 1')).toBeVisible();
    await expect(paneel.getByRole('button', { name: '+1 h' })).toBeEnabled();
    await fotografiere(paneel, KAPITEL, 'termin');
  });

  test('Paneel „Vorbereitung“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lagebesprechung`);
    const paneel = page.getByRole('region', { name: 'Vorbereitung', exact: true });
    await expect(paneel.getByText('Letzte Lagebesprechung')).toBeVisible();
    await expect(paneel.getByText('Nr. 1').first()).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'vorbereitung');
  });

  test('Dialog „Lagebesprechung abschließen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/lagebesprechung`);
    const kopfaktion = page.getByRole('button', { name: 'Lagebesprechung abschließen' });
    // Frei erst mit geladenem Stand (die Maske belegt den Termin daraus vor).
    await expect(kopfaktion).toBeEnabled();
    await kopfaktion.click();
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
});
