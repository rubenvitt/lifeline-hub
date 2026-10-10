import type { Locator, Page } from '@playwright/test';
import {
  kachelnBeantworten,
  kartenConfigBeantworten,
  vektorStilBeantworten,
} from '../kartenFixture';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Lagekarte, Zeichnen und Messen“ (`docs/anwender/kapitel/lagekarte.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep lagekarte`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   lagekarte.png          frontend/src/pages/LagekartePage.tsx,
 *                          frontend/src/pages/lagekarte/Sidebar.tsx,
 *                          frontend/src/pages/lagekarte/KartenUeberlagerung.tsx
 *   taktisches-zeichen.png frontend/src/pages/lagekarte/Sidebar.tsx (Paneel „Zeichnen“),
 *                          frontend/src/pages/lagekarte/FreiesZeichenPicker.tsx
 *   zone-zeichnen.png      frontend/src/pages/lagekarte/ZeichnenSteuerung.tsx
 *   messen.png             frontend/src/pages/lagekarte/MessSteuerung.tsx
 *
 * Kartengrundlage aus `e2e/kartenFixture.ts` (kein Netz): eine Vektorkarte mit grauem Grund und
 * einer Linie je Kachel. Die Lageobjekte darauf sind die des Demo-Einsatzes; die Demo verortet nur
 * Zonen und die Betreuungsstelle, der Lauf setzt den Einsatzort und vier Einheiten dazu
 * (Koordinaten im Gebiet des Szenarios, `src/demo/szenario.rs`).
 */

const KAPITEL = 'lagekarte';
const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';
const KACHEL_LAYER = 'strassen';
const GRUNDKARTE = { name: 'Grundkarte', stil: '/api/karte/proxy/9/a/style.json', quelle: 'grund' };

/** Einheiten des Demo-Szenarios und ihr Ort (lon, lat) für das Bild. */
const EINHEITEN_ORT: Record<string, [number, number]> = {
  'Sanitätszug Musterstadt': [10.2478, 50.9562],
  Rettungsstaffel: [10.2512, 50.9546],
  Betreuungsgruppe: [10.2593, 50.9592],
  Logistiktrupp: [10.2546, 50.9581],
};

/** Verortet Einsatzort und Einheiten über die API, wie es „Platzieren“ täte. */
async function lageVerorten(page: Page, einsatzId: number) {
  await fuelle(page, 'patch', `/api/einsaetze/${einsatzId}`, {
    einsatzort_lat: 50.9571,
    einsatzort_lon: 10.2525,
  });
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/einheiten`);
  expect(antwort.ok()).toBe(true);
  const einheiten = (await antwort.json()) as { id: number; name: string }[];
  for (const [name, [lon, lat]] of Object.entries(EINHEITEN_ORT)) {
    const einheit = einheiten.find((e) => e.name === name);
    expect(einheit, `Demo-Einheit „${name}“ fehlt`).toBeTruthy();
    await fuelle(page, 'patch', `/api/einsaetze/${einsatzId}/einheiten/${einheit!.id}/position`, {
      lat,
      lon,
    });
  }
}

/** Öffnet die Lagekarte des Demo-Einsatzes auf der Fixture-Grundlage und wartet auf den Stil. */
async function oeffneKarte(page: Page): Promise<Locator> {
  await kartenConfigBeantworten(page, {
    online_styles: [{ name: GRUNDKARTE.name, typ: 'vektor', url: GRUNDKARTE.stil }],
  });
  await vektorStilBeantworten(page, GRUNDKARTE.stil, {
    id: GRUNDKARTE.quelle,
    kachelVorlage: `${KACHEL_PRAEFIX}{z}/{x}/{y}.pbf`,
    layer: KACHEL_LAYER,
  });
  await kachelnBeantworten(page, KACHEL_PRAEFIX, KACHEL_LAYER);
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await lageVerorten(page, demo.id);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/lagekarte`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __lfhKarte?: { isStyleLoaded(): boolean } }
          ).__lfhKarte?.isStyleLoaded() ?? false,
      ),
    )
    .toBe(true);
  return canvas;
}

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
    await page
      .getByRole('listitem')
      .filter({ hasText: 'UHS: Turnhalle Musterstadt' })
      .getByRole('button', { name: 'Platzieren' })
      .click();
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
    // Das Paneel ist mit offener Zeichenwahl höher als der Fükw; so steht es ganz im Bild.
    await page.setViewportSize({ width: 1440, height: 1500 });
    const canvas = await oeffneKarte(page);
    const zeichnen = page.locator('section[data-paneel="zeichnen"]');
    await zeichnen.getByRole('button', { name: 'Taktisches Zeichen platzieren' }).click();
    const grundzeichen = zeichnen.getByRole('radiogroup', { name: 'Grundzeichen' });
    await grundzeichen.getByRole('radio', { name: 'Fahrzeug', exact: true }).click();
    await expect(zeichnen.getByRole('button', { name: 'Platzieren' })).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(zeichnen, KAPITEL, 'taktisches-zeichen');
    await zeichnen.getByRole('button', { name: 'Platzieren' }).click();
    await tippe(page, canvas, 220, 40);
    await expect(page.getByText('Taktisches Zeichen angelegt')).toBeVisible();
    // „Weitere platzieren“ ist an: der Modus bleibt, bis „Fertig“ ihn beendet.
    await expect(zeichnen.getByText('1 platziert')).toBeVisible();
    await zeichnen.getByRole('button', { name: 'Fertig' }).click();
    await expect(
      zeichnen.getByRole('button', { name: 'Taktisches Zeichen platzieren' }),
    ).toBeVisible();
  });

  test('Zone zeichnen', async ({ page }) => {
    const canvas = await oeffneKarte(page);
    await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
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
});
