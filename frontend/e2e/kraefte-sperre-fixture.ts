import { expect, type Locator, type Page } from '@playwright/test';
import { einheitMitZuordnungen, type SperrRolle } from './einheit-fixture';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Sperrzweig der Kräfte-Seiten (LLH-1462): ein NACHBARMODUL per Einsatz-Override gesperrt
 * (`benoetigte_rolle: 'admin'`, `e2e/AGENTS.md`, LFH-820), gemessen in Gate 3
 * (`gate3-trefflaeche.spec.ts`) und `fokus-verdeckung.spec.ts` wie die Einheit-Ansicht
 * (`seedEinheitPersonalGesperrt`). Der Admin ist nie gesperrt; er sät, Beobachter und
 * Führungspersonal messen.
 *
 * Jede Seite trägt ihren Grund sichtbar („Modul … gesperrt“) und fragt die gesperrte Liste gar
 * nicht ab. Beides ist Vorbedingung jeder Messung: ohne Grund mäße der Test den freien Zweig,
 * mit 403 einen Abruffehler.
 */

export type KraefteModul = 'personal' | 'einheiten' | 'fahrzeuge' | 'auftraege';

export interface KraefteSperre {
  einsatzId: string;
  brId: number;
  /** 403-Antworten der Einsatz-API seit dem Rollenwechsel, als „METHODE /pfad“. */
  verboten: string[];
}

/** BR-Name und Namen der Kräfte aus {@link einheitMitZuordnungen}. */
export const SPERR_NAMEN = {
  br: 'BR Gate3 Sperre',
  fahrzeuge: ['Florian 446', 'Florian 446 frei'],
} as const;

/**
 * Sät einen Einsatz mit Einheit, Fahrzeugen und Personal ({@link einheitMitZuordnungen}), einem
 * Auftrag an die Einheit, einer zweiten Einheit in einem aktiven Bereitstellungsraum, sperrt
 * `module` und wechselt im selben Kontext auf `rolle`. Danach zählt `verboten` jede 403.
 */
