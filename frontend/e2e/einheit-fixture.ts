import { expect, type Locator, type Page } from '@playwright/test';

/** LFH-446: dieselben belegten Zuordnungen für Fokus- und Treffflächenmessung. */
export async function einheitMitZuordnungen(page: Page) {
  async function post(pfad: string, data: unknown): Promise<number> {
    const antwort = await page.request.post(pfad, { data });
    expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  }
  const einsatzId = await post('/api/einsaetze', { bezeichnung: `E2E 446 ${Date.now()}` });
  const basis = `/api/einsaetze/${einsatzId}`;
  const einheitId = await post(`${basis}/einheiten`, { name: 'Messzug 446' });
  const namen = { personal: 'Messperson 446', fahrzeug: 'Florian 446', material: 'Messkiste 446' };
  for (const [modul, zuordnung, adhoc] of [
    ['personal', 'personal', { name: namen.personal }],
    ['fahrzeuge', 'fahrzeug', { funkrufname: namen.fahrzeug }],
    ['material', 'material', { bezeichnung: namen.material }],
  ] as const) {
    // Zwei Einträge je Art: einer zugeordnet, einer im freien Auswahlpool.
    for (const frei of [false, true]) {
      const id = await post(`${basis}/${modul}`, {
        adhoc: Object.fromEntries(
          Object.entries(adhoc).map(([k, v]) => [k, `${v}${frei ? ' frei' : ''}`]),
        ),
        ...(modul === 'material' ? { menge: 3 } : {}),
      });
      if (!frei) {
        const antwort = await page.request.put(
          `${basis}/einheiten/${einheitId}/${zuordnung}/${id}`,
        );
        expect(antwort.ok(), `Zuordnung ${modul}: ${await antwort.text()}`).toBeTruthy();
      }
    }
  }
  return { pfad: `/einsaetze/${einsatzId}/einheiten/${einheitId}`, namen };
}

export function zuordnungsKarte(page: Page, titel: string): Locator {
  return page
    .getByRole('main')
    .locator('.ant-card')
    .filter({
      has: page.getByRole('heading', { name: titel, exact: true }),
    });
}

export function kopfFelder(page: Page): { name: string; huelle: Locator; fokus: Locator }[] {
  const form = page.getByRole('main').locator('form');
  const ergebnis: { name: string; huelle: Locator; fokus: Locator }[] = [];
  for (const name of [
    'Name',
    'Typ',
    'Abschnitt',
    'Über-Einheit',
    'Sprechgruppen',
    'Kommunikationsmittel',
    'Erreichbarkeit / Nummer',
    'Bemerkung',
  ]) {
    const gruppe = form.locator('.ant-form-item').filter({
      has: page.locator('label').filter({ hasText: new RegExp(`^${name}$`) }),
    });
    const fokus = gruppe.locator('input, textarea').first();
    const huelle = gruppe.locator(
      '.ant-select, .ant-input-affix-wrapper, textarea, input.ant-input:not(.ant-input-affix-wrapper input)',
    );
    ergebnis.push({ name, huelle, fokus });
  }
  for (const name of ['Führer', 'Unterführer', 'Mannschaft']) {
    const fokus = form.getByRole('spinbutton', { name, exact: true });
    const huelle = form
      .locator('.ant-input-number')
      .filter({ has: page.getByRole('spinbutton', { name, exact: true }) });
    ergebnis.push({ name, huelle, fokus });
  }
  return ergebnis;
}

export async function detailBereit(page: Page) {
  await expect(page.getByRole('heading', { name: 'Messzug 446', exact: true })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Messzug 446');
  for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
    await expect(
      zuordnungsKarte(page, titel).getByRole('button', { name: 'Entfernen', exact: true }),
    ).toHaveCount(1);
  }
}
