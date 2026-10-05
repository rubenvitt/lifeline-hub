import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Vorbereitung der Lagebesprechung (LFH-550) im Browser:
 *
 * - GLEICHE ZAHLEN: Betroffene, Kräfte und „Aufträge offen" stehen auf der Stab-Seite genau so
 *   wie auf dem Lage-Dashboard — eine Zusammenstellung, ein Rechenweg.
 * - „DAVON ÜBERFÄLLIG": ein vollzogener Auftrag mit abgelaufener Frist und Quittungslücke zählt
 *   weder offen noch überfällig, auf beiden Seiten.
 * - ÜBERNAHME: genau EIN POST auf `…/lageberichte`, danach der Bericht offen. Geklickt, nicht nur
 *   `toBeVisible` (LFH-355).
 * - BEOBACHTER (LFH-435): der Lagestand steht, die Übernahme fehlt.
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
  await post(page, `${basis}/personen`, { name: 'Albers' });
  await post(page, `${basis}/personen`, { name: 'Brandt' });
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
  await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
  const wert = (titel: string) =>
    page
      .locator('[data-lfh="kennzahl"]')
      .filter({ hasText: titel })
      .first()
      .locator('[data-lfh="kennzahl-wert"]');
  await expect(wert('Aufträge offen')).toHaveText('2');
  // Jede Kachel hat ihre eigene Quelle: „Aufträge offen“ steht aus dem Modulzähler, während die
  // Personen noch laden („····“). Erst lesen, wenn alle drei eine Zahl zeigen.
  for (const titel of ['Betroffene', 'Kräfte']) await expect(wert(titel)).toHaveText(/^\d+$/);
  return {
    betroffene: (await wert('Betroffene').textContent())!.trim(),
    kraefte: (await wert('Kräfte').textContent())!.trim(),
    auftraege: (await wert('Aufträge offen').textContent())!.trim(),
  };
}

test('dieselben Zahlen wie das Dashboard, Übernahme in EINEM Aufruf', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await seede(page);
  const dashboard = await dashboardWerte(page, einsatzId);
  expect(dashboard).toEqual({ betroffene: '2', kraefte: '0', auftraege: '2' });

  await page.goto(`/einsaetze/${einsatzId}/stab`);
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
  await page.goto(`/einsaetze/${einsatzId}/stab`);
  await expect(zeile(page, 'auftraege').locator('[data-teil="wert"]')).toHaveText('2');
  await expect(page.getByRole('button', { name: 'In Lagebericht übernehmen' })).toHaveCount(0);
});
