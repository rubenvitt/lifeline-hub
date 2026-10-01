import { expect, test, type Locator, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';
import {
  FUEKW,
  STAFFEL,
  alleHaltenStufe,
  anlegen,
  anmelden,
  einsatzAnlegen,
  gegenprobe,
  kurzeAchseHaelt,
  stelleDichte,
} from './trefflaeche-kern';

/**
 * Prüflistenzeile 2 („Handschuh-Modus“) an den Flächen der Modul-Prüflisten C7, C8, C10, C11,
 * C12 und C13 (LFH-724, Spec `einsatztauglichkeit-layout`, „Trefffläche folgt der Dichtestufe“).
 * Bis dahin war die 72-px-Stufe dort nur als Mechanismus belegt (`dichte.spec.ts`), nicht an
 * der Fläche gemessen.
 *
 * ZWEI STUFEN STATT DREI: `handschuh` mit dem Boden 72, `kompakt` für die Gegenprobe
 * („kompakt < handschuh“ je Zielsorte, `gegenprobe` aus dem Kern) — eine Untergrenze allein
 * bliebe grün, wenn jedes Ziel in jeder Stufe 72 px mäße. `komfortabel` belegt der Mechanismus
 * (`trefflaeche-tablet.spec.ts`). Herleitung: design.md der Change LFH-724, D5.
 *
 * ZIELE WERDEN BENANNT, NICHT GEFEGT: jede Zielsorte nennt ihre Knoten über Rolle, Name oder
 * die antd-Hülle (`.ant-select`, `.ant-input-number`, nicht deren inneres `input`) und fordert
 * eine Mindestzahl. Bewusst NICHT gemessen und je in einem Folgeticket: die Brotkrume (LFH-909),
 * Kennungs-Links in Tabellenzellen (LFH-908) und beschriftete Checkboxen (LFH-907). Das
 * Löschkreuz eines Auswahlfelds ist benannt ausgenommen: das Feld selbst ist das gleichwertige
 * Ziel.
 *
 * ROLLENZWEIG (LFH-435, `e2e/AGENTS.md`): jede Fläche mit Schreibaktionen hat ein Geschwister
 * in `handschuh` als Beobachter bzw. Führungskraft. Vorbedingung vor der Messung ist der
 * Rollenzweig selbst — die Schreibaktion fehlt —, gemessen wird, was bleibt.
 */

const HANDSCHUH = 72;
/**
 * `handschuh` misst gegen 72. `kompakt` dient der Gegenprobe und misst gegen den Boden aus
 * A1 Gate 3 (24 px), nicht gegen die Steuerhöhe 30: ein Baumknoten trägt dort 24 px und ist
 * damit konform.
 */
const STUFEN = STAFFEL.filter((s) => s.dichte !== 'komfortabel').map((s) =>
  s.dichte === 'kompakt' ? { ...s, soll: 24 } : s,
);

/** Boden je Stufe; unbeschriftete Ziele tragen die KLEINE Steuerhöhe (24 / 72). */
const BODEN_KLEIN = { kompakt: 24, handschuh: 72 } as const;

interface Ziel {
  sorte: string;
  ziele: (page: Page) => Locator;
  mindestens: number;
  /** Unbeschriftet: Boden auf BEIDEN Achsen, und zwar die kleine Steuerhöhe. */
  kurz?: boolean;
  /** Keine Gegenprobe: das Ziel ist in jeder Stufe gleich groß (mehrzeiliges Textfeld). */
  ohneGegenprobe?: boolean;
}

interface Flaeche {
  pfad: string;
  /** Datenanker: erst wenn er steht, trägt die Seite ihre Daten. */
  anker: (page: Page) => Locator;
  /** Schritt nach dem Laden, z. B. ein Tab, der keine eigene Adresse hat. */
  vorbereiten?: (page: Page) => Promise<void>;
  ziele: Ziel[];
}

const inMain = (page: Page) => page.locator('main');
const knopf = (name: string | RegExp) => (page: Page) =>
  inMain(page).getByRole('button', { name, exact: typeof name === 'string' });
/** Ein Segment der `Segmentleiste` ist ein `<button role="radio">` (bzw. `tab`). */
const segment =
  (name: RegExp, rolle: 'radio' | 'tab' = 'radio') =>
  (page: Page) =>
    inMain(page).getByRole(rolle, { name });

async function messeZiel(page: Page, ziel: Ziel, dichte: 'kompakt' | 'handschuh', soll: number) {
  const name = `${ziel.sorte} (${dichte})`;
  const knoten = ziel.ziele(page);
  await expect(knoten.first(), `${name}: Ziel steht`).toBeVisible();
  if (ziel.kurz) {
    return (await kurzeAchseHaelt(knoten, BODEN_KLEIN[dichte], name, ziel.mindestens)).kleinstes;
  }
  return alleHaltenStufe(knoten, soll, name, ziel.mindestens);
}

/**
 * Misst alle Flächen in `kompakt` und `handschuh` und legt danach die Gegenprobe je Zielsorte
 * fest. Die Stufe wird auf der ersten Fläche gestellt (Neuladen); die übrigen erben sie.
 */
async function messeFlaechen(page: Page, flaechen: Flaeche[]) {
  const je = new Map<string, number>();
  const notiz: string[] = [];
  for (const { dichte, soll } of STUFEN) {
    for (const [i, f] of flaechen.entries()) {
      await page.goto(f.pfad);
      if (i === 0) await stelleDichte(page, dichte);
      await expect(f.anker(page), `${f.pfad}: Datenanker`).toBeVisible();
      await f.vorbereiten?.(page);
      for (const ziel of f.ziele) {
        const kleinstes = await messeZiel(page, ziel, dichte, soll);
        je.set(`${dichte} ${ziel.sorte}`, kleinstes);
        notiz.push(`${dichte} ${ziel.sorte}: ${kleinstes}`);
      }
    }
  }
  for (const f of flaechen) {
    for (const ziel of f.ziele) if (!ziel.ohneGegenprobe) gegenprobe(je, ziel.sorte);
  }
  test.info().annotations.push({ type: 'messwert', description: notiz.join(' | ') });
}

/** Der Rollenzweig als Vorbedingung: die Schreibaktion fehlt ODER steht gesperrt. */
type Rollenzweig =
  | { fehlt: (page: Page) => Locator; gesperrt?: never }
  | { gesperrt: (page: Page) => Locator; fehlt?: never };

/** Nur `handschuh`, für das Rollen-Geschwister: Vorbedingung, dann Messung. */
async function messeImRollenzweig(page: Page, flaechen: (Flaeche & Rollenzweig)[]) {
  for (const [i, f] of flaechen.entries()) {
    await page.goto(f.pfad);
    if (i === 0) await stelleDichte(page, 'handschuh');
    await expect(f.anker(page), `${f.pfad}: Datenanker`).toBeVisible();
    await f.vorbereiten?.(page);
    if (f.fehlt) {
      await expect(f.fehlt(page), `${f.pfad}: Vorbedingung — die Schreibaktion fehlt`).toHaveCount(
        0,
      );
    } else {
      await expect(
        f.gesperrt(page),
        `${f.pfad}: Vorbedingung — die Schreibaktion ist gesperrt`,
      ).toBeDisabled();
    }
    for (const ziel of f.ziele) await messeZiel(page, ziel, 'handschuh', HANDSCHUH);
  }
}

async function seed<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

test.beforeEach(async ({ page }) => {
  // Mehrere Flächen in zwei Stufen, je mit Neuladen: das Vorgabebudget reicht nicht.
  test.setTimeout(180_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
});

// ── C7 · ETB (LFH-342) ─────────────────────────────────────────────────────────────────
// Slash-Menü, Zeilenauslöser und Zeilenmenü misst LFH-373 in `gate3-trefflaeche.spec.ts`;
// hier die Schnellerfassung und der Entwurfstab.

function etbFlaeche(einsatzId: string): Flaeche {
  return {
    pfad: `/einsaetze/${einsatzId}/etb`,
    anker: (page) => inMain(page).getByText('Lage ruhig, keine Besonderheiten').first(),
    ziele: [
      { sorte: 'ETB Erfassen', ziele: knopf('Erfassen'), mindestens: 1 },
      {
        sorte: 'ETB Textfeld',
        ziele: (page) => inMain(page).getByPlaceholder(/^Inhalt/),
        mindestens: 1,
        ohneGegenprobe: true,
      },
      {
        sorte: 'ETB Entwurfstab',
        ziele: (page) => inMain(page).locator('.ant-tabs-tab'),
        mindestens: 1,
      },
      {
        sorte: 'ETB Entwurfstab schließen',
        ziele: (page) => inMain(page).locator('.ant-tabs-tab-remove'),
        mindestens: 1,
        kurz: true,
      },
    ],
  };
}

test('C7 · ETB: Schnellerfassung und Entwurfstab halten 72 px, kompakt bleibt kleiner', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 Etb ${Date.now()}`);
  await anlegen(
    page,
    einsatzId,
    'etb',
    { typ: 'meldung', inhalt: 'Lage ruhig, keine Besonderheiten', von: 'EL', an: 'S2' },
    'ETB-Eintrag',
  );
  await messeFlaechen(page, [etbFlaeche(einsatzId)]);
});

// ── C8 · Kommunikation (LFH-343) ───────────────────────────────────────────────────────

async function kommunikationSaeen(page: Page, einsatzId: string) {
  const E = `/api/einsaetze/${einsatzId}`;
  await seed(page, `${E}/meldungen`, {
    absender: 'Florian Nord 1',
    meldeweg: 'funk',
    inhalt: 'Brücke Nord gesperrt',
    ereigniszeit: new Date().toISOString(),
  });
  await seed(page, `${E}/erinnerungen`, {
    titel: 'Lagemeldung an die Leitstelle',
    faellig_at: '2030-01-01 10:00',
  });
  await seed(page, `${E}/nachforderungen`, {
    art: 'Fahrzeug',
    bezeichnung: 'RTW',
    adressat_kategorie: 'leitstelle',
  });
  await seed(page, `${E}/auftraege`, {
    auftrag_text: 'Erkundung Brücke Nord',
    empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EL' }],
  });
  await seed(page, `${E}/befehle`, { vorlage: 'befehl_ladef', titel: 'Befehl Brücke Nord' });
  const kanaele = (await (await page.request.get(`${E}/chat/kanaele`)).json()) as { id: number }[];
  await seed(page, `${E}/chat/kanaele/${kanaele[0].id}/nachrichten`, { inhalt: 'Funkprobe' });
}

function kommunikationFlaechen(einsatzId: string): Flaeche[] {
  const R = `/einsaetze/${einsatzId}`;
  return [
    {
      pfad: `${R}/meldungen`,
      anker: (page) => inMain(page).getByText('Brücke Nord gesperrt').first(),
      ziele: [
        { sorte: 'Meldung erfassen', ziele: knopf('Meldung erfassen'), mindestens: 1 },
        { sorte: 'Meldung sichten', ziele: knopf('Sichten'), mindestens: 1 },
        {
          sorte: 'Meldung Aktionen',
          ziele: knopf(/^Aktionen zu Meldung/),
          mindestens: 1,
          kurz: true,
        },
        {
          sorte: 'Meldung Bearbeiter',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 1,
        },
      ],
    },
    {
      pfad: `${R}/erinnerungen`,
      anker: (page) => inMain(page).getByText('Lagemeldung an die Leitstelle').first(),
      ziele: [
        { sorte: 'Erinnerung anlegen', ziele: knopf('Erinnerung anlegen'), mindestens: 1 },
        { sorte: 'Erinnerung Karte', ziele: knopf(/^(Quittieren|Erledigt)$/), mindestens: 2 },
      ],
    },
    {
      pfad: `${R}/nachforderungen`,
      anker: (page) => inMain(page).getByText('RTW').first(),
      ziele: [
        { sorte: 'Nachforderung anlegen', ziele: knopf('Nachforderung anlegen'), mindestens: 1 },
        { sorte: 'Nachforderung Karte', ziele: knopf(/^(→ Zugesagt|Ablehnen)$/), mindestens: 2 },
      ],
    },
    {
      pfad: `${R}/auftraege`,
      anker: (page) => inMain(page).getByText('Erkundung Brücke Nord').first(),
      ziele: [
        {
          sorte: 'Aufträge Tabs',
          ziele: (page) => inMain(page).locator('.ant-tabs-tab'),
          mindestens: 2,
        },
        { sorte: 'Auftrag erteilen', ziele: knopf('Auftrag erteilen'), mindestens: 1 },
        {
          sorte: 'Auftrag Karte',
          ziele: knopf(/^(In Bearbeitung|Vollzug melden|Empfang für .* quittieren)$/),
          mindestens: 3,
        },
        {
          sorte: 'Auftrag Befehlsdetails',
          ziele: (page) => inMain(page).locator('.ant-collapse-header'),
          mindestens: 1,
        },
      ],
    },
    {
      pfad: `${R}/auftraege`,
      anker: (page) => inMain(page).getByRole('tab', { name: /Befehle/ }),
      vorbereiten: async (page) => {
        await inMain(page)
          .getByRole('tab', { name: /Befehle/ })
          .click();
        await expect(inMain(page).getByText('Befehl Brücke Nord').first()).toBeVisible();
      },
      ziele: [
        { sorte: 'Befehl erteilen', ziele: knopf('Befehl erteilen'), mindestens: 1 },
        {
          sorte: 'Befehl Karte',
          ziele: (page) => inMain(page).getByRole('link', { name: 'Befehl Brücke Nord' }),
          mindestens: 1,
        },
      ],
    },
    {
      pfad: `${R}/chat`,
      anker: (page) => inMain(page).getByText('Funkprobe').first(),
      ziele: [
        { sorte: 'Chat Senden', ziele: knopf('Senden'), mindestens: 1 },
        {
          sorte: 'Chat Eingabe',
          ziele: (page) => inMain(page).getByPlaceholder('Nachricht…'),
          mindestens: 1,
        },
      ],
    },
  ];
}

test('C8 · Kommunikation: Kopfaktionen, Kartenaktionen, Tabs und Chat halten 72 px, kompakt bleibt kleiner', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 Komm ${Date.now()}`);
  await kommunikationSaeen(page, einsatzId);
  await messeFlaechen(page, kommunikationFlaechen(einsatzId));
});

