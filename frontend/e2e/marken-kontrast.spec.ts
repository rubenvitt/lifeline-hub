import { expect, test, type Page } from '@playwright/test';
import { pruefe } from './kontrast-kern';

/**
 * Marken auf eigener Fläche (LFH-891, Spec `farbrollen-kontrast`): die Beschriftung einer Marke
 * hält gegen ihre eigene deckende Fläche den Textboden aus Kriterium 5. Gemessen an „ad-hoc“ in
 * Personal- und Fahrzeugliste, weil das antd-Preset `blue` dort Tag 5,50 und Nacht 4,91 maß.
 * Die übrigen Kennzeichnungen nutzen dieselbe Bauform (`Tag` ohne `color`).
 *
 * Böden als Literale, keine Farbwerte aus dem Produkt: eine schlechte Palette muss rot werden.
 */
const TEXT = { light: 7, dark: 5 } as const;

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
  test(`${modus}: Marke „ad-hoc“ in Personal- und Fahrzeugliste hält den Textboden`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 891 ${modus} ${Date.now()}`,
    });
    const kraft = await post(page, `/api/einsaetze/${einsatzId}/personal`, {
      adhoc: { name: 'Albers, Anna', funktion: 'Truppführung', traegerorganisation: 'FF Muster' },
    });
    const fahrzeug = await post(page, `/api/einsaetze/${einsatzId}/fahrzeuge`, {
      adhoc: { funkrufname: 'Florian Muster 1', fahrzeugtyp: 'LF 20' },
    });

    await page.goto(`/einsaetze/${einsatzId}/personal`);
    const personalMarke = page
      .locator(`tr[data-row-key="${kraft.id}"] .ant-tag`)
      .filter({ hasText: /^ad-hoc$/ });
    await expect(personalMarke).toHaveCount(1);
    // Zeiger aus der Tabelle, damit antds Zeilen-Hover die Ruhemessung nicht verfälscht.
    await page.mouse.move(1, 1);
    await pruefe(personalMarke, TEXT[modus], `${modus}: ad-hoc in der Personalliste`);

    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    const fahrzeugMarke = page
      .locator(`tr[data-row-key="${fahrzeug.id}"] .ant-tag`)
      .filter({ hasText: /^ad-hoc$/ });
    await expect(fahrzeugMarke).toHaveCount(1);
    await page.mouse.move(1, 1);
    await pruefe(fahrzeugMarke, TEXT[modus], `${modus}: ad-hoc in der Fahrzeugliste`);
  });
}
