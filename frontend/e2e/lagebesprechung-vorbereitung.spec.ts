import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Vorbereitung der Lagebesprechung (LFH-550) im Browser, seit LLH-1111 auf der Seite
 * Lagebesprechung (vorher Stab):
 *
 * - GLEICHE ZAHLEN: Betroffene und Kräfte stehen auf der Seite Lagebesprechung genau so wie auf dem
 *   Lage-Dashboard, „Aufträge offen" so wie die „Offenen Aufträge" im Überblick (seit LLH-1743
 *   ihre Heimat) — ein Rechenweg.
 * - „DAVON ÜBERFÄLLIG": ein vollzogener Auftrag mit abgelaufener Frist und Quittungslücke zählt
 *   weder offen noch überfällig, auf beiden Seiten.
 * - ÜBERNAHME: genau EIN POST auf `…/lageberichte`, danach der Bericht offen. Geklickt, nicht nur
 *   `toBeVisible` (LFH-355).
 * - BEOBACHTER (LFH-435): der Lagestand steht, die Übernahme fehlt.
 * - WERT NEBEN DER BEZEICHNUNG (LLH-1747): bei 1920 × 1080 beginnt der Wert höchstens 400 px rechts
 *   der Bezeichnung, auf dem Handy bricht die Zeile um, statt über den Rand zu laufen.
 */

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

/** Zwei Betroffene, ein offener überfälliger Auftrag, ein offener ohne Frist und ein
 *  vollzogener mit abgelaufener Frist (Quittungslücke). */
async function seede(page: Page): Promise<string> {
  const einsatzId = String(
    await post(page, '/api/einsaetze', { bezeichnung: `E2E Vorbereitung ${Date.now()}` }),
  );
  const basis = `/api/einsaetze/${einsatzId}`;
  await post(page, `${basis}/persons`, { name: 'Albers' });
  await post(page, `${basis}/persons`, { name: 'Brandt' });
  const auftrag = (text: string, frist?: string) => ({
    auftrag_text: text,
    empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Abschnitt Nord' }],
    ...(frist ? { frist_at: frist } : {}),
  });
  await post(page, `${basis}/auftraege`, auftrag('Deich sichern', '2026-06-01 10:00:00'));
  await post(page, `${basis}/auftraege`, auftrag('Sandsäcke'));
  const vollzogen = await post(
    page,
    `${basis}/auftraege`,
    auftrag('Sperrung', '2026-06-01 11:00:00'),
  );
  await post(page, `${basis}/auftraege/${vollzogen}/vollzug`, {
    status: 'vollzogen',
    vollzugsmeldung: 'erledigt',
  });
  return einsatzId;
}

const zeile = (page: Page, schluessel: string) =>
  page.locator(`[data-lfh="vorbereitung-zeile"][data-schluessel="${schluessel}"]`);

async function dashboardWerte(page: Page, einsatzId: string) {
  const wert = (titel: string) =>
    page
      .locator('[data-lfh="kennzahl"]')
      .filter({ hasText: titel })
      .first()
      .locator('[data-lfh="kennzahl-wert"]');
  // Aufträge stehen seit LLH-1743 im Überblick (Seitenrollen), seit LLH-1748 im Abschnitt
  // „Aufträge“ der offenen Vorgänge; Betroffene und Kräfte im Lagebild.
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
  const auftragsZahl = page.locator('[data-lfh="vorgaenge-auftraege"] [data-lfh="abschnitt-zahl"]');
  await expect(auftragsZahl).toHaveText('2');
  const auftraege = (await auftragsZahl.textContent())!.trim();
  await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
  // Jede Kachel hat ihre eigene Quelle: erst lesen, wenn beide eine Zahl zeigen.
  for (const titel of ['Betroffene', 'Kräfte']) await expect(wert(titel)).toHaveText(/^\d+$/);
  return {
    betroffene: (await wert('Betroffene').textContent())!.trim(),
    kraefte: (await wert('Kräfte').textContent())!.trim(),
    auftraege,
  };
}

test('dieselben Zahlen wie das Dashboard, Übernahme in EINEM Aufruf', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await seede(page);
  const dashboard = await dashboardWerte(page, einsatzId);
  expect(dashboard).toEqual({ betroffene: '2', kraefte: '0', auftraege: '2' });

  await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
  const wert = (s: string) => zeile(page, s).locator('[data-teil="wert"]');
  await expect(wert('auftraege')).toHaveText(dashboard.auftraege);
  await expect(zeile(page, 'auftraege')).toContainText('1 überfällig');
  await expect(wert('betroffene')).toHaveText(dashboard.betroffene);
  await expect(wert('kraefte')).toHaveText(dashboard.kraefte);

  const anfragen: string[] = [];
  page.on('request', (r) => {
    const pfad = new URL(r.url()).pathname;
    if (/\/lageberichte(\/\d+)?$/.test(pfad) && r.method() !== 'GET') {
      anfragen.push(`${r.method()} ${pfad}`);
    }
  });
  await page.getByRole('button', { name: 'In Lagebericht übernehmen' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  expect(anfragen).toEqual([`POST /api/einsaetze/${einsatzId}/lageberichte`]);
  await expect(page.getByText('Quelle: Aufträge/Befehle').first()).toBeVisible();
});

test('Beobachter: Lagestand ja, Übernahme nein', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await seede(page);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
  await expect(zeile(page, 'auftraege').locator('[data-teil="wert"]')).toHaveText('2');
  await expect(page.getByRole('button', { name: 'In Lagebericht übernehmen' })).toHaveCount(0);
});

test.describe('Wert neben der Bezeichnung (LLH-1747)', () => {
  test.describe('Fükw 1920 × 1080', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('der Wert beginnt höchstens 400 px rechts der Bezeichnung', async ({ page }) => {
      await anmeldenAlsAdmin(page, { startseite: false });
      const einsatzId = await seede(page);
      await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
      const z = zeile(page, 'betroffene');
      await expect(z.locator('[data-teil="wert"]')).toHaveText('2');
      const bezeichnung = (await z.locator('> span').first().boundingBox())!;
      const wert = (await z.locator('[data-teil="wert"]').boundingBox())!;
      expect(wert.x - bezeichnung.x).toBeLessThanOrEqual(400);
      expect(wert.x).toBeGreaterThan(bezeichnung.x);
    });
  });

  test.describe('Handy 390 × 844', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('keine Zeile ragt über den Rand des Paneels', async ({ page }) => {
      await anmeldenAlsAdmin(page, { startseite: false });
      const einsatzId = await seede(page);
      await page.goto(`/einsaetze/${einsatzId}/lagebesprechung`);
      await expect(zeile(page, 'sichtung').locator('[data-teil="wert"]')).not.toBeEmpty();
      // Je Teil der Zeile: kein Text breiter als sein Kasten (die Kästen selbst streckt das Raster
      // auf die Spalte, ihr Rand sagt also nichts), und kein Kasten über den Rand der Zeile.
      const ueberstand = await page
        .locator('[data-lfh="vorbereitung-zeile"]')
        .evaluateAll((zeilen) =>
          zeilen.flatMap((z) =>
            [...z.children]
              .filter(
                (k) =>
                  k.scrollWidth > k.clientWidth + 1 ||
                  k.getBoundingClientRect().right > z.getBoundingClientRect().right + 1,
              )
              .map((k) => `${z.getAttribute('data-schluessel')}: ${k.textContent}`),
          ),
        );
      expect(ueberstand).toEqual([]);
    });
  });
});