test('C8 · Kommunikation (Beobachter): Schreibaktionen fehlen, was bleibt, hält 72 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 KommB ${Date.now()}`);
  await kommunikationSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  const R = `/einsaetze/${einsatzId}`;
  await messeImRollenzweig(page, [
    {
      pfad: `${R}/meldungen`,
      anker: (page) => inMain(page).getByText('Brücke Nord gesperrt').first(),
      fehlt: knopf('Meldung erfassen'),
      ziele: [{ sorte: 'Meldung Filter', ziele: segment(/^Offen/), mindestens: 1 }],
    },
    {
      pfad: `${R}/auftraege`,
      anker: (page) => inMain(page).getByText('Erkundung Brücke Nord').first(),
      fehlt: knopf('Auftrag erteilen'),
      ziele: [
        {
          sorte: 'Aufträge Tabs',
          ziele: (page) => inMain(page).locator('.ant-tabs-tab'),
          mindestens: 2,
        },
        {
          sorte: 'Auftrag Befehlsdetails',
          ziele: (page) => inMain(page).locator('.ant-collapse-header'),
          mindestens: 1,
        },
      ],
    },
  ]);
});

// ── C10 · Einsatz-Einstellungen, Einsatzdaten, Profil, Anzeige (LFH-345) ──────────────

