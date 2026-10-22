import type { Locator, Page } from '@playwright/test';
import {
  objektListe,
  objektZeile,
  oeffneObjektGruppe,
  oeffneZeichenWahl,
  waehleWerkzeug,
} from '../leisten-kern';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test } from './kern';
import { GRUNDKARTE, oeffneKarte } from './lagekarte-kern';

/**
 * Bilder des Kapitels „Lagekarte, Zeichnen und Messen“ (`docs/anwender/kapitel/lagekarte.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep lagekarte`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   lagekarte.png          frontend/src/pages/LagekartePage.tsx,
 *                          frontend/src/pages/lagekarte/Sidebar.tsx (Ansichten),
 *                          frontend/src/pages/lagekarte/Ebenenbaum.tsx,
 *                          frontend/src/pages/lagekarte/KartenUeberlagerung.tsx,
 *                          frontend/src/pages/lagekarte/markerLayer.ts (Raumzeichen, LLH-1107)
 *   objektliste.png        frontend/src/pages/lagekarte/MarkerSuche.tsx (Ansicht „Objekte“),
 *                          frontend/src/pages/lagekarte/objektsuche.ts
 *   taktisches-zeichen.png frontend/src/pages/lagekarte/ZeichenWahlDialog.tsx,
 *                          frontend/src/pages/lagekarte/FreiesZeichenPicker.tsx,
 *                          frontend/src/pages/lagekarte/zeichenWahl.ts
 *   zone-zeichnen.png      frontend/src/pages/lagekarte/ZeichnenSteuerung.tsx
 *   kreis-zeichnen.png     frontend/src/pages/lagekarte/KreisSteuerung.tsx,
 *                          frontend/src/pages/lagekarte/kreisVorschau.ts (Vorschau, Radius-Griff)
 *   messen.png             frontend/src/pages/lagekarte/MessSteuerung.tsx
 *   lageplan-anlage.png    frontend/src/pages/lagekarte/LageplanAnlageDialog.tsx
 *
 * Karte und Lage aus `lagekarte-kern.ts` (Fixture-Grundlage ohne Netz, Demo-Lage verortet).
 */

const KAPITEL = 'lagekarte';

/** Klickt relativ zur Kartenmitte; darunter liegt die Steuerung im Kartenfuß. */
async function tippe(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.click(x, y);
}

