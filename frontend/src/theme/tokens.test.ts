/**
 * Die Dichte-Staffel als Träger (A1 Festlegung 4): die drei Stufen erzeugen unterschiedliche
 * Tokens. Geprüft werden auch die Abstände: ein `antdToken`, das `padding*` weiter aus der
 * Modulkonstante läse, wäre sonst halb verdrahtet und trotzdem grün.
 */
import { theme as antdTheme } from 'antd';
import { describe, expect, it } from 'vitest';
import { abstand, antdToken, dichten, farbenHell, flaeche, type Dichte } from './tokens';
import { seitenrinne } from './tokens';
import { navDrawerBreite } from './tokens';
import {
  antdAlgorithmus,
  antdKaestchen,
  antdKlappkopf,
  antdKomponenten,
  kopfzeilenMasse,
  switchMasse,
} from './tokens';
import { farbenDunkel } from './tokens';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `ThemeConfig['token']` ist optional getypt — hier nicht wegcasten, sondern
 *  laut scheitern, wenn `antdToken` nichts liefert. */
function tokenFuer(dichte: Dichte) {
  const t = antdToken(farbenHell, dichte);
  if (!t) throw new Error(`antdToken lieferte keine Tokens für ${dichte}`);
  return t;
}

describe('Dichte-Staffel (A1 Festlegung 4)', () => {
  it('trägt die drei in A1 festgelegten Steuerhöhen', () => {
    expect(dichten.kompakt.zeilenhoehe).toBe(30);
    expect(dichten.komfortabel.zeilenhoehe).toBe(48);
    expect(dichten.handschuh.zeilenhoehe).toBe(72);
  });

  it('lässt die Grundschrift nur einmal steigen — Handschuh ändert die Hand, nicht das Auge', () => {
    expect(dichten.kompakt.schriftgroesse).toBe(13.5);
    expect(dichten.komfortabel.schriftgroesse).toBe(15);
    expect(dichten.handschuh.schriftgroesse).toBe(15);
  });

  it('staffelt das Abstandsraster mit (die xs/sm-Werte sind abgeleitet)', () => {
    expect(dichten.kompakt.abstand).toEqual({ xs: 3, sm: 7, md: 11, lg: 18 });
    expect(dichten.komfortabel.abstand).toEqual({ xs: 5, sm: 11, md: 18, lg: 28 });
    expect(dichten.handschuh.abstand).toEqual({ xs: 7, sm: 16, md: 26, lg: 44 });
  });

  it('hält `abstand` als A0-Export am Leben — er IST die kompakte Stufe', () => {
    expect(abstand).toBe(dichten.kompakt.abstand);
  });

  // Literale statt `dichten.x.kleineZeilenhoehe`, sonst prüfte der Test die Konstante gegen sich
  // selbst.
  it('setzt die kleine Steuerhöhe je Stufe auf den A1-Gate-3-Boden (LFH-361 · B5a)', () => {
    expect(dichten.kompakt.kleineZeilenhoehe).toBe(24);
    expect(dichten.komfortabel.kleineZeilenhoehe).toBe(48);
    expect(dichten.handschuh.kleineZeilenhoehe).toBe(72);
  });

  it('setzt controlHeight und fontSize aus der gewählten Stufe', () => {
    expect(tokenFuer('handschuh').controlHeight).toBe(72);
    expect(tokenFuer('komfortabel').fontSize).toBe(15);
  });

  /**
   * Ohne diesen Token leitet antd `controlHeightSM` mit Faktor 0,75 ab (komfortabel 36 px statt
   * des Gate-3-Bodens 48). Der zweite `expect` je Stufe schließt aus, dass zufällig derselbe Wert
   * steht, den antd ohnehin gerechnet hätte.
   */
  it('reicht die kleine Steuerhöhe durch, statt sie antd ableiten zu lassen', () => {
    for (const stufe of ['kompakt', 'komfortabel', 'handschuh'] as const) {
      const t = tokenFuer(stufe);
      expect(t.controlHeightSM).toBe(dichten[stufe].kleineZeilenhoehe);
      expect(t.controlHeightSM).not.toBe(dichten[stufe].zeilenhoehe * 0.75);
    }
  });

  it('führt die Stufe bis in die Abstände durch, nicht nur bis zur Steuerhöhe', () => {
    const t = tokenFuer('handschuh');
    expect(t.padding).toBe(dichten.handschuh.abstand.md);
    expect(t.paddingSM).toBe(dichten.handschuh.abstand.sm);
    expect(t.paddingXS).toBe(dichten.handschuh.abstand.xs);
    expect(t.paddingLG).toBe(dichten.handschuh.abstand.lg);
    expect(t.margin).toBe(dichten.handschuh.abstand.md);
    expect(t.marginSM).toBe(dichten.handschuh.abstand.sm);
    expect(t.marginXS).toBe(dichten.handschuh.abstand.xs);
    expect(t.marginLG).toBe(dichten.handschuh.abstand.lg);
  });

  it('erzeugt für jede Stufe einen anderen Token-Satz (Spec §2.1)', () => {
    const saetze = (['kompakt', 'komfortabel', 'handschuh'] as const).map((d) =>
      JSON.stringify(antdToken(farbenHell, d)),
    );
    expect(new Set(saetze).size).toBe(3);
  });

  it('bleibt ohne Dichte-Argument auf der kompakten Stufe (A0-Verhalten unverändert)', () => {
    expect(antdToken(farbenHell)).toEqual(antdToken(farbenHell, 'kompakt'));
  });
});