function einstellungenFlaechen(einsatzId: string): Flaeche[] {
  const R = `/einsaetze/${einsatzId}`;
  const sektionen = {
    sorte: 'Einstellungen Sektionen',
    ziele: segment(/^(Allgemein|Verhalten & Automatik|Aufbewahrung|Module|Pegel)$/, 'tab'),
    mindestens: 5,
  };
  const speichern = (sorte: string): Ziel => ({ sorte, ziele: knopf('Speichern'), mindestens: 1 });
  return [
    {
      pfad: `${R}/einstellungen/allgemein`,
      anker: knopf('Speichern'),
      ziele: [
        sektionen,
        {
          sorte: 'Allgemein Auswahl',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 5,
        },
        speichern('Allgemein Speichern'),
      ],
    },
    {
      pfad: `${R}/einstellungen/verhalten`,
      anker: knopf('Speichern'),
      ziele: [
        {
          sorte: 'Verhalten Zahlfelder',
          ziele: (page) => inMain(page).locator('.ant-input-number'),
          mindestens: 4,
        },
        speichern('Verhalten Speichern'),
      ],
    },
    {
      pfad: `${R}/einstellungen/aufbewahrung`,
      anker: knopf('Frist ändern'),
      ziele: [{ sorte: 'Aufbewahrung Frist', ziele: knopf('Frist ändern'), mindestens: 1 }],
    },
    {
      pfad: `${R}/einstellungen/module`,
      anker: (page) => inMain(page).getByRole('switch', { name: 'Sichtbar: ETB' }),
      ziele: [
        {
          sorte: 'Module Schalter',
          ziele: (page) => inMain(page).getByRole('switch'),
          mindestens: 20,
        },
        {
          sorte: 'Module Rolle',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 20,
        },
      ],
    },
    {
      pfad: `${R}/einstellungen/pegel`,
      anker: knopf('Hinzufügen'),
      ziele: [
        {
          sorte: 'Pegel Station',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 1,
        },
        { sorte: 'Pegel Hinzufügen', ziele: knopf('Hinzufügen'), mindestens: 1 },
      ],
    },
    {
      pfad: `${R}/einsatzdaten`,
      anker: knopf('Bearbeiten'),
      ziele: [
        {
          sorte: 'Einsatzdaten Bearbeiten',
          ziele: knopf(/( eintragen| bearbeiten|^Bearbeiten)$/),
          mindestens: 5,
        },
        {
          sorte: 'Einsatzdaten Technische Angaben',
          ziele: (page) => inMain(page).locator('.ant-collapse-header'),
          mindestens: 1,
        },
      ],
    },
    {
      pfad: '/profil',
      anker: knopf('Passwort ändern'),
      ziele: [
        {
          sorte: 'Profil Aktionen',
          ziele: knopf(/^(Passwort ändern|2FA einrichten)$/),
          mindestens: 2,
        },
      ],
    },
    {
      pfad: '/admin/einstellungen/anzeige',
      anker: knopf('Speichern'),
      ziele: [
        {
          sorte: 'Anzeige Auswahl',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 4,
        },
        speichern('Anzeige Speichern'),
      ],
    },
  ];
}

