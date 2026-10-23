/**
 * Zeitdarstellungs-Wächter (LLH-1053, Spec `zeitdarstellung`; Regel: `frontend/AGENTS.md`,
 * „Zeitdarstellung“).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Eine Zeit für Menschen formatiert nur der Kern `anzeige/zeitDarstellung.ts` (Rollen
 * `zeitpunkt`, `zeitKurz`, `uhrzeit`). Jedes eigene `dayjs(...).format('HH:mm')` ist eine zweite
 * Schreibweise neben der DTG und folgt weder der gewählten Darstellung noch dem Druck. Ohne diesen
 * Wächter wüchse der Wildwuchs nach jeder Bereinigung neu.
 *
 * ── Was er prüft ────────────────────────────────────────────────────────────────
 * Produktivcode außerhalb von `anzeige/` ruft kein `.format('…')` mit einem Zeit-Token (`HH`,
 * `mm`, `DD`, `YYYY`) im Literal. Nicht gezählt:
 * - Maschinenformate in ISO-Reihenfolge — das Literal beginnt mit `YYYY-MM-DD` (Wire, Tages-
 *   schlüssel, Dateinamen). Sie sieht kein Mensch als Zeitangabe.
 * - {@link AUSNAHMEN}: begründete Einzelfälle.
 * Die Schuldmenge {@link OFFEN} ist der Bestand vom 22.10.2026 (LLH-1061 baut ihn ab). Der Test
 * verlangt Gleichheit je Datei: eine neue Stelle macht ihn rot, eine bereinigte auch, bis die
 * Zahl hier sinkt. Die Liste schrumpft nur.
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 * Er liest Quelltext: ein Format aus einer Konstanten (`const F = 'HH:mm'; d.format(F)`),
 * `toLocaleTimeString` oder `Intl.DateTimeFormat` fängt er nicht. Die Regel gilt trotzdem.
 */
import { describe, expect, it } from 'vitest';

// Das Glob bleibt HIER, sonst landete bei einem versehentlichen Produktiv-Import der Quelltext im
// App-Bundle.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Der Kern und seine Bausteine; dort darf formatiert werden. Tests und Test-Helfer ebenso. */
const FREI = /^\/src\/(?:anzeige|test)\//;

const produktiv = Object.entries(dateien).filter(
  ([pfad]) => !/\.test\.tsx?$/.test(pfad) && !FREI.test(pfad),
);

/** Ein `.format(` mit einem String-Literal als erstem Argument (auch über einen Zeilenumbruch). */
const FORMAT_AUFRUF = /\.format\(\s*(['"`])([^'"`]*?)\1/g;
/** Zeit-Token im Literal. */
const ZEIT_TOKEN = /HH|mm|DD|YYYY/;
/** Maschinenformat in ISO-Reihenfolge: nicht für Menschen. */
const MASCHINENFORMAT = /^YYYY-MM-DD/;

/** Begründete Ausnahmen, Pfad relativ zu `frontend/src/` → Grund. */
const AUSNAHMEN: Record<string, string> = {
  'components/Kopfleiste.tsx':
    'Uhr im Kopf: Gerätezeit, bewusst `HH:mm` wie eine Wanduhr (Entscheidung E2, LLH-1045).',
};

/**
 * Schuldmenge: Datei → Anzahl der Stellen am 22.10.2026. Nur verkleinern (LLH-1061); eine
 * Datei mit 0 fällt heraus.
 */
const OFFEN: Record<string, number> = {
  'admin/DemoDatenPage.tsx': 1,
  'alarm/useBenachrichtigungen.ts': 1,
  'components/Datenstand.tsx': 2,
  'druck/DruckTabelle.tsx': 1,
  'druck/einsatzbericht/verdichtung.ts': 1,
  'etb/EtbDruckTabelle.tsx': 1,
  'etb/bausteinEinsetzen.ts': 2,
  'etb/druckAuswahl.ts': 1,
  'etb/lesemarkeModell.ts': 3,
  'etb/zeitachseModell.ts': 1,
  'geraet/LagemonitorPage.tsx': 2,
  'karten/ortszeit.ts': 1,
  'lagemeldungen/zeitachse.ts': 3,
  'pages/lage-dashboard/lagebild.ts': 2,
  'pegel/pegelKennzahl.ts': 2,
  'verpflegung/tagAusVorlageKern.ts': 1,
  'verpflegung/useBedarfsvorschlag.ts': 1,
  'verpflegung/verpflegungText.ts': 4,
};

/** Die Zeitformate für Menschen in einem Quelltext. */
function zeitFormate(inhalt: string): string[] {
  return [...inhalt.matchAll(FORMAT_AUFRUF)]
    .map((m) => m[2])
    .filter((f) => ZEIT_TOKEN.test(f) && !MASCHINENFORMAT.test(f));
}

function funde(quellen: [string, string][] = produktiv): Record<string, number> {
  const ergebnis: Record<string, number> = {};
  for (const [pfad, inhalt] of quellen) {
    const rel = pfad.replace(/^\/src\//, '');
    if (rel in AUSNAHMEN) continue;
    const anzahl = zeitFormate(inhalt).length;
    if (anzahl > 0) ergebnis[rel] = anzahl;
  }
  return ergebnis;
}

describe('Zeit für Menschen nur über den Kern in anzeige/ (LLH-1053)', () => {
  it('kein neues `.format(…)` mit Zeit-Token außerhalb von anzeige/ — Schuldmenge nur schrumpfen', () => {
    // Gleichheit statt „höchstens“: eine bereinigte Stelle verlangt, dass OFFEN mitschrumpft.
    expect(funde()).toEqual(OFFEN);
  });

  it('jede Ausnahme gibt es noch und trifft wirklich ein Zeitformat', () => {
    for (const pfad of Object.keys(AUSNAHMEN)) {
      const inhalt = dateien[`/src/${pfad}`];
      expect(inhalt, pfad).toBeDefined();
      expect(zeitFormate(inhalt).length, pfad).toBeGreaterThan(0);
    }
  });

  it('das Muster greift, wo es soll (der Wächter läuft nicht ins Leere)', () => {
    expect(zeitFormate("const s = dayjs(x).format('HH:mm');")).toEqual(['HH:mm']);
    expect(zeitFormate('d.format(\n  "DD.MM.YYYY HH:mm",\n)')).toEqual(['DD.MM.YYYY HH:mm']);
    expect(zeitFormate('d.format(`DDHHmm`)')).toEqual(['DDHHmm']);
    // Maschinenformate und Fremdes zählen nicht.
    expect(zeitFormate("d.format('YYYY-MM-DD HH:mm:ss')")).toEqual([]);
    expect(zeitFormate("d.format('YYYY-MM-DD')")).toEqual([]);
    expect(zeitFormate("zahl.format('0.00')")).toEqual([]);
    // Ein neues `dayjs().format('HH:mm')` in pages/ macht den ersten Fall rot.
    const mitNeuem = funde([
      ...produktiv,
      ['/src/pages/NeueSeite.tsx', "export const x = dayjs().format('HH:mm');"],
    ]);
    expect(mitNeuem['pages/NeueSeite.tsx']).toBe(1);
    expect(mitNeuem).not.toEqual(OFFEN);
  });
});
