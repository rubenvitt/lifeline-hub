import { expect, type Locator, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

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
  const zugeordnet: Record<string, number> = {};
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
        // Material bekommt seinen Ort beim Disponieren (LLH-1225, ein Schreibweg), nicht über die
        // Einheiten-Route.
        ...(modul === 'material' ? { menge: 3, ...(frei ? {} : { einheit_id: einheitId }) } : {}),
      });
      if (!frei && modul === 'material') {
        zugeordnet[modul] = id;
      } else if (!frei) {
        const antwort = await page.request.put(
          `${basis}/einheiten/${einheitId}/${zuordnung}/${id}`,
        );
        expect(antwort.ok(), `Zuordnung ${modul}: ${await antwort.text()}`).toBeTruthy();
        zugeordnet[modul] = id;
      }
    }
  }
  // Die Person sitzt auf dem Fahrzeug: Fahrzeug- und Personenzeile stehen direkt untereinander.
  const besatzung = await page.request.put(
    `${basis}/fahrzeuge/${zugeordnet.fahrzeuge}/besatzung/${zugeordnet.personal}`,
  );
  expect(besatzung.ok(), `Besatzung: ${await besatzung.text()}`).toBeTruthy();
  return { pfad: `/einsaetze/${einsatzId}/einheiten/${einheitId}`, namen };
}

/**
 * Wer den Sperrzweig der Einheit-Ansicht sieht (LLH-1270): der Beobachter nach der Regel LFH-820
 * (`e2e/AGENTS.md`), dazu das Führungspersonal, weil die Sperre hier auch Schreibziele ändert
 * (flache Liste mit „Aus Einheit lösen“, „Person zuordnen …“ gesperrt mit Grund).
 */
export type SperrRolle = 'beobachter' | 'fuehrungspersonal';

/**
 * Dieselben Zuordnungen wie {@link einheitMitZuordnungen}, dazu das Modul Personal per
 * Einsatz-Override gesperrt (`benoetigte_rolle: 'admin'`, `e2e/AGENTS.md`, LFH-820). Gesät wird
 * als Admin, der nie gesperrt ist; danach wechselt die Sitzung im selben Kontext auf `rolle`.
 * Die Besatzung fehlt dann, die Ansicht zeigt „Ohne Besatzung · Modul Personal gesperrt“
 * (LLH-1036 D5, Spec `einheit-ansicht`).
 */
export async function seedEinheitPersonalGesperrt(page: Page, rolle: SperrRolle) {
  const { pfad, namen } = await einheitMitZuordnungen(page);
  const einsatzId = pfad.split('/')[2];
  const sperre = await page.request.put(`/api/einsaetze/${einsatzId}/modul-overrides/personal`, {
    data: { sichtbar: true, benoetigte_rolle: 'admin' },
  });
  // Ein still gescheitertes Seeding mäße den freien Zweig — grün durch Nichtstun.
  expect(sperre.ok(), `Override Personal: ${sperre.status()} ${await sperre.text()}`).toBe(true);
  await wechsleZuRolle(page, rolle, einsatzId);
  return { pfad, namen };
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
  // LLH-1134: Funk und Telefon getrennt; die typisierte Liste ersetzt Kommunikationsmittel und
  // Erreichbarkeit.
  'Telefon und weitere Verbindungen',
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
 * Auswahlfelder, im Paneel „Material“ Lösen und Auswahl. `reihen` sind benachbarte Ziele (auf
 * einer Zeile oder Zeile über Zeile), `stapel` je Paneel die letzte Zeilenaktion über dem ersten
 * Auswahlfeld.
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
  // Der Baustein Material am Ort nennt den Posten im Namen („Messkiste 446 aus Einheit lösen“).
  const materialLoesen = material.getByRole('button', { name: /aus Einheit lösen$/ });
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
      { name: 'Materialzeile', zeile: material.locator('[data-lfh="material-am-ort-zeile"]') },
    ],
    reihen: [
      [fmsStatus, fahrzeugLoesen],
      [huelle(personZuordnen), huelle(fahrzeugZuordnen)],
      // Zeile über Zeile: Funkrufname über dem Namen der Person, Lösen über ihrem Menü.
      [
        fahrzeugZeile.getByRole('link', { name: namen.fahrzeug }),
        besatzung.getByRole('link', { name: namen.personal }),
      ],
      [fahrzeugLoesen, personMenue],
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
    zuordnungsKarte(page, 'Material').getByRole('button', { name: /aus Einheit lösen$/ }),
  ).toHaveCount(1);
}

/**
 * Datenanker und Vorbedingungen des Sperrzweigs (LLH-1270). Erst stehen die Mitglieder (flach aus
 * dem Einheit-DTO), dann trägt die Vorbedingung: der Hinweis „Ohne Besatzung · Modul Personal
 * gesperrt“, keine Besatzungsgruppe, kein Link ins gesperrte Modul; beim Führungspersonal dazu
 * „Person zuordnen …“ gesperrt mit Grund. Ignoriert die Ansicht die Sperre, fragt sie die Liste ab,
 * erhält 403 und zeigt keinen Hinweis — rot an dieser Stelle.
 */
