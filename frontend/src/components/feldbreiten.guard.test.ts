import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Feldbreiten-Guard der Verwaltungsseiten (LFH-329 · B1).
 *
 * Ein Eingabefeld mit fester Pixelbreite ragt am schmalen Schirm über den Rand hinaus
 * und drückt die Seite waagerecht breit — sichtbar erst unterhalb der Feldbreite, also
 * nie am Entwicklerschirm. Der Bestand trug vierzehn solcher Felder in acht Dateien.
 * Ersetzt sind sie durch die fluide Form (volle Breite bis zu einer Obergrenze), die
 * am Fükw-Schirm identisch aussieht und am Telefon mitgeht.
 *
 * Der Guard pinnt das NEGATIV: eine feste Zahlbreite in diesen vier Bereichen ist ein
 * Fehler, ausser an den zwei ausdrücklich zugelassenen Stellen. Beide sind KEINE
 * Eingabefelder und dürfen ihre Zahl behalten:
 *
 * - die Spaltenbreite einer Tabellenspalte (sie steuert die Spaltenverteilung, nicht
 *   die Seitenbreite — die Tabelle scrollt seit diesem Paket in sich),
 * - der Fortschrittsbalken eines Kartendownloads (ein Anzeigeelement fester Grösse).
 *
 * ── BEKANNTE GRENZEN ────────────────────────────────────────────────────────────
 *
 * 1. Der Scan sieht nur die Zahlform. Eine Breite über eine benannte Konstante
 *    (`width: ROLLEN_BREITE`) oder als Zeichenkette (`width: '200px'`) entgeht ihm.
 *    Beides ist im Bestand nicht die übliche Schreibweise; ein Wert-auflösender
 *    Scanner wäre der teurere Weg zu derselben Aussage.
 * 2. Grossgeschriebene Verwandte (`maxWidth`, `minWidth`) sind bewusst nicht erfasst —
 *    eine Obergrenze ist genau die gewünschte Form, keine feste Breite.
 * 3. Der Scan hört an den vier Bereichen auf. Ausserhalb (Einsatzmodule, Lagekarte)
 *    gilt die Regel ebenso, wird hier aber nicht erzwungen: diese Bereiche gehören
 *    anderen Arbeitspaketen des Bandes.
 */

