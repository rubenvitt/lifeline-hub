import { expect, test, type Locator, type Page } from '@playwright/test';
import { oeffneMenue } from './menue-kern';
import { wechsleZuRolle } from './rollen-kern';
import {
  FUEKW,
  HANDSCHIRM,
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
 * eine Mindestzahl. Die Brotkrume misst `gate3-trefflaeche.spec.ts` (LFH-909, auf den
 * Stammdaten-Detailseiten LFH-1047).
 * Kennungs-Links (LFH-908) misst C13 an der Zeitachse der Lagemeldungen, den Funkrufname-Link
 * der Katalogtabelle `verwaltung-vereinheitlicht.spec.ts`. Beschriftete Checkboxen misst LFH-907
 * am ganzen Label (`label.ant-checkbox-wrapper`), nicht an der 16-px-Box. Das Löschkreuz eines
 * Auswahlfelds ist benannt ausgenommen: das Feld selbst ist das gleichwertige Ziel.
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
/**
 * Ein beschriftetes Kästchen (LFH-907): gemessen wird das LABEL, das Box und Text umschließt und
 * als Ganzes klickt; die Box allein ist `controlInteractiveSize` groß.
 */
const kaestchen = (text: string) => (page: Page) =>
  inMain(page).locator('label.ant-checkbox-wrapper').filter({ hasText: text });
const knopf = (name: string | RegExp) => (page: Page) =>
  inMain(page).getByRole('button', { name, exact: typeof name === 'string' });
/** Ein Nebenweg des Seitenkopfs mit Ziel ist ab `md` ein Link in Knopfgestalt (LFH-963). */
const nebenweg = (name: RegExp) => (page: Page) =>
  page.locator('[data-lfh="seitenkopf-aktionen"]').getByRole('link', { name });
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
 * sein Text verlangt (`hinweis`).
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
        // Rechtehinweis („Nur Ansicht · Grund“, role=status) oder ein anderer Alarm-Hinweis.
        page.locator('[role="alert"], [data-lfh="rechte-hinweis"]').filter({ hasText: f.hinweis }),
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
      { sorte: 'ETB Werte behalten', ziele: kaestchen('Werte behalten'), mindestens: 1 },
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
  // Aus einem ETB-Eintrag erteilt: erst dann trägt das Auftragsdetail seinen Sprung
  // „ETB-Eintrag ↗“ (oxgob5gk, Spec `einsatztauglichkeit-layout`: Sprünge des Detailpaneels).
  const quelle = await seed(page, `${E}/etb`, {
    typ: 'meldung',
    inhalt: 'Brücke Nord erkunden lassen',
    von: 'EL',
    an: 'S2',
  });
  await seed(page, `${E}/etb/${quelle.id}/auftrag`, {
    auftrag_text: 'Erkundung Brücke Nord',
    empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EL' }],
  });
  await seed(page, `${E}/befehle`, { vorlage: 'befehl_ladef', titel: 'Befehl Brücke Nord' });
  const kanaele = (await (await page.request.get(`${E}/chat/kanaele`)).json()) as { id: number }[];
  await seed(page, `${E}/chat/kanaele/${kanaele[0].id}/nachrichten`, { inhalt: 'Funkprobe' });
}

/*
 * Seite Aufträge im Muster „Liste + Detailpaneel“ (Change oxgob5gk, Spec
 * `einsatztauglichkeit-layout`): Ziele sind die Tabs, Status-Segmente und Suchfeld beider Reiter,
 * das Auswahlziel jeder Karte und die Handlungen und Sprünge des Detailpaneels. Die Karte selbst
 * trägt keine Handlung mehr.
 *
 * antd hält den zuerst gezeigten Reiter im DOM, verborgen mit `aria-hidden`: gemessen wird im
 * aktiven, und `getByRole` lässt den verborgenen aus.
 */
const aktiverReiter = (page: Page) => inMain(page).getByRole('tabpanel');
const detail = (page: Page) => aktiverReiter(page).locator('[data-lfh="liste-detail-detail"]');
/** Das Auswahlziel einer Karte: ein `<button>` über die ganze Kartenbreite. */
const auswahlZiel = (name: RegExp) => (page: Page) =>
  aktiverReiter(page).locator('[data-lfh="auswahl-ziel"]').and(page.getByRole('button', { name }));
const imDetail = (name: RegExp) => (page: Page) => detail(page).getByRole('button', { name });
/** Ein Sprung im Detail (LFH-616) ist ein Link mit Pfeil, kein Knopf. */
const detailSprung = (name: RegExp) => (page: Page) =>
  detail(page).locator('[data-lfh="inspector-sprung"]').and(page.getByRole('link', { name }));
/** Das Suchfeld: gemessen wird die antd-Hülle (Feld samt Löschkreuz), nicht das innere `input`. */
const suchfeld = (label: string) => (page: Page) =>
  aktiverReiter(page)
    .locator('.ant-input-affix-wrapper')
    .filter({ has: page.getByRole('textbox', { name: label }) });