export async function seedKraefteGesperrt(
  page: Page,
  module: readonly KraefteModul[],
  rolle: SperrRolle,
): Promise<KraefteSperre> {
  const { pfad } = await einheitMitZuordnungen(page);
  const einsatzId = pfad.split('/')[2];
  const einheitId = Number(pfad.split('/')[4]);
  const basis = `/api/einsaetze/${einsatzId}`;
  const post = async (ziel: string, data: unknown): Promise<number> => {
    const antwort = await page.request.post(`${basis}/${ziel}`, { data });
    expect(antwort.ok(), `${ziel}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
    return ((await antwort.json()) as { id: number }).id;
  };
  await post('auftraege', {
    auftrag_text: 'Deich sichern',
    empfaenger: [{ empfaenger_typ: 'einheit', einheit_id: einheitId }],
  });
  const zweite = await post('einheiten', { name: 'Zweitzug 446' });
  const brId = await post('bereitstellungsraeume', {
    bezeichnung: SPERR_NAMEN.br,
    standort: 'Sportplatz',
  });
  // Belegen geht nur im aktiven Raum (sonst 422).
  const aktiv = await page.request.post(`${basis}/bereitstellungsraeume/${brId}/status`, {
    data: { status: 'aktiv' },
  });
  expect(aktiv.ok(), `BR aktiv: ${aktiv.status()} ${await aktiv.text()}`).toBe(true);
  await post(`bereitstellungsraeume/${brId}/belegung`, {
    objekt_typ: 'einheit',
    objekt_id: zweite,
    art: 'eintritt',
  });
  for (const modul of module) {
    const sperre = await page.request.put(`${basis}/modul-overrides/${modul}`, {
      data: { sichtbar: true, benoetigte_rolle: 'admin' },
    });
    // Ein still gescheitertes Seeding mäße den freien Zweig — grün durch Nichtstun.
    expect(sperre.ok(), `Override ${modul}: ${sperre.status()} ${await sperre.text()}`).toBe(true);
  }
  await wechsleZuRolle(page, rolle, einsatzId);
  const verboten: string[] = [];
  page.on('response', (antwort) => {
    const url = new URL(antwort.url());
    // Nur Listen des Einsatzes: andere 403 (etwa Org-Einstellungen) sind nicht Gegenstand.
    if (antwort.status() === 403 && url.pathname.startsWith(`${basis}/`)) {
      verboten.push(`${antwort.request().method()} ${url.pathname}`);
    }
  });
  return { einsatzId, brId, verboten };
}

/** Ein Bedienziel des Sperrzweigs: `ziel` wird gemessen, `fokus` ist der Tabulatorstopp. */
export interface SperrZiel {
  name: string;
  ziel: Locator;
  /** Fehlt bei gesperrten Zielen: sie sind sichtbar, aber kein Tabulatorstopp. */
  fokus?: Locator;
  gesperrt?: boolean;
  /** Mehrfach stehende Ziele (`alleHaltenStufe`): die Mindestzahl. */
  mindestens?: number;
  /** Mindestzahl der Tabulatorstopps, wenn ein Teil der Ziele gesperrt steht. */
  fokusMindestens?: number;
}

export interface SperrSeite {
  name: string;
  pfad: (s: KraefteSperre) => string;
  /** Der sichtbare Grund; Datenanker und Vorbedingung zugleich. */
  grund: (page: Page) => Locator;
  /** Die Ziele, die der Rolle im Sperrzweig bleiben. */
  ziele: (page: Page, rolle: SperrRolle) => SperrZiel[];
}

export interface SperrSzenario {
  name: string;
  module: readonly KraefteModul[];
  seiten: SperrSeite[];
}

const main = (page: Page) => page.getByRole('main');

/** Umschalter und Suchfeld des Meldebilds, dazu „In Lagebericht übernehmen“ (schreibend). */
function meldebildZiele(berichtGesperrt: boolean) {
  return (page: Page, rolle: SperrRolle): SperrZiel[] => {
    const werkzeuge = page.locator('[data-lfh="meldebild-werkzeuge"]');
    const ziele: SperrZiel[] = [
      {
        name: 'Umschalter-Segment',
        ziel: werkzeuge.locator('[data-lfh="segmentleiste"] button'),
        mindestens: 3,
      },
      {
        name: 'Suchfeld',
        ziel: werkzeuge.locator('.ant-input-affix-wrapper'),
        fokus: werkzeuge.getByPlaceholder('Suche...'),
      },
    ];
    if (rolle === 'fuehrungspersonal') {
      const bericht = page.getByRole('button', { name: 'In Lagebericht übernehmen' });
      ziele.push({
        name: '„In Lagebericht übernehmen“',
        ziel: bericht,
        ...(berichtGesperrt ? { gesperrt: true } : { fokus: bericht }),
      });
    }
    return ziele;
  };
}

/** Der Meldebild-Link der Verdichtungszeile über Fahrzeugliste und Tableau. */
function verdichtungsLink(page: Page): SperrZiel {
  const link = page
    .locator('[data-lfh="verdichtungszeile"]')
    .getByRole('link', { name: 'Meldebild', exact: true });
  return { name: 'Verdichtungszeile „Meldebild“', ziel: link, fokus: link };
}

const meldebild = (grund: (page: Page) => Locator, berichtGesperrt: boolean): SperrSeite => ({
  name: 'Meldebild',
  pfad: (s) => `/einsaetze/${s.einsatzId}/kraefteuebersicht`,
  grund,
  ziele: meldebildZiele(berichtGesperrt),
});

/** Die Sperrzweige je gesperrtem Modul (LLH-1462). */
export const SPERR_SZENARIEN: SperrSzenario[] = [
  {
    name: 'Personal',
    module: ['personal'],
    seiten: [
      meldebild(
        (page) =>
          page.locator('[data-lfh="meldebild-sperre"]', { hasText: 'Modul Personal gesperrt' }),
        true,
      ),
      {
        name: 'Fahrzeuge',
        pfad: (s) => `/einsaetze/${s.einsatzId}/fahrzeuge`,
        grund: (page) => page.locator('[data-lfh="besatzung-sperre"]').first(),
        ziele: (page) => {
          const details = main(page).getByRole('button', { name: /^Details zu Florian 446/ });
          return [
            { name: '„Details zu …“', ziel: details, fokus: details, mindestens: 2 },
            verdichtungsLink(page),
          ];
        },
      },
    ],
  },
  {
    name: 'Einheiten',
    module: ['einheiten'],
    seiten: [
      meldebild(
        (page) =>
          page
            .getByRole('region', { name: 'Einheiten nach FMS-Status' })
            .getByText('Modul Einheiten gesperrt'),
        true,
      ),
      {
        name: 'FMS-Tableau',
        pfad: (s) => `/einsaetze/${s.einsatzId}/fahrzeuge?ansicht=tableau`,
        grund: (page) =>
          page
            .getByRole('region', { name: 'FMS-Tableau' })
            .getByText(/^Modul Einheiten gesperrt · /),
        ziele: (page, rolle) => {
          const ziele = [verdichtungsLink(page)];
          if (rolle === 'fuehrungspersonal') {
            const status = page
              .getByRole('region', { name: 'FMS-Tableau' })
              .getByRole('button', { name: /^Status von Florian 446.* ändern$/ });
            ziele.push({ name: 'Statusknopf', ziel: status, fokus: status, mindestens: 2 });
          }
          return ziele;
        },
      },
      {
        name: 'Bereitstellungsräume',
        pfad: (s) => `/einsaetze/${s.einsatzId}/bereitstellungsraeume/liste`,
        grund: (page) => page.locator('[data-lfh="br-staerke-gesperrt"]'),
        ziele: (page) => {
          const link = main(page).getByRole('link', { name: SPERR_NAMEN.br, exact: true });
          return [{ name: 'Raum-Link', ziel: link, fokus: link }];
        },
      },
      {
        name: 'Ablösung',
        pfad: (s) => `/einsaetze/${s.einsatzId}/abloesung`,
        grund: (page) => page.locator('[data-lfh="abloesung-sperre"]'),
        ziele: (page) => [
          {
            name: '„Schicht beginnen“',
            ziel: page
              .locator('[data-lfh="seitenkopf-aktionen"]')
              .getByRole('button', { name: 'Schicht beginnen', exact: true }),
            gesperrt: true,
          },
          {
            name: 'Ansichts-Segment',
            // „Ohne Schicht“ steht gesperrt; gemessen werden alle drei.
            ziel: page.locator(
              '[data-lfh="abloesung-werkzeugzeile"] [data-lfh="segmentleiste"] button',
            ),
            // Roving Tabindex der Radiogruppe: nur das gewählte Segment ist Tabulatorstopp.
            fokus: page.locator(
              '[data-lfh="abloesung-werkzeugzeile"] [data-lfh="segmentleiste"] button[aria-checked="true"]',
            ),
            mindestens: 3,
            fokusMindestens: 1,
          },
        ],
      },
    ],
  },
  {
    name: 'Einheiten und Fahrzeuge',
    module: ['einheiten', 'fahrzeuge'],
    seiten: [
      {
        name: 'Bereitstellungsraum',
        pfad: (s) => `/einsaetze/${s.einsatzId}/bereitstellungsraeume/${s.brId}`,
        grund: (page) =>
          page.locator('[data-lfh="br-kraefte-sperre"]', {
            hasText: 'Module Einheiten und Fahrzeuge gesperrt',
          }),
        ziele: (page, rolle) => {
          const verlauf = page.getByRole('button', {
            name: `Verlauf des Bereitstellungsraums ${SPERR_NAMEN.br}`,
          });
          const ziele: SperrZiel[] = [
            { name: 'Klappkopf „Verlauf“', ziel: verlauf, fokus: verlauf },
          ];
          if (rolle === 'fuehrungspersonal') {
            const eintreffen = page.getByRole('button', { name: 'Eintreffen buchen' });
            ziele.push({ name: '„Eintreffen buchen“', ziel: eintreffen, fokus: eintreffen });
          }
          return ziele;
        },
      },
    ],
  },
  {
    name: 'Aufträge',
    module: ['auftraege'],
    seiten: [
      meldebild((page) => page.locator('[data-lfh="meldebild-auftrag-sperre"]').first(), false),
    ],
  },
];

/** Grund sichtbar, kein 403 beim Laden: erst danach misst ein Test den Sperrzweig. */
export async function sperrzweigSteht(page: Page, seite: SperrSeite, s: KraefteSperre) {
  await expect(seite.grund(page), `Vorbedingung ${seite.name}: Grund sichtbar`).toBeVisible();
  expect(s.verboten, `Vorbedingung ${seite.name}: keine gesperrte Liste abgefragt`).toEqual([]);
}