const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'components', 'KatalogTabelle.tsx'))) return pfad;
  }
  throw new Error(`Feldbreiten-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

/** Die Bereiche des Verwaltungsteils: Stammdaten, Karten, globale Einstellungen, Benutzer. */
const BEREICHE = ['stammdaten', 'karten', 'pages/einstellungen', 'pages/BenutzerPage.tsx'];

function ohneKommentare(quelle: string): string {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of quelle.split('\n')) {
    let zeile = '';
    for (let i = 0; i < roh.length; i += 1) {
      if (imBlock) {
        if (roh.startsWith('*/', i)) {
          imBlock = false;
          i += 1;
        }
        continue;
      }
      if (roh.startsWith('/*', i)) {
        imBlock = true;
        i += 1;
        continue;
      }
      if (roh.startsWith('//', i)) break;
      zeile += roh[i];
    }
    zeilen.push(zeile);
  }
  return zeilen.join('\n');
}

/** Liest einen Bereich ein — eine einzelne Datei oder ein Verzeichnis, Tests ausgenommen. */
function sammleDateien(bereich: string): { pfad: string; text: string }[] {
  const voll = join(SRC, bereich);
  if (!existsSync(voll)) throw new Error(`Feldbreiten-Guard: ${bereich} fehlt`);
  if (bereich.endsWith('.tsx')) {
    return [{ pfad: bereich, text: ohneKommentare(readFileSync(voll, 'utf8')) }];
  }
  const treffer: { pfad: string; text: string }[] = [];
  const rein = (verzeichnis: string, rel: string) => {
    for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
      const kind = join(verzeichnis, eintrag.name);
      const kindRel = `${rel}/${eintrag.name}`;
      if (eintrag.isDirectory()) rein(kind, kindRel);
      else if (eintrag.name.endsWith('.tsx') && !eintrag.name.includes('.test.')) {
        treffer.push({ pfad: kindRel, text: ohneKommentare(readFileSync(kind, 'utf8')) });
      }
    }
  };
  rein(voll, bereich);
  return treffer;
}

/** Feste Zahlbreite in einem Stil-Objekt — die Form, die am schmalen Schirm überragt. */
const FESTE_BREITE = /\bwidth: \d/;

/** Fluide Form: volle Breite bis zu einer Obergrenze. */
const OBERGRENZE = /\bmaxWidth: \d/g;

const QUELLEN = BEREICHE.flatMap(sammleDateien);

/** Was eine feste Zahlbreite behalten darf — und warum. */
const ZUGELASSEN = [
  { pfad: 'stammdaten/StichworteTab.tsx', grund: 'Spaltenbreite einer Tabellenspalte' },
  { pfad: 'karten/OfflineKartenVerwaltung.tsx', grund: 'Fortschrittsbalken des Downloads' },
];

describe('Feldbreiten im Verwaltungsteil', () => {
  it('kein Eingabefeld trägt eine feste Pixelbreite', () => {
    const mitFesterBreite = QUELLEN.filter((q) =>
      q.text.split('\n').some((z) => FESTE_BREITE.test(z)),
    ).map((q) => q.pfad);

    expect(mitFesterBreite.sort()).toEqual(ZUGELASSEN.map((z) => z.pfad).sort());

    // …und an den zugelassenen Stellen bleibt es bei GENAU einer, damit die Ausnahme
    // nicht zur Einfallstür für neue feste Feldbreiten in derselben Datei wird.
    for (const { pfad } of ZUGELASSEN) {
      const quelle = QUELLEN.find((q) => q.pfad === pfad)!;
      const anzahl = quelle.text.split('\n').filter((z) => FESTE_BREITE.test(z)).length;
      expect(anzahl, pfad).toBe(1);
    }
  });

  it('die vierzehn umgestellten Felder tragen eine Obergrenze statt einer Festbreite', () => {
    const erwartet: Record<string, number> = {
      'pages/einstellungen/EinsatzDefaults.tsx': 6,
      'stammdaten/QualifikationenTab.tsx': 1,
      'stammdaten/EtbBausteinFormModal.tsx': 1,
      'stammdaten/PersonalStatusTab.tsx': 1,
      'stammdaten/EinheitTypenTab.tsx': 1,
      'stammdaten/StatusKatalogTab.tsx': 2,
      // Die Tragenkapazität ist mit LFH-346 · A7 aus `FahrzeugFormModal` auf
      // `FahrzeugDetailPage` gewandert (elf Felder passen nicht in ein Modal). Die
      // Obergrenze ist MITGEZOGEN, nicht verschwunden — die Summe unten bleibt 14. Ein
      // Eintrag ohne Fund färbte den Guard rot, ein stillschweigend gestrichener liesse
      // die Zahl im Testnamen unbelegt.
      'stammdaten/FahrzeugDetailPage.tsx': 1,
      'karten/OnlineQuelleFormModal.tsx': 1,
    };
    const gemessen: Record<string, number> = {};
    for (const [pfad, anzahl] of Object.entries(erwartet)) {
      const quelle = QUELLEN.find((q) => q.pfad === pfad);
      if (!quelle) throw new Error(`Feldbreiten-Guard: ${pfad} nicht im Scan`);
      gemessen[pfad] = quelle.text.match(OBERGRENZE)?.length ?? 0;
      // Exakt, nicht „mindestens": bei `>=` trüge die Zahl in der Erwartungsmap
      // keine Aussage mehr, und die Summe darunter zählte nur noch sich selbst.
      expect(gemessen[pfad], pfad).toBe(anzahl);
    }
    // Summiert wird das GEMESSENE, nicht die Erwartungsmap. Sonst verglich diese
    // Zeile eine hartkodierte Zahl mit einer hartkodierten Zahl und belegte über
    // den Quellbaum nichts — die vierzehn im Testnamen wäre nirgends erzwungen.
    expect(Object.values(gemessen).reduce((a, b) => a + b, 0)).toBe(14);
  });

  it('der Scanner findet die verbotene Form wirklich (Selbstbeweis)', () => {
    const probe = ohneKommentare(
      [
        '// style={{ width: 200 }} im Kommentar zählt nicht',
        'const a = <Input style={{ width: 200 }} />;',
        "const b = <Input style={{ width: '100%', maxWidth: 200 }} />;",
        'const c = <div style={{ minWidth: 200 }} />;',
      ].join('\n'),
    ).split('\n');
    expect(probe.filter((z) => FESTE_BREITE.test(z))).toHaveLength(1);
    expect(probe.join('\n').match(OBERGRENZE)).toHaveLength(1);
  });
});