test('C10 · Einstellungen, Einsatzdaten, Profil und Anzeige halten 72 px, kompakt bleibt kleiner', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 Einst ${Date.now()}`);
  await messeFlaechen(page, einstellungenFlaechen(einsatzId));
});

test('C10 · Einsatzdaten (Beobachter): Bearbeiten fehlt, der Akkordeon-Kopf hält 72 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 EinstB ${Date.now()}`);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await messeImRollenzweig(page, [
    {
      pfad: `/einsaetze/${einsatzId}/einsatzdaten`,
      anker: (page) => inMain(page).locator('.ant-collapse-header').first(),
      fehlt: knopf('Bearbeiten'),
      ziele: [
        {
          sorte: 'Einsatzdaten Technische Angaben',
          ziele: (page) => inMain(page).locator('.ant-collapse-header'),
          mindestens: 1,
        },
      ],
    },
  ]);
});

// ── C11 · Verwaltung (LFH-346) ─────────────────────────────────────────────────────────
// Tabelle 1 (Katalogseite) misst `verwaltung-vereinheitlicht.spec.ts` mit dritter Stufe.

function verwaltungFlaechen(fahrzeugId: number): Flaeche[] {
  return [
    {
      pfad: `/admin/stammdaten/fahrzeuge/${fahrzeugId}`,
      anker: knopf('Speichern'),
      ziele: [
        {
          sorte: 'Fahrzeug Textfelder',
          ziele: (page) => inMain(page).locator('input.ant-input'),
          mindestens: 4,
        },
        {
          sorte: 'Fahrzeug Auswahl',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 3,
        },
        {
          sorte: 'Fahrzeug Zahlfelder',
          ziele: (page) => inMain(page).locator('.ant-input-number'),
          mindestens: 4,
        },
        { sorte: 'Fahrzeug Speichern', ziele: knopf('Speichern'), mindestens: 1 },
      ],
    },
    {
      pfad: '/admin/einstellungen/einsatz',
      anker: knopf('Speichern'),
      ziele: [
        {
          sorte: 'Vorgaben Rolle',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 20,
        },
        { sorte: 'Vorgaben Speichern', ziele: knopf('Speichern'), mindestens: 1 },
      ],
    },
  ];
}

