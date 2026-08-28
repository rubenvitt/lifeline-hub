import { expect, test, type Page } from '@playwright/test';

/**
 * M51 (LFH-347 · C12), Nachweis zur Entscheidung aus LFH-368 · B5h: die Zelle der
 * Gefahrenmatrix ist EIN Auslöser (Dropdown), kein 5-Wege-Segmentcontrol — das Breitenbudget
 * im Fükw (~693 px) trägt keins. Was das Ticket verlangt und hier gemessen wird: auf dem
 * Führungs-Tablet (Stufe komfortabel) ist jede bedienbare Zelle ≥ 44 px hoch. Im Fükw
 * (kompakt, Maus) sind es 30 — das ist die Staffel aus LFH-352, kein Mangel.
 */
test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

const DICHTE = 'lifeline-hub.dichte';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Subpixel-Toleranz wie in `trefflaeche-tablet.spec.ts` — Chromium rechnet unter Last
 *  anders als im Einzellauf. */
const SUBPIXEL = 0.5;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

test('jede Matrix-Zelle misst auf dem Tablet mindestens 44 px', async ({ page }) => {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [DICHTE, 'komfortabel'] as const);
  await anmelden(page);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill('C12 Matrix');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)/)![1];

  // Gefahrengebiet über die API (WebGL/Karte s. Memory) — POST /api/einsaetze/{id}/zonen.
  // typ='gefahrengebiet' legt die Gruppe automatisch mit an; geometrie ist ein STRING mit
  // GeoJSON, dessen `type` zu `geometrie_typ` passen muss ('Polygon', grossgeschrieben —
  // src/lage_zone/mod.rs GeometrieTyp::as_str).
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/zonen`, {
    data: {
      typ: 'gefahrengebiet',
      geometrie_typ: 'Polygon',
      geometrie: JSON.stringify({
        type: 'Polygon',
        coordinates: [[[10.0, 50.0], [10.01, 50.0], [10.01, 50.01], [10.0, 50.01], [10.0, 50.0]]],
      }),
      label: 'C12 Gebiet',
    },
  });
  expect(antwort.ok(), `Zone anlegen: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();

  await page.goto(`/einsaetze/${einsatzId}/gefahren`);
  // `GefahrenPage` wählt das erste Gefahrengebiet automatisch (kein Deeplink-Ziel in der
  // URL) — kein Klick auf die Liste nötig, die Matrix erscheint direkt.
  const zellen = page.getByRole('button', { name: /^Bewertung / });
  await expect(zellen.first()).toBeVisible();
  const n = await zellen.count();
  // 13 Gefahrentypen × 5 Schutzobjekte = 65 Kombinationen, davon 58 bedienbar
  // (`GefahrenMatrix.tsx`-Kommentar „alle 58 bedienbaren Zellen"); der Rest ist `n. a.`
  // und trägt keinen Knopf.
  expect(n).toBeGreaterThanOrEqual(58);
  for (let i = 0; i < n; i += 1) {
    const zelle = zellen.nth(i);
    const name = (await zelle.getAttribute('aria-label')) ?? `Zelle ${i}`;
    // `expect.poll` statt einer einmaligen Messung: antd blendet den Zell-Knopf beim ersten
    // Render der Tabelle nicht animiert ein, aber die Dichte-Staffel greift erst nach dem
    // Mount von `ConfigProvider`/`ThemeModeProvider` — ohne das Warten liefe man Gefahr, die
    // Zelle vor dem endgültigen Layout zu messen (Muster aus `trefflaeche-tablet.spec.ts`).
    await expect
      .poll(async () => (await zelle.boundingBox())?.height ?? 0, {
        message: `${name}: Soll ≥ 44 px hoch`,
      })
      .toBeGreaterThanOrEqual(44 - SUBPIXEL);
  }
});