describe('Flächenmaße als Token', () => {
  it('exportiert Flächenmaße als Token statt als verstreute Pixel', () => {
    expect(flaeche.seiteSchmal).toBeGreaterThan(0);
    expect(flaeche.zustandOben).toBeGreaterThan(0);
  });

  it('trägt die gemessenen Baselines aus der Spec §2.2 (ohne die entfallene Listenbreite)', () => {
    expect(flaeche).toEqual({
      seiteSchmal: 900,
      zustandOben: 80,
      kachelMin: 260,
      kachelMinKlein: 220,
    });
  });
});

/**
 * Die Seitenrinne ist die VIEWPORT-Achse, deshalb ein eigener Export statt Schlüsseln in
 * `flaeche` (dessen `toEqual`-Pin oben ist erschöpfend). Die CSS-Seite bewacht
 * `rollen.guard.test.ts`.
 */
describe('Seitenrinne (LFH-329 · B1)', () => {
  it('exportiert die Seitenrinne als Viewport-Paar (LFH-329 · B1)', () => {
    expect(seitenrinne).toEqual({ breit: 24, schmal: 12 });
    // Benannte Diagnose gegen ein vertauschtes Paar.
    expect(seitenrinne.schmal).toBeLessThan(seitenrinne.breit);
  });
});

/**
 * Die Breite des Navigations-Drawers ist wie die Seitenrinne eine VIEWPORT-Aussage, deshalb
 * ein eigener Export statt eines Schlüssels in `flaeche`.
 */
describe('Navigations-Drawer (LFH-329 · B1/H11)', () => {
  it('exportiert die Breite des Navigations-Drawers als Token (LFH-329 · B1)', () => {
    expect(navDrawerBreite).toBe(280);
  });

  it('lässt den geschlossenen Flächen-Pin unberührt', () => {
    // Der Drawer bekommt bewusst KEINEN Platz in `flaeche`.
    expect(Object.keys(flaeche)).toHaveLength(4);
    expect(flaeche).not.toHaveProperty('navDrawer');
  });
});

/**
 * Der Kippschalter folgt der Staffel (LFH-380): antd rechnet seine Höhe aus der Schrift, nicht
 * aus `controlHeight`. Die Böden stehen als LITERALE da. Kein Render (jsdom rechnet kein
 * Layout); ob antd die Namen honoriert, belegt `ThemeModeProvider.test.tsx`.
 */
