import { expect, test, type Page } from '@playwright/test';
import { pruefe } from './kontrast-kern';

// LFH-618: der Tagmodus des Neuentwurfs war nur GERECHNET. Die ETB-Typwörter, die
// Zeilentönungen und die Lückenmarke der Betroffenen hatten in keinem Modus eine
// Browsermessung. Böden aus Kriterium 5 als Literale: Tag ≥ 7, Nacht ≥ 5.
const ZIEL = { light: 7, dark: 5 } as const;

async function anmelden(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<{ id: number }> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: ETB-Typwörter, Berichtigungszeile und Lückenmarke`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 618 ${modus} ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    const ids: Record<string, number> = {};
    for (const typ of ['meldung', 'anordnung', 'entscheidung', 'lage']) {
      ids[typ] = (await post(page, `${basis}/etb`, { typ, inhalt: `Messung ${typ}` })).id;
    }
    await post(page, `${basis}/etb`, {
      typ: 'berichtigung',
      inhalt: 'Messung Berichtigung',
      berichtigt_eintrag_id: ids.meldung,
    });
    // Eine Person ohne Fundort und Verbleib: trägt die Lückenmarke UND erzeugt einen
    // Systemeintrag im ETB.
    await post(page, `${basis}/personen`, { sichtung: 'sk2' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await page.mouse.move(0, 0);
    for (const typ of ['meldung', 'anordnung', 'entscheidung', 'lage', 'berichtigung', 'system']) {
      const wort = page
        .locator(`[data-lfh-eintrag="zeitachse"][data-typ="${typ}"] [data-lfh="typwort"]`)
        .first();
      await pruefe(wort, ZIEL[modus], `${modus}/ETB/${typ}/Typwort`);
    }
    const berichtigung = page.locator(
      '[data-lfh-eintrag="zeitachse"][data-toenung="berichtigung"]',
    );
    await expect(berichtigung).toHaveCount(1);
    await pruefe(
      berichtigung.getByText('Messung Berichtigung', { exact: true }),
      ZIEL[modus],
      `${modus}/ETB/Berichtigungszeile/Text`,
    );

    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await page.mouse.move(0, 0);
    const luecke = page.locator('[data-lfh="luecke"]').first();
    await expect(luecke).toContainText('offen');
    await pruefe(luecke, ZIEL[modus], `${modus}/Betroffene/Lückenmarke`);
  });
}
