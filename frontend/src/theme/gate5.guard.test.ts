import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Gate-5-Guard (A1): **kein A0-Farbwert außerhalb `src/theme/`.** Eine Kopie eines Rollenwerts
 * divergiert still, sobald die Rolle sich ändert. Neue Farbe kommt aus `theme/`: TSX über
 * `theme.useToken()` bzw. `rollenFarbe()`, CSS über `var(--lfh-*)` aus `rollen.css`.
 *
 * ── BEKANNTE GRENZEN (Teil des Vertrags) ──
 *
 * 1. rgba-getarnte Werte entgehen dem Hex-Scan (z. B. `pages/lagekarte/Sidebar.tsx`). Ein
 *    rgba-Scanner ohne Farbraum-Normalisierung erzeugte mehr Fehlalarme als Funde.
 * 2. Gelesen wird über `node:fs`, NICHT über `import.meta.glob(…?raw)`: Vitest liefert für CSS
 *    dort den Leerstring (`css: false`), die CSS-Hälfte wäre eine Attrappe. `.svg` ist mit
 *    abgedeckt.
 * 3. Kommentare sind ausgenommen (`ohneKommentare`, mit Block-Zustand über Zeilengrenzen). Ein
 *    `//` in einem String blendet den Zeilenrest aus: Falsch-Negative, nie Falsch-Positive.
 * 4. Tests sind ausgenommen (`*.test.*`), sie pinnen Werte bewusst.
 */

/**
 * Wurzel des Scans: `frontend/src`, über `process.cwd()` aufgelöst, denn unter Vitest ist
 * `import.meta.url` keine `file:`-URL. Beide üblichen Arbeitsverzeichnisse werden probiert;
 * findet sich keins, bricht der Test laut.
 */