test('C11 · Fahrzeug-Detail und Einsatz-Vorgaben halten 72 px, kompakt bleibt kleiner', async ({
  page,
}) => {
  const fahrzeug = await seed(page, '/api/fahrzeuge', {
    funkrufname: `E2E 724 Florian ${Date.now()}`,
    fahrzeugtyp: 'LF 20',
    kennzeichen: 'X-YZ 724',
  });
  await messeFlaechen(page, verwaltungFlaechen(fahrzeug.id));
});

test('C11 · Einsatz-Vorgaben (Führungskraft): Speichern ist gesperrt, Modulzeilen und der gesperrte Knopf halten 72 px', async ({
  page,
}) => {
  await wechsleZuRolle(page, 'fuehrungskraft');
  await messeImRollenzweig(page, [
    {
      pfad: '/admin/einstellungen/einsatz',
      anker: (page) => inMain(page).locator('.ant-select').first(),
      gesperrt: knopf('Speichern'),
      ziele: [
        {
          sorte: 'Vorgaben Rolle',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 20,
        },
        { sorte: 'Vorgaben Speichern', ziele: knopf('Speichern'), mindestens: 1 },
      ],
    },
  ]);
});

// ── C12 · Einsatzabschnitte und Bereitstellungsraum (LFH-347) ─────────────────────────

