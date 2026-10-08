import { expect, test, type Page } from '@playwright/test';
import { pruefe } from './kontrast-kern';

/**
 * Marken auf eigener Fläche (LFH-891, Spec `farbrollen-kontrast`): die Beschriftung einer Marke
 * hält gegen ihre eigene deckende Fläche den Textboden aus Kriterium 5. Gemessen an „ad-hoc“ in
 * Personal- und Fahrzeugliste, weil das antd-Preset `blue` dort Tag 5,50 und Nacht 4,91 maß.
 * Die übrigen Kennzeichnungen nutzen dieselbe Bauform (`Tag` ohne `color`).
 *
 * LFH-1022 zog die übrigen Presets nach: kein Preset hielt beide Böden (Browser, 08.10.2026,
 * alle 14 Presets; etwa „Admin“ `gold` Tag 2,76, „Patient“ `geekblue` Nacht 4,16, `purple` Nacht
 * 3,39, `green` Tag 3,37). Der zweite Test misst je eine Fundstelle jeder neuen Bauform:
 * Kennzeichnungen neutral („Patient“, „Admin“), Status über `StatusTag` (Abgleich „Verdacht“,
 * Online-Quelle „inaktiv“).
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

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: frühere Preset-Marken halten den Textboden (LFH-1022)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 1022 ${modus} ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}/personen`;
    const gefunden = await post(page, basis, { name: 'Gefunden, Greta', sichtung: 'sk1' });
    const vermisst = await post(page, basis, { name: 'Vermisst, Volker', status: 'vermisst' });
    await post(page, `${basis}/${vermisst.id}/abgleich`, { gefunden_person_id: gefunden.id });

    // Kennzeichnung ohne Status: „Patient“ war `geekblue` (Nacht 4,16).
    await page.goto(`/einsaetze/${einsatzId}/personen/${gefunden.id}`);
    const patient = page.locator('.ant-tag').filter({ hasText: /^Patient$/ });
    await expect(patient).toHaveCount(1);
    await page.mouse.move(1, 1);
    await pruefe(patient, TEXT[modus], `${modus}: Patient in der Personen-Detailseite`);

    // Status: der offene Abgleich war `gold` (Tag 2,76) und ist jetzt `achtung` aus dem Vertrag.
    await page.goto(`/einsaetze/${einsatzId}/personen/${vermisst.id}`);
    const verdacht = page
      .locator('.ant-tag[data-rolle="achtung"]')
      .filter({ hasText: /^Verdacht$/ });
    await expect(verdacht).toHaveCount(1);
    await page.mouse.move(1, 1);
    await pruefe(verdacht, TEXT[modus], `${modus}: Abgleich „Verdacht“`);

    // Rolle im Benutzermenü: „Admin“ war `gold`.
    await page.getByRole('button', { name: 'Benutzermenü' }).click();
    const admin = page.locator('.ant-dropdown .ant-tag').filter({ hasText: /^Admin$/ });
    await expect(admin).toHaveCount(1);
    await pruefe(admin, TEXT[modus], `${modus}: Admin im Benutzermenü`);
    await page.keyboard.press('Escape');

    // Status einer Online-Quelle. Inaktiv angelegt und wieder gelöscht: eine aktive Quelle mit
    // unerreichbarer URL bräche jede spätere Lagekarte im selben Shard.
    const quelle = await post(page, '/api/karte/online-quellen', {
      name: `E2E 1022 ${modus} ${Date.now()}`,
      url: `https://e2e.example/${Date.now()}/{z}/{x}/{y}.png`,
      typ: 'raster',
      attribution: '© E2E',
      sortier: 99,
      aktiv: false,
      proxy: false,
    });
    try {
      await page.goto('/admin/karten/online');
      const inaktiv = page
        .locator('tr.ant-table-row')
        .filter({ hasText: `E2E 1022 ${modus}` })
        .locator('.ant-tag[data-rolle="neutral"]')
        .filter({ hasText: /^inaktiv$/ });
      await expect(inaktiv).toHaveCount(1);
      await page.mouse.move(1, 1);
      await pruefe(inaktiv, TEXT[modus], `${modus}: Online-Quelle „inaktiv“`);
    } finally {
      await page.request.delete(`/api/karte/online-quellen/${quelle.id}`);
    }
  });
}