// Die Tests teilen sich die Datenbank des Laufs: was einer anlegt, steht in den Bildern der
// folgenden. Deshalb erst Überblick und Messen, das Anlegen am Schluss.
test.describe(KAPITEL, () => {
  test('Lagekarte des Demo-Einsatzes', async ({ page }) => {
    const canvas = await oeffneKarte(page);
    await expect(page.getByRole('group', { name: 'Kartensteuerung' })).toBeVisible();
    await fotografiere(page, KAPITEL, 'lagekarte');
    // Ablauf weiter: eine Ebene aus- und wieder einblenden, ein Objekt verorten.
    const zonen = page.getByRole('switch', { name: /^Zonen/ });
    await zonen.click();
    await expect(zonen).toHaveAttribute('aria-checked', 'false');
    await zonen.click();
    await expect(zonen).toHaveAttribute('aria-checked', 'true');
    // Die Objektliste: Marke „Nicht verortet“, Einsatzort, die Einheiten aufgeklappt.
    await oeffneObjektGruppe(page, 'einheit');
    await page.mouse.move(0, 0);
    await fotografiere(objektListe(page), KAPITEL, 'objektliste');
    // Suchen, dann „Platzieren“ in der Zeile.
    const zeile = await objektZeile(page, 'Turnhalle Musterstadt');
    await zeile.getByRole('button', { name: 'Platzieren' }).click();
    await tippe(page, canvas, 160, 120);
    await expect(page.getByText('Objekt verortet')).toBeVisible();
    // Die Kartengrundlage wechseln und zurück.
    const grundlage = page.getByRole('radiogroup', { name: 'Kartengrundlage' });
    await grundlage.getByRole('radio', { name: 'Ohne Karte' }).click();
    await expect(grundlage.getByRole('radio', { name: 'Ohne Karte' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await grundlage.getByRole('radio', { name: GRUNDKARTE.name }).click();
    await expect(grundlage.getByRole('radio', { name: GRUNDKARTE.name })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('Strecke messen', async ({ page }) => {
    const canvas = await oeffneKarte(page);
    await page.getByRole('button', { name: 'Messen' }).click();
    const wert = page.locator('[data-lfh="messwert"]');
    await expect(wert).toHaveText('—');
    await page.getByRole('radio', { name: 'Strecke' }).click();
    // Abseits der Marker: ein Tipp auf ein Punktziel setzt keinen Messpunkt (klickziel.ts).
    await tippe(page, canvas, -200, -140);
    await tippe(page, canvas, -20, -200);
    await tippe(page, canvas, 180, -220);
    await page.getByRole('button', { name: 'Abschließen' }).click();
    await expect(page.getByRole('button', { name: 'Neu messen' })).toBeVisible();
    await expect(wert).toHaveText(/^\d[\d.,]* (m|km)$/);
    await page.mouse.move(0, 0);
    await fotografiere(page.getByTestId('kartenflaeche'), KAPITEL, 'messen');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-lfh="mess-steuerung"]')).toHaveCount(0);
  });

  test('Taktisches Zeichen wählen', async ({ page }) => {
    // Der Dialog ist mit offener Zeichenwahl höher als der Fükw; so steht er ganz im Bild.
    await page.setViewportSize({ width: 1440, height: 1500 });
    const canvas = await oeffneKarte(page);
    const zeichnen = await oeffneZeichenWahl(page);
    const grundzeichen = zeichnen.getByRole('radiogroup', { name: 'Grundzeichen' });
    await grundzeichen.getByRole('radio', { name: 'Landfahrzeug', exact: true }).click();
    await expect(zeichnen.getByRole('button', { name: 'Platzieren' })).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(page.locator('.ant-modal'), KAPITEL, 'taktisches-zeichen');
    await zeichnen.getByRole('button', { name: 'Platzieren' }).click();
    await expect(zeichnen).toBeHidden();
    await tippe(page, canvas, 220, 40);
    await expect(page.getByText('Taktisches Zeichen angelegt')).toBeVisible();
    // „Weitere platzieren“ ist an: der Modus bleibt, bis „Fertig“ ihn beendet.
    // Die Bedienung des Modus steht im Modus-Band über den Ansichten.
    const band = page.locator('[data-modus-band="zeichen"]');
    await expect(band.getByText('1 platziert')).toBeVisible();
    await band.getByRole('button', { name: 'Fertig' }).click();
    await expect(band).toHaveCount(0);
  });

  test('Zone zeichnen', async ({ page }) => {
    const canvas = await oeffneKarte(page);
    await waehleWerkzeug(page, 'Gefahrengebiet');
    await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();
    await expect(canvas).toHaveCSS('cursor', 'crosshair');
    await tippe(page, canvas, -160, -160);
    await tippe(page, canvas, 40, -200);
    await tippe(page, canvas, 120, -60);
    await tippe(page, canvas, -100, -20);
    await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('4 Punkte');
    await fotografiere(page.getByTestId('kartenflaeche'), KAPITEL, 'zone-zeichnen');
    // Den letzten Punkt zurücknehmen und neu setzen.
    await page.getByRole('button', { name: 'Letzten Punkt zurück' }).click();
    await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('3 Punkte');
    await tippe(page, canvas, -100, -20);
    await expect(page.locator('[data-lfh="zeichnen-punkte"]')).toHaveText('4 Punkte');
    await page.getByRole('switch', { name: 'Weitere zeichnen' }).click();
    await page.getByRole('button', { name: 'Abschließen' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Zone angelegt')).toBeVisible();
  });

  test('Kreis zeichnen', async ({ page }) => {
    const canvas = await oeffneKarte(page);
    await waehleWerkzeug(page, 'Absperrbereich als Kreis');
    const band = page.locator('[data-lfh="kreis-steuerung"]');
    await expect(band).toBeVisible();
    // Die Mitte über der Kartenmitte, abseits der Marker; darunter liegt das Band.
    await tippe(page, canvas, -60, -190);
    await expect(band.locator('[data-lfh="kreis-mitte"]')).not.toContainText('—');
    await band.getByRole('button', { name: '300 m' }).click();
    await expect(band.getByRole('button', { name: '300 m' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-lfh="kreisgriff"]')).toHaveCount(1);
    await page.mouse.move(0, 0);
    await fotografiere(page.getByTestId('kartenflaeche'), KAPITEL, 'kreis-zeichnen');
    // Ablauf weiter: „Übernehmen“ legt an, „Fertig“ beendet die Serie.
    await band.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(band).toContainText('1 gespeichert');
    await band.getByRole('button', { name: /Fertig/ }).click();
    await expect(band).toHaveCount(0);
  });

  test('Lageplan als Anlage an einen offenen Entwurf', async ({ page }) => {
    // Die Demo gibt Lagebericht und Befehl frei; der Dialog bietet nur Entwürfe an. Je einer dazu.
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await fuelle(page, 'post', `/api/einsaetze/${demo.id}/lageberichte`, {
      vorlage: 'lagebericht',
      titel: 'Lage 1400',
    });
    await fuelle(page, 'post', `/api/einsaetze/${demo.id}/befehle`, {
      vorlage: 'befehl_lad',
      titel: 'Verlegung Behandlungsplatz',
    });
    await oeffneKarte(page);
    await page.getByRole('button', { name: 'Als Anlage an …', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Lageplan als Anlage' });
    const entwurf = dialog.getByRole('radio', { name: 'Lagebericht · Lage 1400' });
    await expect(
      dialog.getByRole('radio', { name: 'Befehl · Verlegung Behandlungsplatz' }),
    ).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Neuer Lagevortrag' })).toBeVisible();
    await entwurf.check();
    await page.mouse.move(0, 0);
    await fotografiere(page.locator('.ant-modal'), KAPITEL, 'lageplan-anlage');
    // Ablauf weiter: anfügen, die Karte bleibt offen.
    await dialog.getByRole('button', { name: 'Anfügen' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Lageplan an „Lagebericht · Lage 1400“ angefügt')).toBeVisible();
  });
});