describe('Switch-Maße (LFH-380)', () => {
  const STUFEN: Dichte[] = ['kompakt', 'komfortabel', 'handschuh'];

  it('hebt den Schalter je Stufe auf den Gate-3-Boden: 24×48 · 48×96 · 72×144', () => {
    const kasten = (d: Dichte) => {
      const m = switchMasse(dichten[d]);
      return { hoehe: m.trackHeight, breite: m.trackMinWidth };
    };
    expect(kasten('kompakt')).toEqual({ hoehe: 24, breite: 48 });
    expect(kasten('komfortabel')).toEqual({ hoehe: 48, breite: 96 });
    expect(kasten('handschuh')).toEqual({ hoehe: 72, breite: 144 });
  });

  it('zieht den abhängigen Satz mit — der Griff füllt die Spur in jeder Stufe', () => {
    // antd leitet Griff, Mindestbreite und Innenränder aus der SCHRIFT ab und rechnet sie bei einem
    // überschriebenen Token nicht nach; nur `trackHeight` ergäbe einen 18-px-Griff in 72-px-Spur.
    for (const d of STUFEN) {
      const m = switchMasse(dichten[d]);
      expect(m.handleSize + 2 * m.trackPadding, d).toBe(m.trackHeight);
      expect(m.trackMinWidth, d).toBe(2 * m.handleSize + 4 * m.trackPadding);
      expect(m.innerMinMargin, d).toBe(m.handleSize / 2);
      expect(m.innerMaxMargin, d).toBe(m.handleSize + 3 * m.trackPadding);
    }
  });

  it('lässt den Innenabstand der Spur bei antds festen 2 px', () => {
    for (const d of STUFEN) expect(switchMasse(dichten[d]).trackPadding, d).toBe(2);
  });

  it('antdKomponenten trägt die Maße der GEWÄHLTEN Stufe, nicht die kompakte', () => {
    // Die Rechnung muss auch an der globalen Stelle hängen; ein vergessener Dichte-Parameter ließe
    // den Schalter still auf kompakt stehen.
    expect(antdKomponenten(farbenHell, 'kompakt').Switch).toMatchObject({ trackHeight: 24 });
    expect(antdKomponenten(farbenHell, 'komfortabel').Switch).toMatchObject({ trackHeight: 48 });
    expect(antdKomponenten(farbenHell, 'handschuh').Switch).toMatchObject({ trackHeight: 72 });
  });
});

/**
 * Tab (LFH-724): antd rechnet ihn aus der SCHRIFT, `2 × paddingSM + (fontSize + 8)` — gemessen
 * 35,5 / 45 / 55 px, also unter der Staffel in `komfortabel` und `handschuh`. Den Collapse-Kopf
 * trägt `antdKlappkopf` (LFH-653). Die Böden stehen als LITERALE da; die gerenderte Höhe misst
 * `e2e/trefflaeche-pruefflaechen.spec.ts`.
 */