async function gliederungSaeen(page: Page, einsatzId: string) {
  const E = `/api/einsaetze/${einsatzId}`;
  const nord = await seed(page, `${E}/abschnitte`, { name: 'Abschnitt Nord' });
  await seed(page, `${E}/abschnitte`, { name: 'UA Nord 1', ueber_abschnitt_id: nord.id });
  await seed(page, `${E}/einheiten`, { name: 'Zug 1', abschnitt_id: nord.id });
  await seed(page, `${E}/einheiten`, { name: 'Zug frei' });
  await seed(page, `${E}/fahrzeuge`, { adhoc: { funkrufname: 'Florian Süd 2' } });
  const br = await seed(page, `${E}/bereitstellungsraeume`, { bezeichnung: 'BR Sportplatz' });
  await seed(page, `${E}/bereitstellungsraeume`, { bezeichnung: 'BR Schule' });
  const status = await page.request.post(`${E}/bereitstellungsraeume/${br.id}/status`, {
    data: { status: 'aktiv' },
  });
  return { abschnittId: nord.id, brId: br.id, brAktiv: status.ok() };
}

function gliederungFlaechen(einsatzId: string, abschnittId: number, brId: number): Flaeche[] {
  const R = `/einsaetze/${einsatzId}`;
  return [
    {
      pfad: `${R}/einsatzabschnitte?abschnitt=${abschnittId}`,
      anker: (page) => inMain(page).locator('.ant-tree-node-content-wrapper').first(),
      ziele: [
        {
          sorte: 'Baumknoten',
          ziele: (page) => inMain(page).locator('.ant-tree-node-content-wrapper'),
          mindestens: 2,
        },
        {
          sorte: 'Baum Aufklapper',
          ziele: (page) => inMain(page).locator('.ant-tree-switcher'),
          mindestens: 1,
          kurz: true,
        },
        {
          sorte: 'Abschnitt Detailaktionen',
          ziele: knopf(/^(Bearbeiten|Auflösen)$/),
          mindestens: 2,
        },
      ],
    },
    {
      pfad: `${R}/bereitstellungsraeume/${brId}`,
      anker: (page) => inMain(page).getByTestId('kraefte-ohne-br'),
      ziele: [
        { sorte: 'BR Raumwechsler', ziele: knopf('BR Sportplatz'), mindestens: 1 },
        { sorte: 'BR zuweisen', ziele: knopf('zuweisen'), mindestens: 2 },
      ],
    },
  ];
}

test('C12 · Gliederung und Bereitstellungsraum halten 72 px, kompakt bleibt kleiner', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 Glied ${Date.now()}`);
  const { abschnittId, brId, brAktiv } = await gliederungSaeen(page, einsatzId);
  expect(brAktiv, 'Vorbedingung: der BR ist in Betrieb, sonst fehlen die Zuweisungen').toBe(true);
  await messeFlaechen(page, gliederungFlaechen(einsatzId, abschnittId, brId));
});

test('C12 · Gliederung und Bereitstellungsraum (Beobachter): Schreibaktionen fehlen, was bleibt, hält 72 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 GliedB ${Date.now()}`);
  const { brId } = await gliederungSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  const R = `/einsaetze/${einsatzId}`;
  await messeImRollenzweig(page, [
    {
      pfad: `${R}/einsatzabschnitte`,
      anker: (page) => inMain(page).locator('.ant-tree-node-content-wrapper').first(),
      fehlt: knopf('Abschnitt anlegen'),
      ziele: [
        {
          sorte: 'Baumknoten',
          ziele: (page) => inMain(page).locator('.ant-tree-node-content-wrapper'),
          mindestens: 2,
        },
      ],
    },
    {
      pfad: `${R}/bereitstellungsraeume/${brId}`,
      anker: (page) => inMain(page).getByTestId('kraefte-ohne-br'),
      fehlt: knopf('zuweisen'),
      ziele: [{ sorte: 'BR Raumwechsler', ziele: knopf('BR Sportplatz'), mindestens: 1 }],
    },
  ]);
});