const auftraegeTabs: Ziel = {
  sorte: 'Aufträge Tabs',
  ziele: (page) => inMain(page).locator('.ant-tabs-tab'),
  mindestens: 2,
};
const auftraegeFilter: Ziel[] = [
  {
    sorte: 'Aufträge Status-Segmente',
    ziele: segment(/^(Offen|Abgeschlossen) \(\d+\)$/),
    mindestens: 2,
  },
  { sorte: 'Aufträge Suche', ziele: suchfeld('Aufträge durchsuchen'), mindestens: 1 },
];
const befehleFilter: Ziel[] = [
  {
    sorte: 'Befehle Status-Segmente',
    ziele: segment(/^(Entwürfe|Freigegeben) \(\d+\)$/),
    mindestens: 2,
  },
  { sorte: 'Befehle Suche', ziele: suchfeld('Befehle durchsuchen'), mindestens: 1 },
];
/** Vorbedingung: das Detail des gewählten Objekts steht. */
const detailSteht = (text: string) => async (page: Page) => {
  await expect(detail(page)).toContainText(text);
};
async function befehleReiter(page: Page) {
  await inMain(page).getByRole('tab', { name: 'Einsatzbefehle' }).click();
  await expect(auswahlZiel(/^Befehl v1: Befehl Brücke Nord$/)(page)).toBeVisible();
  await detailSteht('Befehlstext')(page);
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
        {
          sorte: 'Erinnerung Karte',
          ziele: knopf(/^(Erübrigt \(zur Kenntnis\)|Erledigt \(durchgeführt\))$/),
          mindestens: 2,
        },
      ],
    },
    {
      pfad: `${R}/nachforderungen`,
      anker: (page) => inMain(page).getByText('RTW').first(),
      ziele: [
        { sorte: 'Nachforderung anlegen', ziele: knopf('Nachforderung anlegen'), mindestens: 1 },
        {
          sorte: 'Nachforderung Karte',
          ziele: knopf(/^(Zusage erfassen|Ablehnen)$/),
          mindestens: 2,
        },
      ],
    },
    {
      pfad: `${R}/auftraege`,
      anker: auswahlZiel(/^Auftrag #\d+: Erkundung Brücke Nord$/),
      // Ab lg ist der erste Auftrag vorgewählt; sein Detail steht rechts (Muster „Liste +
      // Detailpaneel“, oxgob5gk).
      vorbereiten: detailSteht('Erkundung Brücke Nord'),
      ziele: [
        auftraegeTabs,
        { sorte: 'Auftrag erteilen', ziele: knopf('Auftrag erteilen'), mindestens: 1 },
        ...auftraegeFilter,
        {
          sorte: 'Auftrag Auswahlziel',
          ziele: auswahlZiel(/^Auftrag #\d+: /),
          mindestens: 1,
        },
        {
          sorte: 'Auftrag Detail Handlungen',
          ziele: imDetail(/^(Bearbeitung beginnen|Vollzug melden|Empfang für .* quittieren)$/),
          mindestens: 3,
        },
        { sorte: 'Auftrag Detail Sprung', ziele: detailSprung(/^ETB-Eintrag/), mindestens: 1 },
      ],
    },
    {
      pfad: `${R}/auftraege`,
      anker: (page) => inMain(page).getByRole('tab', { name: 'Einsatzbefehle' }),
      vorbereiten: befehleReiter,
      ziele: [
        { sorte: 'Befehl entwerfen', ziele: knopf('Befehl entwerfen'), mindestens: 1 },
        ...befehleFilter,
        {
          sorte: 'Befehl Auswahlziel',
          ziele: auswahlZiel(/^Befehl v1: Befehl Brücke Nord$/),
          mindestens: 1,
        },
        {
          // „Entwurf bearbeiten“ ist ein Link in Knopfgestalt (Strg+Klick öffnet einen Tab).
          sorte: 'Befehl Detail Handlungen',
          ziele: (page) =>
            detail(page)
              .getByRole('link', { name: 'Entwurf bearbeiten', exact: true })
              .or(detail(page).getByRole('button', { name: 'Freigeben', exact: true })),
          mindestens: 2,
        },
        { sorte: 'Befehl Detail Sprung', ziele: detailSprung(/^Vollansicht/), mindestens: 1 },
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
      anker: auswahlZiel(/^Auftrag #\d+: Erkundung Brücke Nord$/),
      vorbereiten: detailSteht('Erkundung Brücke Nord'),
      // Ohne Schreibrecht weder Erfassen noch eine Handlung im Detail (Spec `auftraege-befehle`,
      // „Ohne Schreibrecht“); Empfänger, Verlauf und Sprung bleiben.
      fehlt: knopf(/^(Auftrag erteilen|Bearbeitung beginnen|Vollzug melden|Empfang für .*)$/),
      ziele: [
        auftraegeTabs,
        ...auftraegeFilter,
        { sorte: 'Auftrag Auswahlziel', ziele: auswahlZiel(/^Auftrag #\d+: /), mindestens: 1 },
        { sorte: 'Auftrag Detail Sprung', ziele: detailSprung(/^ETB-Eintrag/), mindestens: 1 },
      ],
    },
    {
      pfad: `${R}/auftraege`,
      anker: (page) => inMain(page).getByRole('tab', { name: 'Einsatzbefehle' }),
      vorbereiten: befehleReiter,
      fehlt: (page) =>
        inMain(page)
          .getByRole('button', { name: /^(Befehl entwerfen|Freigeben|Fortschreiben)$/ })
          .or(inMain(page).getByRole('link', { name: 'Entwurf bearbeiten' })),
      ziele: [
        ...befehleFilter,
        {
          sorte: 'Befehl Auswahlziel',
          ziele: auswahlZiel(/^Befehl v1: Befehl Brücke Nord$/),
          mindestens: 1,
        },
        { sorte: 'Befehl Detail Sprung', ziele: detailSprung(/^Vollansicht/), mindestens: 1 },
      ],
    },
    {
      pfad: `${R}/chat`,
      anker: (page) => inMain(page).getByText('Funkprobe').first(),
      hinweis: /nur Einsatzleitung und Führungspersonal$/,
      fehlt: knopf('Senden'),
      // Die Eingabe weicht dem Hinweis; der Zweig wird als Vorbedingung belegt, ein eigenes
      // Bedienziel bleibt im Nachrichtenbereich nicht.
      ziele: [],
    },
  ]);
});

/*
 * Liste und Detail der Aufträge auf dem Handschirm (oxgob5gk, Spec `einsatztauglichkeit-layout`,
 * „Liste und Detail der Aufträge im Handschuh-Betrieb“): unter lg ist nichts vorgewählt, die Wahl
 * klappt das Detail unter der Karte auf. Gemessen wird erst, wenn es aufgeklappt steht; die
 * Gegenprobe in `kompakt` belegt, dass die Stufe durchschlägt.
 */
test('C8 · Aufträge auf dem Handschirm: Auswahlziel und Detailknöpfe halten 72 px, kompakt bleibt kleiner', async ({
  page,
}) => {
  await page.setViewportSize(HANDSCHIRM);
  const einsatzId = await einsatzAnlegen(page, `E2E oxgob5gk Handschirm ${Date.now()}`);
  const E = `/api/einsaetze/${einsatzId}`;
  for (const auftrag_text of ['Erkundung Brücke Nord', 'Absperrung Brücke Süd']) {
    await seed(page, `${E}/auftraege`, {
      auftrag_text,
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EL' }],
    });
  }
  await messeFlaechen(page, [
    {
      pfad: `/einsaetze/${einsatzId}/auftraege`,
      anker: auswahlZiel(/^Auftrag #\d+: Erkundung Brücke Nord$/),
      vorbereiten: async (page) => {
        // Vorbedingung: unter lg ist nichts vorgewählt, das Detail steht nicht.
        await expect(detail(page)).toHaveCount(0);
        const ziel = auswahlZiel(/^Auftrag #\d+: Erkundung Brücke Nord$/)(page);
        await expect(ziel).toHaveAttribute('aria-expanded', 'false');
        await ziel.click();
        await expect(ziel).toHaveAttribute('aria-expanded', 'true');
        await detailSteht('Quittung offen')(page);
      },
      ziele: [
        { sorte: 'Handschirm Auswahlziel', ziele: auswahlZiel(/^Auftrag #\d+: /), mindestens: 2 },
        {
          sorte: 'Handschirm Quittieren',
          ziele: imDetail(/^Empfang für .* quittieren$/),
          mindestens: 1,
        },
        {
          sorte: 'Handschirm Detail Handlungen',
          ziele: imDetail(/^(Bearbeitung beginnen|Vollzug melden)$/),
          mindestens: 2,
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
      // LLH-1122: Vorgabe des Einsatzes — Auswahl aus den Stammdaten, Übernehmen, eigene Werte.
      pfad: `${R}/einstellungen/abloesung`,
      anker: knopf('Übernehmen'),
      ziele: [
        {
          sorte: 'Ablösung Schichtmodell',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 1,
        },
        { sorte: 'Ablösung Übernehmen', ziele: knopf('Übernehmen'), mindestens: 1 },
        {
          sorte: 'Ablösung eigene Werte',
          ziele: knopf(/Eigene Werte setzen|Werte ändern/),
          mindestens: 1,
        },
      ],
    },
    {
      // LFH-1170: Mitglieder, Rollen und Führungsstelle je Person, von den Einsatzdaten umgezogen.
      pfad: `${R}/einstellungen/zugriff`,
      anker: knopf('Hinzufügen'),
      ziele: [
        {
          sorte: 'Zugriff Auswahl',
          ziele: (page) => inMain(page).locator('.ant-select'),
          mindestens: 3,
        },
        { sorte: 'Zugriff Hinzufügen', ziele: knopf('Hinzufügen'), mindestens: 1 },
        {
          // Zeilenaktionen: „Entfernen“ (an der letzten Leitung gesperrt, aber sichtbar) und der
          // Link-Knopf der Führungsstelle mit eigenem Stil (`height: auto` + `minHeight`).
          sorte: 'Zugriff Zeilenaktionen',
          ziele: knopf(/^(Entfernen|Führungsstelle für .+ bearbeiten)$/),
          mindestens: 2,
        },
      ],
    },
    {
      // LFH-1170: ein Bearbeitungsweg (Zeilen), die Nebenwege im Kopf statt „Bearbeiten“.
      pfad: `${R}/einsatzdaten`,
      anker: knopf('Bezeichnung bearbeiten'),
      ziele: [
        {
          sorte: 'Einsatzdaten Zeilen',
          ziele: knopf(/( eintragen| bearbeiten)$/),
          mindestens: 5,
        },
        {
          sorte: 'Einsatzdaten Nebenwege',
          ziele: nebenweg(/^(Einsatzbericht drucken|Zugriff verwalten)/),
          mindestens: 2,
        },
      ],
    },
    {
      pfad: '/profil',
      anker: knopf('Passwort ändern'),
      ziele: [
        {
          sorte: 'Profil Aktionen',
          ziele: knopf(/^(Passwort ändern|Zweiten Faktor einrichten)$/),
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
      hinweis: /nur Einsatzleitung, Führungspersonal oder Org-Admin$/,
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
      anker: nebenweg(/^Einsatzbericht drucken/),
      hinweis: /nur Einsatzleitung, Führungspersonal oder Org-Admin$/,
      fehlt: knopf('Bezeichnung bearbeiten'),
      ziele: [
        {
          // „Zugriff verwalten“ fehlt dem Beobachter (LFH-1170); der Einsatzbericht bleibt.
          sorte: 'Einsatzdaten Nebenwege',
          ziele: nebenweg(/^(Einsatzbericht drucken|Zugriff verwalten)/),
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
  // Eine bereitgestellte Einheit trägt „Abrufen“ und das Aktionsmenü der Zeile (LLH-1085).
  const bereit = await seed(page, `${E}/einheiten`, { name: 'Zug BR' });
  if (status.ok()) {
    await seed(page, `${E}/bereitstellungsraeume/${br.id}/belegung`, {
      objekt_typ: 'einheit',
      objekt_id: bereit.id,
      art: 'eintritt',
    });
  }
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
        // Das Detail bearbeitet an der Zeile (LFH-1208): Wert- und Eintragen-Knöpfe und die Stufen
        // des Lagezustands. „Verschieben unter …“ und „Auflösen“ stehen hinter „Weitere Aktionen“
        // (LFH-1212).
        {
          sorte: 'Abschnitt Zeilen',
          ziele: knopf(/ (bearbeiten|eintragen)$/),
          mindestens: 8,
        },
        {
          sorte: 'Abschnitt Lagezustand',
          ziele: segment(/^(nicht beurteilt|planmäßig|angespannt|kritisch)$/),
          mindestens: 4,
        },
        {
          sorte: 'Abschnitt Weitere Aktionen',
          ziele: knopf(/^Weitere Aktionen zu Abschnitt .+$/),
          mindestens: 1,
        },
        {
          // Der Griff zum Umhängen ist ein Zeigerziel der Staffel (LFH-1212), kein Tastaturziel.
          sorte: 'Gliederung Griffe',
          ziele: (page) => inMain(page).locator('[data-lfh="drag-handle"]'),
          mindestens: 2,
        },
      ],
    },
    {
      pfad: `${R}/bereitstellungsraeume/${brId}`,
      anker: (page) => inMain(page).getByTestId('kraefte-ohne-br'),
      ziele: [
        { sorte: 'BR Raumwechsler', ziele: knopf('BR Sportplatz'), mindestens: 1 },
        { sorte: 'BR zuweisen', ziele: knopf(/ zuweisen$/), mindestens: 2 },
        { sorte: 'BR Abrufen', ziele: knopf('Zug BR abrufen'), mindestens: 1 },
        { sorte: 'BR Aktionsmenü', ziele: knopf('Weitere Aktionen zu Zug BR'), mindestens: 1 },
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
      // Ohne Schreibrecht fehlen Anlegen, Zeilenstifte, Stufenwahl, „Weitere Aktionen“ (LFH-1208)
      // und die Griffe zum Umhängen (LFH-1212).
      fehlt: (page) =>
        inMain(page)
          .getByRole('button', {
            name: /^Abschnitt anlegen$| (bearbeiten|eintragen)$|^Weitere Aktionen zu Abschnitt /,
          })
          .or(inMain(page).getByRole('radiogroup', { name: 'Lagezustand' }))
          .or(inMain(page).locator('[data-lfh="drag-handle"]')),
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
      fehlt: knopf(/zuweisen$|abrufen$|^Weitere Aktionen zu /),
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
        {
          sorte: 'Lagebericht Vorschau-Schalter',
          ziele: kaestchen('Vorschau neben dem Text'),
          mindestens: 1,
        },
      ],
    },
    {
      pfad: `${R}/lageberichte`,
      anker: (page) =>
        inMain(page).getByRole('link', { name: 'Lagevortrag zur Entscheidung 1000' }),
      ziele: [
        {
          sorte: 'Berichtsliste Neuer Lagevortrag',
          ziele: knopf('Neuer Lagevortrag'),
          mindestens: 1,
        },
        // Der Pfeil des geteilten Knopfs trägt kein Wort: Boden auf beiden Achsen (LLH-1064).
        {
          sorte: 'Berichtsliste Andere Vorlage',
          ziele: knopf('Andere Vorlage wählen'),
          mindestens: 1,
          kurz: true,
        },
        {
          sorte: 'Berichtsliste Entwurf',
          ziele: (page) =>
            inMain(page).getByRole('link', { name: 'Lagevortrag zur Entscheidung 1000' }),
          mindestens: 1,
        },
      ],
    },
    {
      // Das Menü am Pfeil liegt im Portal, nicht in `main`.
      pfad: `${R}/lageberichte`,
      anker: (page) =>
        inMain(page).getByRole('link', { name: 'Lagevortrag zur Entscheidung 1000' }),
      // Gemessen wird erst, wenn das Menü steht: antds `slide-up` startet mit `scaleY(0.8)`.
      vorbereiten: async (page) => {
        await oeffneMenue(page, knopf('Andere Vorlage wählen')(page));
      },
      ziele: [
        {
          sorte: 'Berichtsliste Vorlagenmenü',
          ziele: (page) =>
            page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').getByRole('menuitem'),
          mindestens: 2,
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

test('C13 · Lagebericht und Berichtsliste (Beobachter): Schreibaktionen fehlen oder sind gesperrt, der Lesezweig hält 72 px', async ({
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
      gesperrt: knopf('Neuer Lagevortrag'),
      hinweis: /nur Einsatzleitung und Führungspersonal/,
      ziele: [
        {
          sorte: 'Berichtsliste Entwurf',
          ziele: (page) =>
            inMain(page).getByRole('link', { name: 'Lagevortrag zur Entscheidung 1000' }),
          mindestens: 1,
        },
      ],
    },
  ]);
});

// ── C14 · Materialliste (LLH-1093, LLH-1225) ───────────────────────────────────────────
// Die eine Ortsangabe, „Ausgeben“, die Gruppierung und die Zeilenaktionen der Materialliste
// (Prüfliste Einsatztauglichkeit, Kriterium 2). Die Liste steht ab `md` als Tabelle.

async function materialSaeen(page: Page, einsatzId: string) {
  const E = `/api/einsaetze/${einsatzId}`;
  const einheit = await seed(page, `${E}/einheiten`, { name: 'Staffel Ost' });
  const uhs = await seed(page, `${E}/uhs`, { typ: 'behandlungsplatz', bezeichnung: 'Turnhalle' });
  const verortet = await seed(page, `${E}/material`, {
    adhoc: { bezeichnung: 'Wolldecke' },
    menge: 50,
  });
  // Ein Ort je Posten (LLH-1224): die Wolldecke bei der Einheit, das Feldbett an der UHS.
  const feldbett = await seed(page, `${E}/material`, {
    adhoc: { bezeichnung: 'Feldbett' },
    menge: 4,
  });
  const zuordnung = await page.request.put(`${E}/einheiten/${einheit.id}/material/${verortet.id}`);
  expect(zuordnung.ok(), `Einheit zuordnen: ${zuordnung.status()}`).toBe(true);
  const verortung = await page.request.patch(`${E}/material/${feldbett.id}`, {
    data: { uhs_id: uhs.id },
  });
  expect(verortung.ok(), `UHS verorten: ${verortung.status()}`).toBe(true);
}

const materialAnker = (page: Page) =>
  inMain(page).getByRole('button', { name: 'Wolldecke ausgeben' });

test('C14 · Materialliste: Ort, Ausgeben, Gruppierung und Zeilenaktionen halten 72 px, kompakt bleibt kleiner', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 1093 Material ${Date.now()}`);
  await materialSaeen(page, einsatzId);
  await messeFlaechen(page, [
    {
      pfad: `/einsaetze/${einsatzId}/material`,
      anker: materialAnker,
      ziele: [
        {
          sorte: 'Material Ort',
          ziele: knopf(/^Ort zu (Wolldecke|Feldbett) bearbeiten$/),
          mindestens: 2,
        },
        { sorte: 'Material Ausgeben', ziele: knopf(/^.+ ausgeben$/), mindestens: 2 },
        {
          sorte: 'Material gruppieren',
          ziele: segment(/^Nach (Ort|Status)$/),
          mindestens: 2,
        },
        {
          sorte: 'Material aus dem Einsatz nehmen',
          ziele: knopf(/^.+ aus dem Einsatz nehmen$/),
          mindestens: 2,
        },
        {
          sorte: 'Material Weitere Aktionen',
          ziele: knopf(/^Weitere Aktionen zu .+$/),
          mindestens: 2,
          kurz: true,
        },
      ],
    },
  ]);
});

test('C14 · Materialliste (Beobachter): Schreibaktionen fehlen, die Ort-Links halten 72 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 1093 MaterialB ${Date.now()}`);
  await materialSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await messeImRollenzweig(page, 'beobachter', [
    {
      pfad: `/einsaetze/${einsatzId}/material`,
      anker: (page) => inMain(page).getByRole('link', { name: 'Staffel Ost' }),
      fehlt: (page) =>
        inMain(page).getByRole('button', {
          name: / (bearbeiten|ausgeben|aus dem Einsatz nehmen)$|^Weitere Aktionen zu /,
        }),
      ziele: [
        {
          sorte: 'Material Ort-Links',
          ziele: (page) =>
            inMain(page).getByRole('link', { name: /^(Staffel Ost|UHS Turnhalle)$/ }),
          mindestens: 2,
        },
      ],
    },
  ]);
});

// ── C15 · Material am Ort (LLH-1225 Teil II) ──────────────────────────────────────────
// Derselbe Baustein an Einheit, Fahrzeug (Block „Beladung“), UHS und Bereitstellungsraum: die
// Auswahl „Material zuordnen …“ (antd-Hülle), Lösen und „Ausgeben“ je Ort (Prüfliste
// Einsatztauglichkeit der Orte, Kriterium 2).

async function materialAmOrtSaeen(page: Page, einsatzId: string) {
  const E = `/api/einsaetze/${einsatzId}`;
  const einheit = await seed(page, `${E}/einheiten`, { name: 'Staffel West' });
  const fahrzeug = await seed(page, `${E}/fahrzeuge`, { adhoc: { funkrufname: 'Florian 15' } });
  const uhs = await seed(page, `${E}/uhs`, { typ: 'behandlungsplatz', bezeichnung: 'Turnhalle' });
  const br = await seed(page, `${E}/bereitstellungsraeume`, { bezeichnung: 'BR West' });
  const orte = [
    ['Einheit', { einheit_id: einheit.id }],
    ['Fahrzeug', { einsatz_fahrzeug_id: fahrzeug.id }],
    ['UHS', { uhs_id: uhs.id }],
    ['BR', { br_id: br.id }],
  ] as const;
  // Je Ort ein Verbrauchsgut (trägt „Ausgeben“) und ein Gerät; dazu ein Posten ohne Ort fürs
  // Angebot der Auswahl.
  for (const [name, ort] of orte) {
    await seed(page, `${E}/material`, {
      adhoc: { bezeichnung: `Decken ${name}` },
      menge: 20,
      art: 'verbrauchsgut',
      ...ort,
    });
    await seed(page, `${E}/material`, { adhoc: { bezeichnung: `Trage ${name}` }, ...ort });
  }
  await seed(page, `${E}/material`, { adhoc: { bezeichnung: 'Stromerzeuger' } });
  return { einheitId: einheit.id, uhsId: uhs.id, brId: br.id };
}

/** Die Hülle des antd-Auswahlfelds „Material zuordnen“, nicht das innere Eingabefeld. */
const materialAuswahl = (page: Page) =>
  inMain(page)
    .getByRole('combobox', { name: 'Material zuordnen' })
    .locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]',
    );

function materialAmOrtFlaechen(
  einsatzId: string,
  ids: { einheitId: number; uhsId: number; brId: number },
): Flaeche[] {
  const R = `/einsaetze/${einsatzId}`;
  const ziele = (ort: string, loesen: RegExp): Ziel[] => [
    { sorte: `${ort}: Material zuordnen`, ziele: materialAuswahl, mindestens: 1 },
    { sorte: `${ort}: Material lösen`, ziele: knopf(loesen), mindestens: 2 },
    { sorte: `${ort}: Material ausgeben`, ziele: knopf(/^Decken .+ ausgeben$/), mindestens: 1 },
  ];
  return [
    {
      pfad: `${R}/einheiten/${ids.einheitId}`,
      anker: knopf('Decken Einheit ausgeben'),
      ziele: ziele('Einheit', /^(Decken|Trage) Einheit aus Einheit lösen$/),
    },
    {
      pfad: `${R}/fahrzeuge`,
      anker: knopf('Besatzung zu Florian 15'),
      vorbereiten: async (page) => {
        await knopf('Besatzung zu Florian 15')(page).click();
        await expect(knopf('Decken Fahrzeug ausgeben')(page)).toBeVisible();
      },
      ziele: ziele('Fahrzeug', /^(Decken|Trage) Fahrzeug vom Fahrzeug lösen$/),
    },
    {
      pfad: `${R}/unfallhilfsstellen/${ids.uhsId}?bereich=material`,
      anker: knopf('Decken UHS ausgeben'),
      ziele: ziele('UHS', /^(Decken|Trage) UHS lösen$/),
    },
    {
      pfad: `${R}/bereitstellungsraeume/${ids.brId}`,
      anker: knopf('Decken BR ausgeben'),
      ziele: ziele('BR', /^(Decken|Trage) BR lösen$/),
    },
  ];
}

test('C15 · Material am Ort: Auswahl, Lösen und Ausgeben halten 72 px an jedem Ort, kompakt bleibt kleiner', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 1225 Material am Ort ${Date.now()}`);
  const ids = await materialAmOrtSaeen(page, einsatzId);
  await messeFlaechen(page, materialAmOrtFlaechen(einsatzId, ids));
});

test('C15 · Material am Ort (Beobachter): Bedienung fehlt, die Posten stehen', async ({ page }) => {
  const einsatzId = await einsatzAnlegen(page, `E2E 1225 Material am OrtB ${Date.now()}`);
  const ids = await materialAmOrtSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  const R = `/einsaetze/${einsatzId}`;
  // Ohne Schreibrecht trägt der Baustein kein Bedienziel (Vorbedingung: Lösen und Ausgeben
  // fehlen); gemessen wird, was auf der Fläche bleibt: die Reiter der UHS.
  await messeImRollenzweig(page, 'beobachter', [
    {
      pfad: `${R}/unfallhilfsstellen/${ids.uhsId}?bereich=material`,
      anker: (page) => inMain(page).locator('[data-lfh="material-am-ort-zeile"]').first(),
      fehlt: (page) => inMain(page).getByRole('button', { name: / (lösen|ausgeben)$/ }),
      ziele: [
        {
          sorte: 'UHS Reiter (Beobachter)',
          ziele: segment(/^(Belegung|Material|Kräfte|Bewegungen|Dateien)$/, 'tab'),
          mindestens: 2,
        },
      ],
    },
  ]);
});

// ── Sichtungswahl (LLH-1083, Spec `sichtungswahl`, „Trefferfläche jeder Kategorie“) ─────
// Wie die Zähltaste (LLH-1032) eine Ausnahme NACH OBEN: 72 × 96 in JEDER Stufe, also keine
// Gegenprobe „kompakt bleibt kleiner“. Gemessen werden Maße und Lücke je Stufe.

test('Sichtungswahl: sechs Flächen halten 72 × 96 in kompakt und Handschuh, Lücke 8 bzw. 16 px', async ({
  page,
}) => {
  const einsatzId = await einsatzAnlegen(page, `Sichtungswahl ${Date.now()}`);
  for (const [dichte, luecke] of [
    ['kompakt', 8],
    ['handschuh', 16],
  ] as const) {
    await page.goto(`/einsaetze/${einsatzId}/personen/aufnahme`);
    await stelleDichte(page, dichte);
    const flaechen = page
      .getByRole('radiogroup', { name: 'Sichtungskategorie' })
      .getByRole('radio');
    await expect(flaechen).toHaveCount(6);
    const kaesten = await Promise.all((await flaechen.all()).map((f) => f.boundingBox()));
    for (const [i, k] of kaesten.entries()) {
      expect(k, `${dichte}/Fläche ${i}`).not.toBeNull();
      expect(k!.height + SUBPIXEL, `${dichte}/Fläche ${i}/Höhe`).toBeGreaterThanOrEqual(72);
      expect(k!.width + SUBPIXEL, `${dichte}/Fläche ${i}/Breite`).toBeGreaterThanOrEqual(96);
    }
    // Waagerechte Lücke zwischen zwei Nachbarn derselben Reihe.
    const [a, b] = [kaesten[0]!, kaesten[1]!];
    expect(Math.abs(a.y - b.y), `${dichte}: erste zwei in einer Reihe`).toBeLessThan(1);
    expect(b.x - (a.x + a.width) + SUBPIXEL, `${dichte}/Lücke`).toBeGreaterThanOrEqual(luecke);
  }
});

// ── Körperschema (LLH-1120, Spec `koerperschema`, „Jede Region ist erreichbar“) ──────────
// Jede Region hält mindestens die Steuerhöhe der Stufe, in der Handschuh-Stufe 72 px, Hand,
// Fuß und Hals sogar 72 × 72 (design.md D13: ihre Zonen reichen über die Silhouette hinaus).
// Ebenso die Trefferfläche eines Sternchens (`sternTrefferPx`). Gemessen in allen drei Stufen;
// Gegenprobe: die Hand ist in `kompakt` kleiner, die Figur folgt der Stufe (`figurMassstab`).
//
// Mutationsprobe: in `KoerperFigur.tsx` `sternTrefferPx` fest 40 → in `komfortabel` und
// `handschuh` rot am Sternchen (gemessen).

test('Körperschema: jede Region und jedes Sternchen hält die Stufe, Hand, Fuß und Hals 72 × 72 im Handschuh', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const einsatzId = await einsatzAnlegen(page, `Körperschema ${Date.now()}`);
  const r = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, {
    data: { name: 'Treffer', status: 'betroffen', sichtung: 'sk3' },
  });
  expect(r.ok(), `Person: ${r.status()}`).toBe(true);
  const pid = ((await r.json()) as { id: number }).id;
  const v = await page.request.post(`/api/einsaetze/${einsatzId}/personen/${pid}/verletzungen`, {
    data: { ansicht: 'vorn', region: 'thorax', art: 'prellung_schwellung' },
  });
  expect(v.ok(), `Verletzung: ${v.status()}`).toBe(true);

  const hand: Record<string, { width: number; height: number }> = {};
  for (const [dichte, boden] of [
    ['kompakt', 30],
    ['komfortabel', 48],
    ['handschuh', 72],
  ] as const) {
    await page.goto(`/einsaetze/${einsatzId}/personen/${pid}`);
    await stelleDichte(page, dichte);
    await page
      .getByRole('region', { name: 'Patientenkopf' })
      .getByRole('button', { name: 'Verletzung markieren' })
      .click();
    const paneel = page.getByRole('region', { name: 'Verletzung markieren' });
    // Trägt die Breite nicht beide Ansichten samt Wahl, schaltet die Umschaltung (Spec
    // `koerperschema`); dann wird jede Ansicht für sich gemessen.
    const umschaltung = paneel.getByRole('tablist', { name: 'Ansicht' });
    for (const ansicht of ['vorn', 'hinten'] as const) {
      if ((await umschaltung.count()) > 0) {
        await umschaltung.getByRole('tab', { name: ansicht }).click();
      }
      const figur = paneel.locator(`[data-lfh="koerperfigur"][data-ansicht="${ansicht}"]`);
      const zonen = figur.locator('[data-lfh="koerperzone"]');
      await expect(zonen).toHaveCount(ansicht === 'vorn' ? 18 : 17);
      for (const zone of await zonen.all()) {
        const name = await zone.getAttribute('aria-label');
        const k = await zone.boundingBox();
        expect(k, `${dichte}/${name}`).not.toBeNull();
        expect(k!.height + SUBPIXEL, `${dichte}/${name}/Höhe`).toBeGreaterThanOrEqual(boden);
        expect(k!.width + SUBPIXEL, `${dichte}/${name}/Breite`).toBeGreaterThanOrEqual(boden);
      }
      for (const region of ['hand_l', 'hand_r', 'fuss_l', 'fuss_r', 'hals']) {
        const k = (await figur.locator(`[data-region="${region}"]`).boundingBox())!;
        if (dichte === 'handschuh') {
          expect(k.width + SUBPIXEL, `${ansicht}/${region}/Breite`).toBeGreaterThanOrEqual(72);
          expect(k.height + SUBPIXEL, `${ansicht}/${region}/Höhe`).toBeGreaterThanOrEqual(72);
        }
      }
    }
    // Das Sternchen der Verletzung (vorn): Trefferfläche mindestens die Stufe.
    if ((await umschaltung.count()) > 0) {
      await umschaltung.getByRole('tab', { name: 'vorn' }).click();
    }
    const stern = paneel.getByRole('button', { name: /^Verletzung 1, Thorax, vorn/ });
    const s = (await stern.boundingBox())!;
    expect(s.height + SUBPIXEL, `${dichte}/Sternchen/Höhe`).toBeGreaterThanOrEqual(boden);
    expect(s.width + SUBPIXEL, `${dichte}/Sternchen/Breite`).toBeGreaterThanOrEqual(boden);
    // Die Hand links, vorn (Szenario der Spec) wird getroffen: der Tipp öffnet ihre Wahl.
    const handLinks = paneel.getByRole('button', { name: 'Hand links, vorn' });
    hand[dichte] = (await handLinks.boundingBox())!;
    await handLinks.click();
    await expect(
      paneel.getByRole('group', { name: 'Verletzung an Hand links, vorn' }),
    ).toBeVisible();
  }
  expect(hand.kompakt.height, 'Gegenprobe: in kompakt kleiner').toBeLessThan(hand.handschuh.height);
});
