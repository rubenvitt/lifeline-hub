import { expect, type Locator, type Page } from '@playwright/test';

/** Dieselben belegten Zuordnungen für Fokus- und Treffflächenmessung. */
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
    .locator('[data-lfh="paneel"]')
    .filter({
      has: page.getByRole('heading', { name: titel, exact: true }),
    });
}

/**
 * Die Angaben der Einheit-Ansicht (LLH-1036): Kopf, Funk und Zeichen, je an ihrer Zeile. Ohne
 * Klick steht kein Eingabefeld da; das Bedienziel ist der Zeilenauslöser „… bearbeiten“ (gefüllt)
 * bzw. „… eintragen“ (leer).
 */
export const ANGABEN = [
  'Name',
  'Typ',
  'Funkrufname',
  'Abschnitt',
  'Über-Einheit',
  'Einheitsführer',
  'Soll-Stärke',
  'Bemerkung',
  'Sprechgruppen',
  'Kommunikationsmittel',
  'Erreichbarkeit / Nummer',
  'Fachaufgabe',
  'Organisation',
] as const;

/** Zeilenauslöser einer Angabe, gleich ob sie gefüllt oder leer ist. */
export function zeilenAusloeser(page: Page, angabe: string): Locator {
  return page
    .getByRole('main')
    .getByRole('button', { name: new RegExp(`^${angabe} (bearbeiten|eintragen)$`) });
}

export function kopfFelder(page: Page): { name: string; huelle: Locator; fokus: Locator }[] {
  return ANGABEN.map((name) => {
    const ausloeser = zeilenAusloeser(page, name);
    return { name, huelle: ausloeser, fokus: ausloeser };
  });
}

export async function detailBereit(page: Page) {
  await expect(page.getByRole('heading', { name: 'Messzug 446', exact: true })).toBeVisible();
  await expect(zeilenAusloeser(page, 'Name')).toHaveAccessibleDescription('Messzug 446');
  for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
    await expect(
      zuordnungsKarte(page, titel).getByRole('button', { name: 'Aus Einheit lösen', exact: true }),
    ).toHaveCount(1);
  }
}
