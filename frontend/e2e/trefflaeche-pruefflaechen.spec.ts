import { expect, test, type Locator, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';
import {
  FUEKW,
  STAFFEL,
  SUBPIXEL,
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
 * (`trefflaeche-tablet.spec.ts`). Herleitung: D5 und D8 in
 * `openspec/changes/archive/2026-10-01-lfh-724-dichtestufe-aus-dem-geraet/design.md`.
 *
 * ZIELE WERDEN BENANNT, NICHT GEFEGT: jede Zielsorte nennt ihre Knoten über Rolle, Name oder
 * die antd-Hülle (`.ant-select`, `.ant-input-number`, nicht deren inneres `input`) und fordert
 * eine Mindestzahl. Bewusst NICHT gemessen und je in einem Folgeticket: die Brotkrume (LFH-909)
 * und beschriftete Checkboxen (LFH-907). Kennungs-Links (LFH-908) misst C13 an der Zeitachse der
 * Lagemeldungen, den Funkrufname-Link der Katalogtabelle `verwaltung-vereinheitlicht.spec.ts`. Das
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
  /**
   * Obergrenze je Stufe, wo ein zu großes Ziel einen Nachbarn bricht: der Kartentab trägt
   * `cardHeight` = 1,25 × Steuerhöhe; höher risse er den Deckel der ETB-Erfassungsleiste.
   */
  deckel?: { kompakt: number; handschuh: number };
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
  const kleinstes = ziel.kurz
    ? (await kurzeAchseHaelt(knoten, BODEN_KLEIN[dichte], name, ziel.mindestens)).kleinstes
    : await alleHaltenStufe(knoten, soll, name, ziel.mindestens);
  if (ziel.deckel) {
    const deckel = ziel.deckel[dichte];
    for (let i = 0; i < (await knoten.count()); i += 1) {
      const hoehe = (await knoten.nth(i).boundingBox())!.height;
      expect(hoehe, `${name} #${i + 1}: höchstens ${deckel} px hoch`).toBeLessThanOrEqual(
        deckel + SUBPIXEL,
      );
    }
  }
  return kleinstes;
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

/**
 * Der Rollenzweig als Vorbedingung, VOR der Messung: die Schreibaktion fehlt ODER steht
 * gesperrt. Ein `toHaveCount(0)` allein wäre auch grün, solange die Rechte noch nicht geladen
 * sind — deshalb erst zwei Positivanker: das Benutzermenü nennt die gewechselte Person, und auf
 * einer Einsatzroute steht die Statusmarke des Einsatzes im Kopf (sie lebt aus derselben
 * Einsatz-Abfrage wie `darfImEinsatzSchreiben`). Wo die Seite einen Rechtehinweis trägt, wird
 * sein Text verlangt (`hinweis`); die gemessenen Modulseiten nutzen `RechteHinweis` nicht.
 */
type Rollenzweig = { hinweis?: RegExp } & (
  | { fehlt: (page: Page) => Locator; gesperrt?: never }
  | { gesperrt: (page: Page) => Locator; fehlt?: never }
);

/** Nur `handschuh`, für das Rollen-Geschwister: Vorbedingung, dann Messung. */
async function messeImRollenzweig(
  page: Page,
  rolle: 'beobachter' | 'fuehrungskraft',
  flaechen: (Flaeche & Rollenzweig)[],
) {
  for (const [i, f] of flaechen.entries()) {
    await page.goto(f.pfad);
    if (i === 0) await stelleDichte(page, 'handschuh');
    await expect(f.anker(page), `${f.pfad}: Datenanker`).toBeVisible();
    await f.vorbereiten?.(page);
    await expect(
      page.getByRole('button', { name: 'Benutzermenü' }),
      `${f.pfad}: Vorbedingung — die Sitzung gehört der Rolle ${rolle}`,
    ).toContainText(`E2E ${rolle}`);
    if (f.pfad.startsWith('/einsaetze/')) {
      await expect(
        page.getByRole('banner').getByRole('img', { name: /^Einsatzstatus:/ }),
        `${f.pfad}: Vorbedingung — der Einsatz und damit die Rechte sind geladen`,
      ).toBeVisible();
    }
    if (f.hinweis) {
      await expect(
        page.getByRole('alert').filter({ hasText: f.hinweis }),
        `${f.pfad}: Vorbedingung — der Rechtehinweis steht`,
      ).toBeVisible();
    }
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
        deckel: { kompakt: 37.5, handschuh: 90 },
      },
      {
        sorte: 'ETB Entwurfstab schließen',
        // Gemessen wird die Trefffläche selbst, das Kind des Knopfs (`entfernenStil`).
        ziele: (page) => inMain(page).locator('.ant-tabs-tab-remove > span'),
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

test('C7 · ETB (Beobachter): die Schnellerfassung fehlt, der Typfilter hält 72 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 EtbB ${Date.now()}`);
  await anlegen(
    page,
    einsatzId,
    'etb',
    { typ: 'meldung', inhalt: 'Lage ruhig, keine Besonderheiten', von: 'EL', an: 'S2' },
    'ETB-Eintrag',
  );
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await messeImRollenzweig(page, 'beobachter', [
    {
      pfad: `/einsaetze/${einsatzId}/etb`,
      anker: (page) => inMain(page).getByText('Lage ruhig, keine Besonderheiten').first(),
      fehlt: knopf('Erfassen'),
      ziele: [
        {
          sorte: 'ETB Typfilter',
          ziele: segment(/^(Alle|Meldung|Anordnung|Entscheidung|Lage|Berichtigung)$/),
          mindestens: 6,
        },
      ],
    },
  ]);
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
  const filter = { sorte: 'Filter', ziele: segment(/^Offen/), mindestens: 1 };
  await messeImRollenzweig(page, 'beobachter', [
    {
      pfad: `${R}/meldungen`,
      anker: (page) => inMain(page).getByText('Brücke Nord gesperrt').first(),
      fehlt: knopf('Meldung erfassen'),
      ziele: [filter],
    },
    {
      pfad: `${R}/erinnerungen`,
      anker: (page) => inMain(page).getByText('Lagemeldung an die Leitstelle').first(),
      fehlt: knopf('Erinnerung anlegen'),
      ziele: [filter],
    },
    {
      pfad: `${R}/nachforderungen`,
      anker: (page) => inMain(page).getByText('RTW').first(),
      fehlt: knopf('Nachforderung anlegen'),
      ziele: [filter],
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
    {
      pfad: `${R}/auftraege`,
      anker: (page) => inMain(page).getByRole('tab', { name: /Befehle/ }),
      vorbereiten: async (page) => {
        await inMain(page)
          .getByRole('tab', { name: /Befehle/ })
          .click();
        await expect(inMain(page).getByText('Befehl Brücke Nord').first()).toBeVisible();
      },
      fehlt: knopf('Befehl erteilen'),
      ziele: [
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
      hinweis: /^Schreiben ist der Einsatzleitung und dem Führungspersonal vorbehalten/,
      fehlt: knopf('Senden'),
      // Die Eingabe weicht dem Hinweis; der Zweig wird als Vorbedingung belegt, ein eigenes
      // Bedienziel bleibt im Nachrichtenbereich nicht.
      ziele: [],
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

test('C10 · Einstellungen und Einsatzdaten (Beobachter): Schreibaktionen fehlen oder sind gesperrt, was bleibt, hält 72 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 EinstB ${Date.now()}`);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  const R = `/einsaetze/${einsatzId}`;
  await messeImRollenzweig(page, 'beobachter', [
    {
      pfad: `${R}/einstellungen/allgemein`,
      anker: segment(/^Allgemein$/, 'tab'),
      hinweis:
        /^Nur die Einsatzleitung, Führungspersonal oder ein System-Admin darf die Einstellungen/,
      gesperrt: knopf('Speichern'),
      ziele: [
        {
          sorte: 'Einstellungen Sektionen',
          ziele: segment(/^(Allgemein|Verhalten & Automatik|Aufbewahrung|Module|Pegel)$/, 'tab'),
          mindestens: 5,
        },
        // Gesperrt statt versteckt: ein gesperrtes Ziel ist ein sichtbares Ziel.
        { sorte: 'Einstellungen Speichern', ziele: knopf('Speichern'), mindestens: 1 },
      ],
    },
    {
      pfad: `${R}/einsatzdaten`,
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
  await messeImRollenzweig(page, 'fuehrungskraft', [
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
  await messeImRollenzweig(page, 'beobachter', [
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
        {
          // Der Deeplink zur Quellmeldung maß nackt 13 px (LFH-908). Der Deckel ist die
          // Steuerhöhe: eine eigene Polsterung höbe die Metazeile über ihre Nachbarn.
          sorte: 'Lagemeldungen Quellmeldung-Link',
          ziele: (page) => inMain(page).getByRole('link', { name: /^Meldung #\d+$/ }),
          mindestens: 1,
          deckel: { kompakt: 30, handschuh: 72 },
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

test('C13 · Lagebericht und Berichtsliste (Beobachter): Schreibaktionen fehlen, der Lesezweig hält 72 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 724 LageB ${Date.now()}`);
  const berichtId = await lageSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  const R = `/einsaetze/${einsatzId}`;
  await messeImRollenzweig(page, 'beobachter', [
    {
      pfad: `${R}/lageberichte/${berichtId}`,
      // Der Lesezweig rendert ohne Akkordeon (`LageberichtDetailPage`: nur Entwurf UND
      // Schreibrecht zeigen das Formular); es bleibt die Druckaktion.
      anker: (page) => inMain(page).getByText('Zeitstand:'),
      fehlt: knopf('Freigeben'),
      ziele: [{ sorte: 'Lagebericht Drucken', ziele: knopf('Drucken / als PDF'), mindestens: 1 }],
    },
    {
      pfad: `${R}/lageberichte`,
      anker: (page) =>
        inMain(page).getByRole('link', { name: 'Lagevortrag zur Entscheidung 1000' }),
      fehlt: knopf('Neuer Bericht'),
      ziele: [
        {
          sorte: 'Berichtsliste Karte',
          ziele: (page) =>
            inMain(page).getByRole('link', { name: 'Lagevortrag zur Entscheidung 1000' }),
          mindestens: 1,
        },
      ],
    },
  ]);
});