const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'theme', 'tokens.ts'))) return pfad;
  }
  throw new Error(`Gate-5-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

const ENDUNGEN = /\.(ts|tsx|css|svg)$/;

/** Alle Quelldateien als Rohtext, Pfad relativ zu `src/` (führendes `/src/…` wie beim Glob). */
function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (ENDUNGEN.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

const dateien = lieseQuellen(SRC);

/**
 * Die Status-, Bedien- und Markenwerte aus `farbenHell`/`farbenDunkel` samt den eindeutigen
 * Textstufen (`normalText`, `bedienText`, `bedienHover`, `achtungText`/`alarmText` am Tag) und
 * `alarmHover` (LFH-693).
 *
 * NICHT aufgenommen sind die ETB-Typ- und Warnstufen-Kanten: es sind antd-Presets, die
 * `pages/lagekarte/` als modusunabhängige KARTENFARBEN nutzt; der Scan meldete dort Fehlalarme.
 */
const ROLLENWERT =
  /#(b02318|7a5200|1c6640|154e84|185895|a8071a|ff6b6b|e8cc3a|52c41a|4d94d6|7ddc4a|8ec2f0|7db3e8|604200|8f1c12|7d1810|e88a87)/i;

/**
 * Benannte Ausnahmen: Datei + Wert, jeweils mit Grund, ohne Zeilennummer. Ein Eintrag, der
 * nichts mehr trifft, färbt den Guard rot (unten geprüft).
 */
const AUSNAHMEN: readonly { pfad: string; wert: string; grund: string }[] = [
  {
    pfad: '/src/pages/lagekarte/taktischesZeichen.ts',
    wert: '52c41a',
    grund:
      '`AUSMASS_FARBE.gering` — Kartenfarbe des Schadenszeichens (DV 102), eine Reihe mit den ' +
      'antd-Presets #faad14/#fa8c16/#f5222d daneben. Der Wert ist antds green-6 und fiel ' +
      'mit dem Neuentwurf zufällig mit `farbenDunkel.normal` zusammen; die Zeichenfarbe ' +
      'ist modusunabhängig und darf der Rolle NICHT folgen. Eine Umstellung auf eine ' +
      'eigene Kartenpalette ist ein Nachzug außerhalb des Fundament-Schritts.',
  },
];

function istAusnahme(pfad: string, zeile: string): boolean {
  const treffer = [...zeile.matchAll(new RegExp(ROLLENWERT.source, 'gi'))].map((m) =>
    m[1].toLowerCase(),
  );
  return (
    treffer.length > 0 &&
    treffer.every((wert) => AUSNAHMEN.some((a) => a.pfad === pfad && a.wert === wert))
  );
}

/**
 * Blendet Kommentarinhalt aus und behält die Zeilenzahl bei (Index = Zeile − 1).
 * Trägt den Block-Zustand über Zeilengrenzen, damit auch Fortsetzungszeilen fallen.
 */
function ohneKommentare(inhalt: string): string[] {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of inhalt.split('\n')) {
    let rest = roh;
    let sichtbar = '';
    while (rest.length > 0) {
      if (imBlock) {
        const ende = rest.indexOf('*/');
        if (ende === -1) break; // Rest der Zeile liegt im Block
        imBlock = false;
        rest = rest.slice(ende + 2);
        continue;
      }
      const block = rest.indexOf('/*');
      const einzeilig = rest.indexOf('//');
      if (block === -1 && einzeilig === -1) {
        sichtbar += rest;
        break;
      }
      if (einzeilig !== -1 && (block === -1 || einzeilig < block)) {
        sichtbar += rest.slice(0, einzeilig);
        break;
      }
      sichtbar += rest.slice(0, block);
      rest = rest.slice(block + 2);
      imBlock = true;
    }
    zeilen.push(sichtbar);
  }
  return zeilen;
}

describe('Gate-5-Guard (LFH-328): kein A0-Farbwert außerhalb src/theme/', () => {
  it('findet keinen kopierten Rollenfarbwert', () => {
    const verstoesse: string[] = [];
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (pfad.startsWith('/src/theme/')) continue; // Home der Wahrheitsquelle
      if (/\.test\.[jt]sx?$/.test(pfad)) continue; // Tests pinnen Werte bewusst
      if (/\.generated\.[jt]sx?$/.test(pfad)) continue; // Codegen
      ohneKommentare(inhalt).forEach((zeile, i) => {
        if (ROLLENWERT.test(zeile) && !istAusnahme(pfad, zeile)) {
          verstoesse.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
        }
      });
    }
    expect(
      verstoesse,
      `Kopierte A0-Farbwerte gefunden — der Wert gehört nach theme/: in TSX über ` +
        `theme.useToken() bzw. rollenFarbe(rolle, token), in CSS über var(--lfh-*) ` +
        `aus rollen.css:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it('jede benannte Ausnahme trifft noch etwas — sonst gehört sie gestrichen', () => {
    for (const a of AUSNAHMEN) {
      const inhalt = dateien[a.pfad];
      expect(inhalt, `${a.pfad} existiert nicht mehr`).toBeDefined();
      const trifft = ohneKommentare(inhalt ?? '').some((z) =>
        new RegExp(`#${a.wert}`, 'i').test(z),
      );
      expect(trifft, `Ausnahme ${a.pfad} #${a.wert} ist tot`).toBe(true);
      expect(a.grund.trim()).not.toBe('');
    }
  });

  it('sieht die CSS-Dateien wirklich — sonst ist das halbe Gate eine Attrappe', () => {
    // Selbsttest gegen Grenze 2: `index.css` darf nicht leer gelesen werden.
    expect(dateien['/src/index.css'] ?? '').not.toBe('');
    expect(Object.keys(dateien).filter((p) => p.endsWith('.css')).length).toBeGreaterThan(5);
  });

  it('blendet Kommentar-Erwähnungen aus, auch als Fortsetzungszeile im Block', () => {
    const sichtbar = ohneKommentare(
      [
        '/* Zeile eins',
        '   erwähnt #a8071a mitten im Block',
        '   und endet hier */',
        'echt: #a8071a;',
      ].join('\n'),
    );
    expect(sichtbar.filter((z) => ROLLENWERT.test(z))).toEqual(['echt: #a8071a;']);
  });
});