describe('Tab-Kopfzeile (LFH-724)', () => {
  const STUFEN: Dichte[] = ['kompakt', 'komfortabel', 'handschuh'];
  const BODEN: Record<Dichte, number> = { kompakt: 30, komfortabel: 48, handschuh: 72 };
  /** antds Zeilenhöhe der Grundschrift: `fontSize + 8` (`getLineHeight`). */
  const zeile = (d: Dichte) => dichten[d].schriftgroesse + 8;

  it('hebt die Kopfzeile je Stufe mindestens auf die Steuerhöhe 30 / 48 / 72', () => {
    for (const d of STUFEN) {
      const { polsterVertikal } = kopfzeilenMasse(dichten[d]);
      expect(2 * polsterVertikal + zeile(d), d).toBeGreaterThanOrEqual(BODEN[d]);
    }
  });

  it('lässt kompakt bei antds Vorgabe paddingSM — nur, wo die Zeile zu niedrig wäre, wächst sie', () => {
    expect(kopfzeilenMasse(dichten.kompakt).polsterVertikal).toBe(dichten.kompakt.abstand.sm);
    // Und kein Aufblähen über den Boden hinaus: in handschuh genau 72.
    expect(2 * kopfzeilenMasse(dichten.handschuh).polsterVertikal + zeile('handschuh')).toBe(72);
  });

  it('antdKomponenten trägt das Polster der GEWÄHLTEN Stufe am Tab, den Collapse-Kopf nicht', () => {
    const pv = kopfzeilenMasse(dichten.handschuh).polsterVertikal;
    expect(antdKomponenten(farbenHell, 'handschuh').Tabs).toMatchObject({
      horizontalItemPadding: `${pv}px 0`,
    });
    expect(antdKomponenten(farbenHell, 'kompakt').Tabs).toMatchObject({
      horizontalItemPadding: `${dichten.kompakt.abstand.sm}px 0`,
    });
    // Eine Regel, ein Träger: der Collapse-Kopf hängt am Kontext (`antdKlappkopf`).
    expect(antdKomponenten(farbenHell, 'handschuh').Collapse).toBeUndefined();
  });
});

/**
 * Der gewählte Radio-Knopf (Knopfform) schreibt seinen TEXT in antds `colorPrimary`, am Tag bis
 * LFH-661 6,59 : 1 und damit unter dem Tagesboden 7 : 1. Blauer Bedien-TEXT nimmt `bedienText`.
 *
 * Die Regel sitzt im global geladenen `index.css` und trifft NUR den Text. Ein Token
 * `Radio.colorPrimary` färbte auch Scheibe, `solid`-Fläche und Hover-Fläche.
 */
describe('Radio-Knopf: Text in bedienText (LFH-677)', () => {
  // `index.css` lädt global (`main.tsx`); `sprache.css` nur mit den Bausteinen, die es importieren.
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
    'utf8',
  );

  it('der gewählte Knopf und der Knopf unter dem Zeiger lesen --lfh-bedien-text', () => {
    const regel = /([^{}]*)\{\s*color:\s*var\(--lfh-bedien-text\);\s*\}/.exec(css);
    expect(regel, 'Regel mit color: var(--lfh-bedien-text)').not.toBeNull();
    const selektoren = regel![1];
    expect(selektoren).toContain('.ant-radio-button-wrapper-checked');
    // Nur der Stil `outline`: im Stil `solid` stünde `bedienText` auf satter `bedien`-Fläche.
    expect(selektoren).toContain('.ant-radio-group-outline ');
    expect(selektoren).not.toMatch(/\.ant-radio-group[\s:]/);
    expect(selektoren).toContain(':hover');
    // Gesperrte Knöpfe behalten antds Sperrfarbe.
    expect(selektoren).toContain(':not(.ant-radio-button-wrapper-disabled)');
  });

  it('kein Komponenten-Token für das Radio — der färbte auch Scheibe und Flächen', () => {
    expect(antdKomponenten(farbenHell, 'kompakt').Radio).toBeUndefined();
    expect(antdKomponenten(farbenDunkel, 'kompakt').Radio).toBeUndefined();
  });
});

/**
 * Klappkopf von antds `Collapse` (LFH-653). antd rechnet den Kopf aus Schrift und `paddingSM`
 * (gemessen 36 / 45 / 55 px), nicht aus `controlHeight`. Der Boden kommt über den Kontext; die
 * Literale sind die Staffel, nicht ihre Quelle.
 */
describe('Klappkopf folgt der Staffel (LFH-653)', () => {
  const SOLL: Record<Dichte, number> = { kompakt: 30, komfortabel: 48, handschuh: 72 };

  it('setzt den Boden der GEWÄHLTEN Stufe und stellt die Beschriftung mittig', () => {
    for (const d of Object.keys(SOLL) as Dichte[]) {
      const kopf = antdKlappkopf(d).styles;
      expect(typeof kopf, d).toBe('object');
      expect((kopf as { header?: unknown }).header, d).toEqual({
        minHeight: SOLL[d],
        alignItems: 'center',
      });
    }
  });
});

