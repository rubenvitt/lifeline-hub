import { expect, test, type Page } from '@playwright/test';

/**
 * Korrigierbares Zeichnen und Eigenposition an der echten Karte. Vitest belegt Adapter und
 * Verdrahtung mit einem terra-draw-Mock; hier: dass `undoRedo.modeLevel` GENAU einen Punkt
 * zurücknimmt, dass terra-draw Escape nicht mehr selbst verwirft, und dass die Eigenposition
 * an einer echten MapLibre-Karte landet und einen Grundlagenwechsel übersteht.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  getStyle(): { sources?: Record<string, unknown> } | undefined;
  getCenter(): { lng: number; lat: number };
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Name ohne Modulnamen — die Kommandopalette sucht Module und Einsätze gemeinsam. */
async function lagekarteOeffnen(page: Page) {
  await anmelden(page);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(`E2E Korrektur ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const eid = Number(page.url().match(/\/einsaetze\/(\d+)/)![1]);
  await page.goto(`/einsaetze/${eid}/lagekarte`);
  const canvas = page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  return { eid, canvas };
}

test('Zeichnen: Punkt zurück nimmt genau einen Punkt, Esc ist zweistufig', async ({ page }) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));
  const { eid, canvas } = await lagekarteOeffnen(page);

  await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
  const zaehler = page.locator('[data-lfh="zeichnen-punkte"]');
  const zurueck = page.getByRole('button', { name: 'Letzten Punkt zurück' });
  await expect(zaehler).toHaveText('0 Punkte');
  await expect(zurueck).toBeDisabled();
  await expect(canvas).toHaveCSS('cursor', 'crosshair');

  // Alle Punkte ÜBER der Mitte: darunter liegt die Zeichnen-Steuerung im Kartenfuß.
  const box = (await canvas.boundingBox())!;
  const punkt = (dx: number, dy: number) => ({
    x: box.x + box.width / 2 + dx,
    y: box.y + box.height / 2 + dy,
  });
  const setze = async (dx: number, dy: number) => {
    const p = punkt(dx, dy);
    await page.mouse.click(p.x, p.y);
  };

  await setze(-120, -140);
  await setze(120, -140);
  await setze(120, -40);
  await expect(zaehler).toHaveText('3 Punkte');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeEnabled();

  await zurueck.click();
  await expect(zaehler).toHaveText('2 Punkte');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeDisabled();

  // Der Beleg an terra-draw selbst: neuer dritter Punkt, abschließen, speichern — die Fläche
  // hat drei Ecken. Hätte terra-draw nichts zurückgenommen, wären es vier.
  await setze(-120, -40);
  await expect(zaehler).toHaveText('3 Punkte');
  await page.getByRole('button', { name: 'Abschließen' }).click();
  const anfrage = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith(`/api/einsaetze/${eid}/zonen`),
  );
  await page.getByRole('button', { name: 'Speichern' }).click();
  const body = (await anfrage).postDataJSON() as { geometrie: string };
  const ring = (JSON.parse(body.geometrie) as { coordinates: number[][][] }).coordinates[0];
  expect(ring).toHaveLength(4);

  // Serie steht per Vorgabe an: es geht direkt mit der nächsten Figur weiter.
  await expect(page.getByText('1 gespeichert')).toBeVisible();
  await setze(-60, -140);
  await setze(60, -140);
  await expect(zaehler).toHaveText('2 Punkte');

  // Erste Stufe — mit dem Fokus auf einem Knopf der Steuerung, nicht auf dem Canvas, wo
  // terra-draws eigenes Esc die Taste nie gesehen hätte.
  await zurueck.focus();
  await page.keyboard.press('Escape');
  await expect(zaehler).toHaveText('0 Punkte');
  await expect(page.locator('.ant-message')).toContainText('Zeichnung verworfen');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();

  // Nach dem Verwerfen zeichnet der Modus weiter.
  await setze(-60, -100);
  await expect(zaehler).toHaveText('1 Punkt');

  // Esc mit dem Fokus auf der Karte: auch hier genau EINE Stufe. Dass terra-draw die Taste
  // abgegeben hat (`cancel: null`), belegt dieser Schritt nicht — das pinnt `zeichnen.test.ts`.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(zaehler).toHaveText('0 Punkte');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeVisible();

  // Zweite Stufe: ohne Figur endet das Zeichnen (in der Serie wie „Fertig").
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Abschließen' })).toBeHidden();

  expect(seitenFehler.map((f) => f.message)).toEqual([]);
});

test.describe('Eigenposition', () => {
  const POSITION = { latitude: 52.3759, longitude: 9.732, accuracy: 35 };
  test.use({ geolocation: POSITION, permissions: ['geolocation'] });

  test('zeigt den eigenen Standort, fliegt einmal hin und schickt ihn nirgends hin', async ({
    page,
  }) => {
    const seitenFehler: Error[] = [];
    page.on('pageerror', (f) => seitenFehler.push(f));
    const anfragen: string[] = [];
    page.on('request', (r) => anfragen.push(`${r.url()} ${r.postData() ?? ''}`));
    await lagekarteOeffnen(page);

    const quelleDa = () =>
      page.evaluate(() => {
        const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
        return Boolean(map?.getStyle()?.sources?.['eigenposition']);
      });
    const mitte = () =>
      page.evaluate(() => {
        const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte!;
        return map.getCenter();
      });

    // Vor dem Einschalten legt die Karte keine Ebene an.
    expect(await quelleDa()).toBe(false);

    // localhost ist ein sicherer Kontext: der Knopf steht frei.
    const knopf = page.getByRole('button', { name: 'Eigenposition' });
    await expect(knopf).not.toHaveAttribute('aria-disabled', 'true');
    await knopf.click();
    await expect(knopf).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(quelleDa, { timeout: 10_000 }).toBe(true);
    await expect
      .poll(
        async () => {
          const m = await mitte();
          return (
            Math.abs(m.lng - POSITION.longitude) < 0.01 &&
            Math.abs(m.lat - POSITION.latitude) < 0.01
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    // Grundlagenwechsel (`setStyle` mit `diff: false`) wirft eigene Quellen weg — die
    // Eigenposition muss danach wieder stehen. Grenze: „Hell" ändert auch die Bedienfarbe, dann
    // legt schon der Farb-Effekt die Ebene neu an; welcher Weg sie zurückholt, trennt der
    // Schritt nicht.
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    await page.getByRole('menuitem', { name: /Hell/ }).click();
    await expect.poll(quelleDa, { timeout: 10_000 }).toBe(true);

    // Nichts davon ging an den Server.
    const breite = String(POSITION.latitude);
    const laenge = String(POSITION.longitude);
    expect(anfragen.filter((a) => a.includes(breite) || a.includes(laenge))).toEqual([]);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(breite);

    // Ausschalten räumt den Punkt: die Quelle bleibt, ist aber leer.
    await knopf.click();
    await expect(knopf).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte!;
          const q = map.getStyle()?.sources?.['eigenposition'] as
            { data?: { features?: unknown[] } } | undefined;
          return q?.data?.features?.length ?? -1;
        }),
      )
      .toBe(0);

    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  });
});
