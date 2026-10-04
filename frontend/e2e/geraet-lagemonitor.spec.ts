import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Lagemonitor (LFH-892, Subtask LFH-1026; Spec `lagemonitor`): ein Großbild bei 1920 × 1080 zeigt
 * alle Kacheln ohne Bildlauf, die Belegung der UHS als Zahl, Kennzahlen ab 72 px und Text ab
 * 28 px, eine Karte ohne Bedienung, und endet beim Widerruf mit „Kopplung beendet“.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext. Kein `networkidle`
 * (LFH-385).
 *
 * Mutationsprobe: in `LagemonitorPage` die Zeilenhöhe `minmax(0, 1fr)` durch `auto` ersetzt und
 * alle elf UHS gezeigt (`UHS_SICHTBAR`), dazu die Zeile „+5 weitere“ gestrichen → die
 * Belegungskachel schneidet ab, und „keine Kachel schneidet ihren Inhalt ab“ wird rot.
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

test('LFH-1026: Lagemonitor zeigt das Lagebild ohne Bildlauf und endet beim Widerruf', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Monitor ${Date.now()}`,
  });
  const e = einsatz.id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  await anlegen(page, `/api/einsaetze/${e}/uhs/${nord.id}/status`, { status: 'aktiv' });
  const verortet = await page.request.patch(`/api/einsaetze/${e}/uhs/${nord.id}`, {
    data: { lat: 52.52, lon: 13.405 },
  });
  expect(verortet.ok(), await verortet.text()).toBeTruthy();
  // „A …“ steht als zweite UHS sichtbar und ist zu lang für eine Zeile: der Name bricht um.
  const langerName = 'UHS A Sportplatz am Nordufer der Spree Ostseite';
  for (const b of [langerName.slice(4), 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
    await anlegen(page, `/api/einsaetze/${e}/uhs`, { typ: 'sonstige', bezeichnung: `UHS ${b}` });
  }
  for (const name of ['Erste', 'Zweite', 'Dritte']) {
    await anlegen(page, `/api/einsaetze/${e}/personen`, { name, uhs_id: nord.id });
  }
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'lagemonitor', bezeichnung: 'Monitor Stab' },
  );

  const kontext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const monitor = await kontext.newPage();
  try {
    await monitor.goto(`/koppeln#${kopplung.code.code}`);
    await monitor.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(monitor).toHaveURL(new RegExp(`/geraet/${e}/monitor$`));
    await monitor.getByRole('button', { name: 'Anzeige starten' }).click();

    // Belegung der UHS Nord als Zahl; keine Namen der Betroffenen.
    const belegung = monitor.getByRole('region', { name: 'Belegung der Unfallhilfsstellen' });
    // Die vollste UHS steht vorn; zehn leere passen nicht alle hinein.
    const erste = belegung.locator('[data-lfh="monitor-uhs"]').first();
    await expect(erste).toContainText('UHS Nord');
    await expect(erste.locator('span').first()).toHaveText('3');
    await expect(belegung.getByText('+5 weitere')).toBeVisible();
    // Der lange Name reißt nicht nach einer Zeile ab: er bricht um und zeigt zwei Zeilen.
    const lang = belegung.getByText(langerName);
    await expect(lang).toBeVisible();
    const zeilen = await lang.evaluate(
      (el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight),
    );
    expect(Math.round(zeilen)).toBe(2);
    await expect(monitor.getByText('Erste')).toHaveCount(0);
    const betroffene = monitor.getByRole('region', { name: 'Betroffene' });
    await expect(betroffene.getByText('gesamt')).toBeVisible();

    // Kein Bildlauf: alles passt in 1920 × 1080.
    const masse = await monitor.evaluate(() => ({
      hoehe: document.documentElement.scrollHeight,
      breite: document.documentElement.scrollWidth,
    }));
    expect(masse.hoehe).toBeLessThanOrEqual(1080);
    expect(masse.breite).toBeLessThanOrEqual(1920);
    for (const kachel of ['Betroffene', 'Kräfte', 'Belegung der Unfallhilfsstellen', 'Lagekarte']) {
      await expect(monitor.getByRole('region', { name: kachel })).toBeInViewport({ ratio: 1 });
    }
    // … und keine Kachel schneidet ihren Inhalt ab (sie läuft nicht still in sich über).
    const abgeschnitten = await monitor
      .locator('main section')
      .evaluateAll((kacheln) =>
        kacheln
          .filter((k) => k.scrollHeight > k.clientHeight + 1)
          .map((k) => k.getAttribute('aria-label')),
      );
    expect(abgeschnitten).toEqual([]);

    // Großbild-Größen: Kennzahlen ab 72 px, Text ab 28 px.
    const groessen = await monitor
      .locator('[data-lfh="monitor-zahl"]')
      .evaluateAll((zellen) =>
        zellen.map((z) => [
          parseFloat(getComputedStyle(z.children[0]).fontSize),
          parseFloat(getComputedStyle(z.children[1]).fontSize),
        ]),
      );
    expect(groessen.length).toBeGreaterThan(5);
    for (const [zahl, text] of groessen) {
      expect(zahl).toBeGreaterThanOrEqual(72);
      expect(text).toBeGreaterThanOrEqual(28);
    }

    // Die Karte steht: MapLibre zeichnet in eine Leinwand, die UHS trägt ihre Belegung.
    const karte = monitor.locator('[data-lfh="lagemonitor-karte"]');
    await expect(karte.locator('canvas')).toBeVisible();
    await expect(karte.getByText('UHS Nord · 3')).toBeVisible();

    // Tippen und Ziehen auf die Kacheln ändert nichts.
    const vorher = await belegung.textContent();
    await belegung.click({ force: true });
    await monitor.mouse.move(400, 400);
    await monitor.mouse.down();
    await monitor.mouse.move(700, 600, { steps: 5 });
    await monitor.mouse.up();
    await expect(monitor).toHaveURL(new RegExp(`/geraet/${e}/monitor$`));
    expect(await belegung.textContent()).toBe(vorher);
    await expect(monitor.getByRole('dialog', { name: 'Gerätemenü' })).toHaveCount(0);

    // Widerruf: „Kopplung beendet“ ohne Lagebild, ohne Neuladen.
    await anlegen(page, `/api/einsaetze/${e}/geraete/${kopplung.kopplung.id}/widerrufen`);
    await expect(monitor).toHaveURL(/\/kopplung-beendet$/);
    await expect(monitor.getByRole('heading', { name: 'Kopplung beendet' })).toBeVisible();
    await expect(monitor.getByText('UHS Nord')).toHaveCount(0);
  } finally {
    await kontext.close();
  }
});