export async function checkGesperrtReady(page: Page, rolle: SperrRolle) {
  await expect(page.getByRole('heading', { name: 'Messzug 446', exact: true })).toBeVisible();
  const besatzung = zuordnungsKarte(page, 'Fahrzeuge und Besatzung');
  await expect(besatzung.locator('[data-lfh="einheit-fahrzeug"]')).toContainText('Florian 446');
  await expect(besatzung.locator('[data-lfh="einheit-person"]')).toContainText('Messperson 446');
  await expect(
    zuordnungsKarte(page, 'Material').locator('[data-lfh="material-am-ort-zeile"]'),
  ).toContainText('Messkiste 446');

  await expect(
    besatzung.locator('[data-lfh="rechte-hinweis"]').filter({ hasText: 'Ohne Besatzung' }),
    'Vorbedingung: der Hinweis nennt das gesperrte Modul',
  ).toContainText('Modul Personal gesperrt');
  await expect(
    besatzung.getByRole('group', { name: 'Fahrzeug Florian 446' }),
    'Vorbedingung: ohne Freigabe Personal keine Besatzungsgruppe',
  ).toHaveCount(0);
  await expect(
    besatzung.getByRole('link', { name: 'Messperson 446' }),
    'Vorbedingung: kein Link ins gesperrte Modul Personal',
  ).toHaveCount(0);
  await expect(
    besatzung.getByRole('button', { name: 'Status von Florian 446 ändern' }),
    'Vorbedingung: ohne Besatzung keine FMS-Wahl',
  ).toHaveCount(0);
  if (rolle === 'fuehrungspersonal') {
    const personZuordnen = besatzung.getByRole('combobox', { name: 'Person zuordnen' });
    await expect(personZuordnen, 'Vorbedingung: „Person zuordnen …“ gesperrt').toBeDisabled();
    await expect(personZuordnen).toHaveAccessibleDescription('Modul Personal gesperrt');
    await expect(besatzung.getByRole('combobox', { name: 'Fahrzeug zuordnen' })).toBeEnabled();
  } else {
    await expect(
      page.getByRole('main').getByRole('button', { name: /aus Einheit lösen$/i }),
      'Vorbedingung: ohne Schreibrecht kein Lösen',
    ).toHaveCount(0);
    await expect(zeilenAusloeser(page, 'Name'), 'Vorbedingung: keine Zeilenauslöser').toHaveCount(
      0,
    );
  }
}

/**
 * Die Bedienziele im Sperrzweig (LLH-1270), als Gegenstück zu {@link zuordnungsZiele}: die
 * Fahrzeugzeile steht flach (kein `group`), ihr Funkrufname bleibt ein Link (Fahrzeuge ist frei).
 * Dem Beobachter bleibt nur dieser Link; das Führungspersonal behält Lösen, das Menü der Person,
 * „Fahrzeug zuordnen …“ und Material. `gesperrt` sind sichtbare, gesperrte Ziele ohne Fokus.
 */
export function zuordnungTargetsGesperrt(
  page: Page,
  namen: { personal: string; fahrzeug: string },
  rolle: SperrRolle,
) {
  const besatzung = zuordnungsKarte(page, 'Fahrzeuge und Besatzung');
  const material = zuordnungsKarte(page, 'Material');
  const fahrzeugZeile = besatzung.locator('[data-lfh="einheit-fahrzeug"]');
  const funkrufname = fahrzeugZeile.getByRole('link', { name: namen.fahrzeug, exact: true });
  const zeilen = [
    { name: 'Fahrzeugzeile flach', zeile: fahrzeugZeile },
    { name: 'Personenzeile flach', zeile: besatzung.locator('[data-lfh="einheit-person"]') },
    { name: 'Materialzeile', zeile: material.locator('[data-lfh="material-am-ort-zeile"]') },
  ];
  const linkZiel = { name: 'Funkrufname (Link)', ziel: funkrufname, fokus: funkrufname };
  if (rolle === 'beobachter') {
    return { ziele: [linkZiel], gesperrt: [], zeilen, reihen: [], stapel: [] };
  }
  const huelle = (feld: Locator) =>
    feld.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]',
    );
  const fahrzeugLoesen = fahrzeugZeile.getByRole('button', {
    name: 'Aus Einheit lösen',
    exact: true,
  });
  const personMenue = besatzung.getByRole('button', {
    name: `Aktionen zu Person ${namen.personal}`,
  });
  const personZuordnen = besatzung.getByRole('combobox', { name: 'Person zuordnen' });
  const fahrzeugZuordnen = besatzung.getByRole('combobox', { name: 'Fahrzeug zuordnen' });
  const materialLoesen = material.getByRole('button', { name: /aus Einheit lösen$/ });
  const materialZuordnen = material.getByRole('combobox', { name: 'Material zuordnen' });
  return {
    ziele: [
      linkZiel,
      { name: 'Fahrzeug aus Einheit lösen', ziel: fahrzeugLoesen, fokus: fahrzeugLoesen },
      { name: 'Person: Aktionen', ziel: personMenue, fokus: personMenue },
      { name: 'Fahrzeug zuordnen', ziel: huelle(fahrzeugZuordnen), fokus: fahrzeugZuordnen },
      { name: 'Material aus Einheit lösen', ziel: materialLoesen, fokus: materialLoesen },
      { name: 'Material zuordnen', ziel: huelle(materialZuordnen), fokus: materialZuordnen },
    ],
    gesperrt: [
      { name: 'Person zuordnen gesperrt', ziel: huelle(personZuordnen), feld: personZuordnen },
    ],
    zeilen,
    reihen: [
      // Zeile über Zeile: Lösen am Fahrzeug über dem Menü der Person; das gesperrte Feld mit
      // seinem Grund über „Fahrzeug zuordnen …“.
      [fahrzeugLoesen, personMenue],
      [huelle(personZuordnen), huelle(fahrzeugZuordnen)],
    ],
    stapel: [
      { name: 'Fahrzeuge und Besatzung', aktion: personMenue, auswahl: huelle(personZuordnen) },
      { name: 'Material', aktion: materialLoesen, auswahl: huelle(materialZuordnen) },
    ],
  };
}
