import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Modulnamen (LFH-965, Spec `modul-benennung`): ein Name je Modul, die Kurzbeschreibung als
 * zweite Zeile im Modulmenü und in der Sprungpalette. Als Beobachter (`e2e/AGENTS.md`, LFH-435):
 * die Beschreibung hängt an keiner Schreibrolle.
 */

test.setTimeout(120_000);

async function einsatzAnlegen(page: Page): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Modulnamen ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz: ${antwort.status()}`).toBe(true);
  return String(((await antwort.json()) as { id: number }).id);
}

/** Jede Beschreibung der offenen Liste steht ganz im Behälter, keine ragt waagerecht hinaus. */
async function beschreibungenImRahmen(rahmen: Locator, wo: string): Promise<number> {
  const masse = await rahmen.locator('[data-lfh="modul-beschreibung"]').evaluateAll((alle) =>
    alle.map((b) => {
      const knopf = b.closest('button')!.getBoundingClientRect();
      const kasten = b.getBoundingClientRect();
      return {
        text: b.textContent ?? '',
        rechts: kasten.right,
        knopfRechts: knopf.right,
        knopfScroll: b.closest('button')!.scrollWidth - b.closest('button')!.clientWidth,
      };
    }),
  );
  for (const m of masse) {
    expect(m.text.length, `${wo}: Beschreibung nicht leer`).toBeGreaterThan(0);
    expect(m.rechts, `${wo}: „${m.text}“ im Knopf`).toBeLessThanOrEqual(m.knopfRechts + 0.5);
    expect(m.knopfScroll, `${wo}: „${m.text}“ ohne Überlauf`).toBeLessThanOrEqual(0);
  }
  return masse.length;
}

for (const breite of [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
]) {
  test(`Drawer ${breite.width} px (Beobachter): jede Modulzeile trägt ihre Beschreibung, Klick führt zum Namen`, async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.setViewportSize(breite);
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    const nav = drawer.getByRole('navigation', { name: 'Einsatz-Navigation' });
    await expect(nav).toBeVisible();

    const koepfe = nav.locator('button[aria-expanded]');
    const anzahl = await koepfe.count();
    expect(anzahl, 'Kategorien im Akkordeon').toBeGreaterThan(4);
    let gesehen = 0;
    for (let i = 0; i < anzahl; i += 1) {
      const kopf = koepfe.nth(i);
      if ((await kopf.getAttribute('aria-expanded')) !== 'true') await kopf.click();
      await expect(kopf).toHaveAttribute('aria-expanded', 'true');
      gesehen += await beschreibungenImRahmen(nav, `${breite.width} px, Kategorie ${i + 1}`);
    }
    // Vorbedingung: sonst wäre die Schleife grün durch Nichtstun.
    expect(gesehen, 'Beschreibungen gesehen').toBeGreaterThan(20);

    // Der zugängliche Name bleibt der Modulname, die Beschreibung beschreibt.
    const lageKopf = nav.getByRole('button', { name: 'Lage', exact: true });
    if ((await lageKopf.getAttribute('aria-expanded')) !== 'true') await lageKopf.click();
    const lagebild = nav.getByRole('button', { name: 'Lagebild', exact: true });
    await expect(lagebild).toHaveAccessibleDescription('Lage in Zahlen, Meldungsstrom');
    await lagebild.click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lage-dashboard`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lagebild');
  });
}

test('Sprungpalette (Beobachter): der Modultreffer zeigt die Beschreibung unter dem Namen', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ETB');
  await page.keyboard.press('Control+k');
  const suche = page.getByPlaceholder(/Suchen: Module/);
  await expect(suche).toBeFocused();
  await suche.fill('Betroffene');
  const treffer = page.getByRole('option', { name: 'Betroffene', exact: true });
  await expect(treffer).toBeVisible();
  const nebenzeile = treffer.locator('[data-lfh="cmd-nebenzeile"]');
  await expect(nebenzeile).toHaveText('Vermisste, Betroffene, Patienten');
  // Die Nebenzeile steht UNTER dem Namen, nicht daneben.
  const name = (await treffer.getByText('Betroffene', { exact: true }).boundingBox())!;
  const zweite = (await nebenzeile.boundingBox())!;
  expect(zweite.y).toBeGreaterThanOrEqual(name.y + name.height - 0.5);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Betroffene');
});

test('1366 × 768: die Kräfte stehen mit Beschreibung ganz im Modulpanel', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
  const panel = page.locator('#modul-panel');
  await expect(panel).toBeVisible();
  const zeilen = panel.locator('button:has([data-lfh="modul-beschreibung"])');
  // Acht Kräfte-Module, jedes mit Beschreibung.
  await expect(zeilen).toHaveCount(8);
  await beschreibungenImRahmen(panel, '1366 px, Kräfte');
  await expect(zeilen.last()).toBeInViewport({ ratio: 1 });
});
