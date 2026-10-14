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

/**
 * Die Bedienziele der Zuordnungen (LLH-1036 Teil II): im Paneel „Fahrzeuge und Besatzung“ das
 * Menü der Person, die FMS-Wahl und „Aus Einheit lösen“ des Fahrzeugs und die beiden
 * Auswahlfelder, im Paneel „Material“ Lösen und Auswahl. `reihen` sind die Nachbarn auf einer
 * Zeile, `stapel` je Paneel die letzte Zeilenaktion über dem ersten Auswahlfeld.
 */
export function zuordnungsZiele(page: Page, namen: { personal: string; fahrzeug: string }) {
  const besatzung = zuordnungsKarte(page, 'Fahrzeuge und Besatzung');
  const material = zuordnungsKarte(page, 'Material');
  const fahrzeugZeile = besatzung.getByRole('group', { name: `Fahrzeug ${namen.fahrzeug}` });
  const fmsStatus = fahrzeugZeile.getByRole('button', {
    name: `Status von ${namen.fahrzeug} ändern`,
  });
  const fahrzeugLoesen = fahrzeugZeile.getByRole('button', {
    name: 'Aus Einheit lösen',
    exact: true,
  });
  const personMenue = besatzung.getByRole('button', {
    name: `Aktionen zu Person ${namen.personal}`,
  });
  const personZuordnen = besatzung.getByRole('combobox', { name: 'Person zuordnen' });
  const fahrzeugZuordnen = besatzung.getByRole('combobox', { name: 'Fahrzeug zuordnen' });
  const materialLoesen = material.getByRole('button', { name: 'Aus Einheit lösen', exact: true });
  const materialZuordnen = material.getByRole('combobox', { name: 'Material zuordnen' });
  /** Die Hülle des antd-Felds: sie ist das Bedienziel, nicht das innere Eingabefeld. */
  const huelle = (feld: Locator) =>
    feld.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]',
    );
  return {
    ziele: [
      { name: 'Person: Aktionen', ziel: personMenue, fokus: personMenue },
      { name: 'Fahrzeug: Status', ziel: fmsStatus, fokus: fmsStatus },
      { name: 'Fahrzeug aus Einheit lösen', ziel: fahrzeugLoesen, fokus: fahrzeugLoesen },
      { name: 'Person zuordnen', ziel: huelle(personZuordnen), fokus: personZuordnen },
      { name: 'Fahrzeug zuordnen', ziel: huelle(fahrzeugZuordnen), fokus: fahrzeugZuordnen },
      { name: 'Material aus Einheit lösen', ziel: materialLoesen, fokus: materialLoesen },
      { name: 'Material zuordnen', ziel: huelle(materialZuordnen), fokus: materialZuordnen },
    ],
    zeilen: [
      { name: 'Fahrzeugzeile', zeile: besatzung.locator('[data-lfh="einheit-fahrzeug"]') },
      { name: 'Personenzeile', zeile: besatzung.locator('[data-lfh="einheit-person"]') },
      { name: 'Materialzeile', zeile: material.locator('[data-lfh="einheit-zuordnung"]') },
    ],
    reihen: [
      [fmsStatus, fahrzeugLoesen],
      [huelle(personZuordnen), huelle(fahrzeugZuordnen)],
    ],
    stapel: [
      { name: 'Fahrzeuge und Besatzung', aktion: personMenue, auswahl: huelle(personZuordnen) },
      { name: 'Material', aktion: materialLoesen, auswahl: huelle(materialZuordnen) },
    ],
  };
}

export async function detailBereit(page: Page) {
  await expect(page.getByRole('heading', { name: 'Messzug 446', exact: true })).toBeVisible();
  await expect(zeilenAusloeser(page, 'Name')).toHaveAccessibleDescription('Messzug 446');
  // Datenanker: die Besatzung steht erst, wenn Personal- und Fahrzeugliste geladen sind.
  const besatzung = zuordnungsKarte(page, 'Fahrzeuge und Besatzung');
  await expect(besatzung.getByRole('group', { name: 'Fahrzeug Florian 446' })).toBeVisible();
  await expect(
    besatzung.getByRole('button', { name: 'Aktionen zu Person Messperson 446' }),
  ).toHaveCount(1);
  await expect(
    zuordnungsKarte(page, 'Material').getByRole('button', {
      name: 'Aus Einheit lösen',
      exact: true,
    }),
  ).toHaveCount(1);
}