// ── C13 · Lagebericht und Lagemeldungen (LFH-348) ─────────────────────────────────────

async function lageSaeen(page: Page, einsatzId: string) {
  const E = `/api/einsaetze/${einsatzId}`;
  const bericht = await seed(page, `${E}/lageberichte`, {
    vorlage: 'lagebeurteilung',
    titel: 'Lagevortrag zur Entscheidung 1000',
  });
  const meldung = await seed(page, `${E}/meldungen`, {
    absender: 'Florian Nord 1',
    meldeweg: 'funk',
    inhalt: 'Brücke Nord gesperrt, Umleitung über die B12',
    ereigniszeit: new Date().toISOString(),
  });
  await seed(page, `${E}/meldungen/${meldung.id}/lagerelevant`, { lat: 50.11, lon: 8.68 });
  return bericht.id;
}

function lageFlaechen(einsatzId: string, berichtId: number): Flaeche[] {
  const R = `/einsaetze/${einsatzId}`;
  return [
    {
      pfad: `${R}/lageberichte/${berichtId}`,
      anker: knopf('Freigeben'),
      ziele: [
        {
          sorte: 'Lagebericht Abschnittsköpfe',
          ziele: (page) => inMain(page).locator('.ant-collapse-header'),
          mindestens: 8,
        },
        {
          sorte: 'Lagebericht Kopfaktionen',
          ziele: knopf(/^(Entwurf speichern|Freigeben)$/),
          mindestens: 2,
        },
      ],
    },
    {
      pfad: `${R}/lageberichte`,
      anker: (page) =>
        inMain(page).getByRole('link', { name: 'Lagevortrag zur Entscheidung 1000' }),
      ziele: [
        { sorte: 'Berichtsliste Neuer Bericht', ziele: knopf('Neuer Bericht'), mindestens: 1 },
        {
          sorte: 'Berichtsliste Karte',
          ziele: (page) =>
            inMain(page).getByRole('link', { name: 'Lagevortrag zur Entscheidung 1000' }),
          mindestens: 1,
        },
      ],
    },
    {
      pfad: `${R}/lagemeldungen`,
      anker: (page) =>
        inMain(page)
          .getByText(/Brücke Nord gesperrt/)
          .first(),
      ziele: [
        {
          sorte: 'Lagemeldungen Filter',
          ziele: segment(
            /^(Alle|Letzte Stunde|Letzte 4 Stunden|Heute|Alle Orte|Mit Koordinaten|Ohne Koordinaten)$/,
          ),
          mindestens: 7,
        },
        {
          sorte: 'Lagemeldungen Suche',
          ziele: (page) => inMain(page).locator('.ant-input-affix-wrapper'),
          mindestens: 1,
        },
      ],
    },
  ];
}

test('C13 · Lagebericht, Berichtsliste und Lagemeldungen halten 72 px, kompakt bleibt kleiner', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 Lage ${Date.now()}`);
  const berichtId = await lageSaeen(page, einsatzId);
  await messeFlaechen(page, lageFlaechen(einsatzId, berichtId));
});

test('C13 · Lagebericht (Beobachter): Freigeben fehlt, der Lesezweig hält 72 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 LageB ${Date.now()}`);
  const berichtId = await lageSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await messeImRollenzweig(page, [
    {
      pfad: `/einsaetze/${einsatzId}/lageberichte/${berichtId}`,
      // Der Lesezweig rendert ohne Akkordeon (`LageberichtDetailPage`: nur Entwurf UND
      // Schreibrecht zeigen das Formular); es bleibt die Druckaktion.
      anker: (page) => inMain(page).getByText('Zeitstand:'),
      fehlt: knopf('Freigeben'),
      ziele: [{ sorte: 'Lagebericht Drucken', ziele: knopf('Drucken / als PDF'), mindestens: 1 }],
    },
  ]);
});
