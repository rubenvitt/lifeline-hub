import { expect, test, type Page } from '@playwright/test';
import { ohneWebgl2 } from './kartenFixture';
import { anmeldenOhneStartseite, grundlageOhneNetz, ORT } from './lageplan-kern';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/**
 * Lagemonitor auf einem Gerät ohne WebGL2 (LLH-1377, Nachzug zu LLH-1353 und LLH-1370):
 * `geraet/LagemonitorKarte.tsx` baut eine eigene maplibre-Karte. Statt der Fehlerseite der App steht
 * in der Kachel „Lagekarte“ „Karte auf diesem Gerät nicht darstellbar“ (in Großbild-Schrift), die
 * übrigen Kacheln und die Statusleiste bleiben.
 *
 * Chromium per Init-Skript (`ohneWebgl2`), Firefox headless ohne Nachbau (`OHNE_WEBGL_SPECS`).
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext wie
 * `geraet-lagemonitor.spec.ts`. Kein `networkidle` (LFH-385).
 *
 * Beleg vor dem Fix und Mutationsprobe: ohne `wennDarstellbar` in `LagemonitorKarte.tsx` zeigt der
 * Monitor nach „Anzeige starten“ „Unexpected Application Error!“, rot.
 */

const ZUSTAND = 'Karte auf diesem Gerät nicht darstellbar';

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

test('ohne WebGL2: Kachel Lagekarte zeigt den Zustand, die übrigen Kacheln bleiben', async ({
  page,
  browser,
}) => {
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  const { id: e } = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Monitor ohne Grafik ${Date.now()}`,
  });
  // Ein verorteter Einsatzort: ohne Punkt baute der Monitor gar keine Karte („Kein Einsatzort
  // verortet“), und der Fall prüfte nichts.
  const ort = await page.request.patch(`/api/einsaetze/${e}`, {
    data: { einsatzort: 'Bahnhofstraße 1', einsatzort_lat: ORT.lat, einsatzort_lon: ORT.lon },
  });
  expect(ort.ok(), `Einsatzort: ${ort.status()}`).toBe(true);
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  await anlegen(page, `/api/einsaetze/${e}/uhs/${nord.id}/status`, { status: 'aktiv' });
  for (const name of ['Erste', 'Zweite', 'Dritte']) {
    await anlegen(page, `/api/einsaetze/${e}/personen`, { name, uhs_id: nord.id });
  }
  const kopplung = await anlegen<{ code: { code: string } }>(page, `/api/einsaetze/${e}/geraete`, {
    ansicht: 'lagemonitor',
    bezeichnung: 'Monitor ohne Grafik',
  });

  const kontext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const monitor = await kontext.newPage();
  const seitenFehler: Error[] = [];
  monitor.on('pageerror', (f) => seitenFehler.push(f));
  await ohneWebgl2(monitor);
  await grundlageOhneNetz(monitor);
  try {
    await monitor.goto(`/koppeln#${kopplung.code.code}`);
    // Vorbedingung: das Gerät hat wirklich kein WebGL2 (Nachbau in Chromium, Firefox selbst).
    expect(
      await monitor.evaluate(() => document.createElement('canvas').getContext('webgl2') === null),
    ).toBe(true);
    await monitor.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(monitor).toHaveURL(new RegExp(`/geraet/${e}/monitor$`));

    // Die Kachel „Lagekarte“ trägt den Zustand statt der Karte, schon unter „Anzeige starten“:
    // die Karte entsteht, sobald Einsatzort und Kartengrundlage da sind. Ohne Fang stünde hier
    // die Fehlerseite der App, und „Anzeige starten“ gäbe es nicht mehr.
    const kachel = monitor.getByRole('region', { name: 'Lagekarte' });
    const zustand = kachel.locator('[data-lfh="karte-nicht-darstellbar"]');
    await expect(zustand).toHaveText(ZUSTAND);
    await expect(monitor.getByText('Unexpected Application Error')).toHaveCount(0);
    await monitor.getByRole('button', { name: 'Anzeige starten' }).click();
    await expect(monitor.getByRole('button', { name: 'Anzeige starten' })).toHaveCount(0);
    await expect(kachel.getByRole('img', { name: 'Lagekarte des Einsatzgebiets' })).toHaveCount(0);
    await expect(kachel.locator('canvas')).toHaveCount(0);
    expect(
      await zustand.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(28);
    await expect(kachel).toBeInViewport({ ratio: 1 });

    // Der Rest des Monitors bleibt: Zahlen, Belegung, Meldungen, Statusleiste.
    const belegung = monitor.getByRole('region', { name: 'Belegung der Unfallhilfsstellen' });
    const erste = belegung.locator('[data-lfh="monitor-uhs"]').first();
    await expect(erste).toContainText('UHS Nord');
    await expect(erste.locator('span').first()).toHaveText('3');
    for (const name of ['Betroffene', 'Kräfte', 'Meldungen']) {
      await expect(monitor.getByRole('region', { name })).toBeInViewport({ ratio: 1 });
    }
    await expect(monitor.locator('[data-lfh="monitor-statusleiste"]')).toContainText(
      'Monitor ohne Grafik',
    );

    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  } finally {
    await kontext.close();
  }
});