/**
 * Beschriftetes Kästchen (LFH-907): antds `label.ant-checkbox-wrapper` ist nur so hoch wie seine
 * Schrift (gemessen 21,5 / 36 px) und hat dafür kein Komponenten-Token. Der Boden ist die kurze
 * Achse aus Gate 3, 24 / 48 / 72 — in `kompakt` die kleine Steuerhöhe, nicht 30: das Kästchen
 * steht oft in einer Textzeile und bliebe dort optisch, wie es war. Literale, nicht die Quelle.
 */
describe('Beschriftetes Kästchen folgt der Staffel (LFH-907)', () => {
  const SOLL: Record<Dichte, number> = { kompakt: 24, komfortabel: 48, handschuh: 72 };

  it('setzt den Boden der GEWÄHLTEN Stufe am Label und stellt Box und Text mittig', () => {
    for (const d of Object.keys(SOLL) as Dichte[]) {
      const stile = antdKaestchen(d).styles;
      expect(typeof stile, d).toBe('object');
      expect((stile as { root?: unknown }).root, d).toEqual({
        minHeight: SOLL[d],
        alignItems: 'center',
      });
    }
  });

  it('kein Komponenten-Token für das Kästchen — antd kennt keins für die Höhe des Labels', () => {
    expect(antdKomponenten(farbenHell, 'handschuh').Checkbox).toBeUndefined();
  });
});

/**
 * Geerbter Text hält die Böden der Bedien-Leitlinie (LFH-652, Spec `textkontrast-rollen`).
 * Geprüft wird der von antd AUFGELÖSTE Token mit dem echten Algorithmus je Modus: `colorLink` ist
 * ein Seed, den die dunkle Palette umrechnet; ein bloßer Blick auf `antdToken()` sähe das nicht.
 */
describe('Geerbte Textfarben auf Textrollen (LFH-652)', () => {
  const modi = [
    ['Tag', farbenHell, false],
    ['Nacht', farbenDunkel, true],
  ] as const;

  for (const [name, farben, dunkel] of modi) {
    const aufgeloest = () =>
      antdTheme.getDesignToken({
        token: antdToken(farben),
        algorithm: antdAlgorithmus(dunkel),
      });

    it(`${name}: Link in Ruhe, unter dem Zeiger und gedrückt trägt bedienText`, () => {
      const t = aufgeloest();
      expect(t.colorLink).toBe(farben.bedienText);
      expect(t.colorLinkHover).toBe(farben.bedienText);
      expect(t.colorLinkActive).toBe(farben.bedienText);
    });

    it(`${name}: unter dem Zeiger unterstreicht der Link, statt den Ton zu wechseln`, () => {
      expect(aufgeloest().linkHoverDecoration).toBe('underline');
    });

    it(`${name}: Beschreibungstext auf gedaempft, Tertiär und Platzhalter bleiben schwach`, () => {
      const t = aufgeloest();
      expect(t.colorTextDescription).toBe(farben.gedaempft);
      expect(t.colorTextTertiary).toBe(farben.schwach);
      expect(t.colorTextPlaceholder).toBe(farben.schwach);
    });

    it(`${name}: Formularmeldung und Pflichtmarke in der Textrolle des Status`, () => {
      expect(antdKomponenten(farben, 'kompakt').Form).toEqual({
        colorError: farben.alarmText,
        colorWarning: farben.achtungText,
      });
    });

    it(`${name}: Standardknopf schreibt unter dem Zeiger und gedrückt bedienText, die Kante bleibt`, () => {
      const knopf = antdKomponenten(farben, 'kompakt').Button;
      expect(knopf).toMatchObject({
        defaultHoverColor: farben.bedienText,
        defaultActiveColor: farben.bedienText,
      });
      expect(knopf).not.toHaveProperty('defaultHoverBorderColor');
    });

    it(`${name}: Linkknopf zeigt den Zeiger als bedienFlaeche`, () => {
      expect(antdKomponenten(farben, 'kompakt').Button).toMatchObject({
        linkHoverBg: farben.bedienFlaeche,
      });
    });
  }

  it('globales colorError bleibt die Füllfarbe — Kante, Badge und Gefahrknopf lesen sie', () => {
    expect(antdToken(farbenHell)?.colorError).toBe(farbenHell.alarm);
    expect(antdToken(farbenDunkel)?.colorError).toBe(farbenDunkel.alarm);
  });
});

/**
 * Die Füße, die antd selbst baut (LFH-653): Modal-Fuß, `modal.confirm` und `Popconfirm` trennen
 * ihre Knöpfe mit `marginXS` (3 / 5 / 7 px). Eine globale Regel in `index.css` setzt den zweiten
 * Knopf auf antds `padding` (11 / 18 / 26) — die Variable löst AM KNOPF auf, wo eine
 * Komponenten-Überschreibung von `marginXS` nie ankam (D4 in
 * `openspec/changes/archive/2026-10-01-lfh-653-erfassung-handschuh-klappkopf-fuge/design.md`).
 * Quelltext statt Pixel: jsdom rechnet kein Layout, die Auflösung messen
 * `e2e/dokumente.spec.ts` und `e2e/dialogfuss-dichte.spec.ts`.
 */
describe('Fußfuge der antd-Füße (LFH-653)', () => {
  // Ohne Kommentare: sonst fiele der Kommentar über der Regel in die erste Selektorgruppe.
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('eine Regel trifft alle drei Füße mit var(--ant-padding)', () => {
    const regel = /([^{}]*)\{\s*margin-inline-start:\s*var\(--ant-padding\);\s*\}/.exec(css);
    expect(regel, 'Regel mit margin-inline-start: var(--ant-padding)').not.toBeNull();
    const selektoren = regel![1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    // `:root` hebt die Regel über antds `:where(…)`-Selektoren (Modal: vier Klassen), egal in
    // welcher Reihenfolge cssinjs und `index.css` im Dokument stehen.
    expect(
      selektoren.filter((s) => s.startsWith(':root ')),
      'jeder mit :root',
    ).toHaveLength(3);
    expect(selektoren).toEqual([
      ':root .ant-modal .ant-modal-footer > .ant-btn + .ant-btn',
      ':root .ant-modal-confirm .ant-modal-confirm-btns .ant-btn + .ant-btn',
      ':root .ant-popconfirm .ant-popconfirm-buttons .ant-btn + .ant-btn',
    ]);
  });
});

/**
 * Die Feldmeldung eines Formulars (`.ant-form-item-explain-error`) schreibt ihren TEXT in antds
 * `colorError` = `alarm`, am Tag 5,67 : 1 auf `grund` und damit unter dem Tagesboden 7 : 1.
 * Roter TEXT nimmt `alarmText` (LFH-618). Der Komponententoken trifft nur das Formular;
 * `colorError` global umzustellen färbte auch Gefahrknöpfe und Ränder, und dort ist die
 * Füllfarbe richtig.
 */
describe('Feldmeldung: Text in alarmText (LFH-667)', () => {
  it.each([
    ['Tag', farbenHell],
    ['Nacht', farbenDunkel],
  ])('%s: das Formular liest colorError = alarmText', (_modus, farben) => {
    // `toMatchObject`: LFH-652 setzt am Formular zusätzlich `colorWarning = achtungText`.
    expect(antdKomponenten(farben, 'kompakt').Form).toMatchObject({ colorError: farben.alarmText });
  });

  it.each([
    ['Tag', farbenHell],
    ['Nacht', farbenDunkel],
  ])('%s: das globale colorError bleibt die Füllfarbe alarm', (_modus, farben) => {
    expect(antdToken(farben)?.colorError).toBe(farben.alarm);
  });
});
