/**
 * Hält die zwei Seiten der Gestaltungssprache deckungsgleich (LFH-352 · A0): `tokens.ts` (TS,
 * für antd) und `rollen.css` (Custom Properties für handgeschriebenes CSS) tragen dieselben
 * Werte. Eine Drift bricht nichts; die antd-Fläche trüge nur eine andere Farbe als das CSS
 * daneben. Die CSS-Datei wird als TEXT gelesen, nicht über einen Vite-Import.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  abstand,
  dichten,
  farbenDunkel,
  farbenHell,
  form,
  schrift,
  type Abstandsraster,
  type Dichte,
  type Farbrollen,
} from './tokens';
import { theme } from 'antd';
import { seitenrinne } from './tokens';
import { SCHRIFTSCHNITTE } from './schriften';
import {
  etbTypFarbenDunkel,
  etbTypFarbenHell,
  rahmenFarben,
  schriftskala,
  dichteFaktor,
  groessenstufen,
  WACHSENDE_STUFEN,
  type Groessenstufe,
  warnstufeFarbenDunkel,
  warnstufeFarbenHell,
  type EtbTypTon,
  type Schriftstufenname,
  type WarnstufeBalken,
} from './tokens';

const hier = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(hier, 'rollen.css'), 'utf-8');

/** Schneidet einen Selektor-Block heraus und liest seine `--lfh-*`-Deklarationen. Sucht den
 *  Selektor am ZEILENANFANG, sonst fände `indexOf` zuerst seine Erwähnung im Kopfkommentar
 *  der CSS-Datei. */
function block(selektor: string): Record<string, string> {
  // Vollständiges RegExp-Escaping inkl. Backslash (CodeQL).
  const muster = selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const treffer = new RegExp(`^${muster}\\s*\\{`, 'm').exec(css);
  if (!treffer) throw new Error(`Selektor ${selektor} fehlt in rollen.css`);
  const i = treffer.index;
  const auf = css.indexOf('{', i);
  const zu = css.indexOf('\n}', auf);
  const inhalt = css.slice(auf + 1, zu);
  const werte: Record<string, string> = {};
  for (const [, name, wert] of inhalt.matchAll(/(--lfh-[\w-]+):\s*([^;]+);/g)) {
    werte[name] = wert.trim();
  }
  return werte;
}

const hell = block(':root');
const dunkel = block("[data-theme='dark']");

/** Die drei Dichtestufen und ihr Block. `kompakt` lebt unter `:root` — sie ist
 *  der Ausgangszustand, nicht eine Abweichung davon. */
const DICHTE_BLOECKE: Record<Dichte, Record<string, string>> = {
  kompakt: hell,
  komfortabel: block("[data-dichte='komfortabel']"),
  handschuh: block("[data-dichte='handschuh']"),
};

/** Abstandsstufe in TS → Property-Name in CSS. Die Namen laufen auseinander
 *  (`xs/sm/md/lg` gegen `luft-1..4`), deshalb eine Abbildung. */
const LUFT_ABBILDUNG: Record<keyof Abstandsraster, string> = {
  xs: '--lfh-luft-1',
  sm: '--lfh-luft-2',
  md: '--lfh-luft-3',
  lg: '--lfh-luft-4',
};

/** Alles, was eine Dichtestufe ausmacht — und nichts sonst. */
const DICHTE_PROPERTIES = [
  ...Object.values(LUFT_ABBILDUNG),
  '--lfh-zeilenhoehe',
  '--lfh-schriftgroesse',
  '--lfh-schrift-faktor',
];

/** Rollenname in TS → Property-Name in CSS. */
const FARB_ABBILDUNG: Record<keyof Farbrollen, string> = {
  grund: '--lfh-grund',
  flaeche: '--lfh-flaeche',
  flaeche2: '--lfh-flaeche-2',
  linie: '--lfh-linie',
  linieStark: '--lfh-linie-stark',
  rasterLinie: '--lfh-raster-linie',
  text: '--lfh-text',
  gedaempft: '--lfh-gedaempft',
  schwach: '--lfh-schwach',
  bedien: '--lfh-bedien',
  alarm: '--lfh-alarm',
  achtung: '--lfh-achtung',
  normal: '--lfh-normal',
  marke: '--lfh-marke',
  markeGlut: '--lfh-marke-glut',
  alarmFuellung: '--lfh-alarm-fuellung',
  alarmFuellungStark: '--lfh-alarm-fuellung-stark',
  achtungFuellung: '--lfh-achtung-fuellung',
  achtungFuellungStark: '--lfh-achtung-fuellung-stark',
  normalFuellung: '--lfh-normal-fuellung',
  kopf: '--lfh-kopf',
  paneel: '--lfh-paneel',
  flaeche3: '--lfh-flaeche-3',
  text2: '--lfh-text-2',
  steuerRahmen: '--lfh-steuer-rahmen',
  bedienHover: '--lfh-bedien-hover',
  bedienText: '--lfh-bedien-text',
  aufBedien: '--lfh-auf-bedien',
  normalText: '--lfh-normal-text',
  achtungText: '--lfh-achtung-text',
  alarmText: '--lfh-alarm-text',
  alarmHover: '--lfh-alarm-hover',
  normalFlaeche: '--lfh-normal-flaeche',
  achtungFlaeche: '--lfh-achtung-flaeche',
  alarmFlaeche: '--lfh-alarm-flaeche',
  bedienFlaeche: '--lfh-bedien-flaeche',
  auswahlFlaeche: '--lfh-auswahl-flaeche',
  gesperrt: '--lfh-gesperrt',
  bannerGrund: '--lfh-banner-grund',
  bannerLinie: '--lfh-banner-linie',
  berichtigungZeile: '--lfh-berichtigung-zeile',
  lueckeZeile: '--lfh-luecke-zeile',
  problemZeile: '--lfh-problem-zeile',
  zeichenPlatte: '--lfh-zeichen-platte',
  uebungFuellung: '--lfh-uebung-fuellung',
  uebungSchraffur: '--lfh-uebung-schraffur',
  uebungText: '--lfh-uebung-text',
  uebungKante: '--lfh-uebung-kante',
};

/** ETB-Typ → die zwei Properties (Kante, Typwort). Exhaustiv über {@link EtbTypTon}:
 *  ein siebter Typ bricht hier den Typcheck, statt still ohne CSS-Seite zu bleiben. */
const ETB_ABBILDUNG: Record<EtbTypTon, { kante: string; wort: string }> = {
  meldung: { kante: '--lfh-etb-meldung-kante', wort: '--lfh-etb-meldung-wort' },
  anordnung: { kante: '--lfh-etb-anordnung-kante', wort: '--lfh-etb-anordnung-wort' },
  entscheidung: { kante: '--lfh-etb-entscheidung-kante', wort: '--lfh-etb-entscheidung-wort' },
  lage: { kante: '--lfh-etb-lage-kante', wort: '--lfh-etb-lage-wort' },
  berichtigung: { kante: '--lfh-etb-berichtigung-kante', wort: '--lfh-etb-berichtigung-wort' },
  system: { kante: '--lfh-etb-system-kante', wort: '--lfh-etb-system-wort' },
};

const WARNSTUFE_ABBILDUNG: Record<WarnstufeBalken, string> = {
  niedrig: '--lfh-warnstufe-niedrig',
  mittel: '--lfh-warnstufe-mittel',
  hoch: '--lfh-warnstufe-hoch',
  akut: '--lfh-warnstufe-akut',
};

/** Der modusunabhängige Rahmen (Kommandoleiste + Rail). Steht NUR unter `:root`. */
const RAHMEN_ABBILDUNG: Record<keyof typeof rahmenFarben, string> = {
  grund: '--lfh-rahmen-grund',
  aktiv: '--lfh-rahmen-aktiv',
  feld: '--lfh-rahmen-feld',
  linie: '--lfh-rahmen-linie',
  text: '--lfh-rahmen-text',
  gedaempft: '--lfh-rahmen-gedaempft',
  gesperrt: '--lfh-rahmen-gesperrt',
  alarm: '--lfh-rahmen-alarm',
  bedien: '--lfh-rahmen-bedien',
};

/** Schriftstufe → Präfix der Properties (`-groesse`, `-gewicht`, `-sperrung`). */
const TYPO_ABBILDUNG: Record<Schriftstufenname, string> = {
  ueberschrift: '--lfh-typo-ueberschrift',
  seitentitel: '--lfh-typo-seitentitel',
  uhr: '--lfh-typo-uhr',
  text: '--lfh-typo-text',
  warnung: '--lfh-typo-warnung',
  textKlein: '--lfh-typo-text-klein',
  etikett: '--lfh-typo-etikett',
  augenbraue: '--lfh-typo-augenbraue',
  railEtikett: '--lfh-typo-rail-etikett',
  meta: '--lfh-typo-meta',
  datenwertKlein: '--lfh-typo-datenwert-klein',
  datenwert: '--lfh-typo-datenwert',
  datenwertGross: '--lfh-typo-datenwert-gross',
};

/** Alles, was der Nachtmodus überschreiben MUSS: Farbrollen, ETB-Typfarben, Balken. */
const MODUS_PROPERTIES = [
  ...Object.values(FARB_ABBILDUNG),
  ...Object.values(ETB_ABBILDUNG).flatMap((p) => [p.kante, p.wort]),
  ...Object.values(WARNSTUFE_ABBILDUNG),
];

describe('Gestaltungssprache E — CSS und TS tragen dieselben Werte', () => {
  it.each(Object.keys(FARB_ABBILDUNG) as (keyof Farbrollen)[])(
    'Tagmodus: %s stimmt überein',
    (rolle) => {
      expect(hell[FARB_ABBILDUNG[rolle]]).toBe(farbenHell[rolle]);
    },
  );

  it.each(Object.keys(FARB_ABBILDUNG) as (keyof Farbrollen)[])(
    'Nachtmodus: %s stimmt überein',
    (rolle) => {
      expect(dunkel[FARB_ABBILDUNG[rolle]]).toBe(farbenDunkel[rolle]);
    },
  );

  it('der Nachtmodus überschreibt genau die Farbrollen — keine mehr, keine weniger', () => {
    // Form, Raster, Schrift und Rahmen sind modusunabhängig und dürfen im dark-Block NICHT
    // noch einmal auftauchen; ETB-Typfarben und Warnstufen-Balken existieren je Modus.
    expect(Object.keys(dunkel).sort()).toEqual([...MODUS_PROPERTIES].sort());
  });

  it.each(Object.keys(ETB_ABBILDUNG) as EtbTypTon[])(
    'ETB-Typ %s: Kante und Wort je Modus',
    (typ) => {
      const p = ETB_ABBILDUNG[typ];
      expect(hell[p.kante]).toBe(etbTypFarbenHell[typ].kante);
      expect(hell[p.wort]).toBe(etbTypFarbenHell[typ].wort);
      expect(dunkel[p.kante]).toBe(etbTypFarbenDunkel[typ].kante);
      expect(dunkel[p.wort]).toBe(etbTypFarbenDunkel[typ].wort);
    },
  );

  it.each(Object.keys(WARNSTUFE_ABBILDUNG) as WarnstufeBalken[])(
    'Warnstufen-Balken %s je Modus',
    (stufe) => {
      expect(hell[WARNSTUFE_ABBILDUNG[stufe]]).toBe(warnstufeFarbenHell[stufe]);
      expect(dunkel[WARNSTUFE_ABBILDUNG[stufe]]).toBe(warnstufeFarbenDunkel[stufe]);
    },
  );

  it('Abstandsraster stimmt überein', () => {
    expect(hell['--lfh-luft-1']).toBe(`${abstand.xs}px`);
    expect(hell['--lfh-luft-2']).toBe(`${abstand.sm}px`);
    expect(hell['--lfh-luft-3']).toBe(`${abstand.md}px`);
    expect(hell['--lfh-luft-4']).toBe(`${abstand.lg}px`);
  });

  it('Form- und Stimmrollen stimmen überein', () => {
    expect(hell['--lfh-radius-flaeche']).toBe(String(form.radiusFlaeche));
    expect(hell['--lfh-radius-steuer']).toBe(String(form.radiusSteuer));
    expect(hell['--lfh-radius-marke']).toBe(String(form.radiusMarke));
    expect(hell['--lfh-zeilenhoehe']).toBe(`${form.zeilenhoehe}px`);
    expect(hell['--lfh-schriftgroesse']).toBe(`${form.schriftgroesse}px`);
    expect(hell['--lfh-versal-sperrung']).toBe(form.versalSperrung);
    expect(hell['--lfh-uebergang']).toBe(form.uebergang);
  });

  it('Schriftrollen stimmen überein', () => {
    expect(hell['--lfh-schrift-text']).toBe(schrift.text);
    expect(hell['--lfh-schrift-display']).toBe(schrift.display);
    expect(hell['--lfh-schrift-zahl']).toBe(schrift.zahl);
  });
});

describe('Dichte-Staffel — CSS und TS tragen dieselben Stufen (LFH-328 · A2)', () => {
  it.each(Object.keys(DICHTE_BLOECKE) as Dichte[])('%s stimmt Wert für Wert überein', (stufe) => {
    const css_ = DICHTE_BLOECKE[stufe];
    const ts = dichten[stufe];
    for (const [schluessel, property] of Object.entries(LUFT_ABBILDUNG)) {
      expect(css_[property], `${stufe}.${schluessel}`).toBe(
        `${ts.abstand[schluessel as keyof Abstandsraster]}px`,
      );
    }
    expect(css_['--lfh-zeilenhoehe']).toBe(`${ts.zeilenhoehe}px`);
    expect(css_['--lfh-schriftgroesse']).toBe(`${ts.schriftgroesse}px`);
    // Der Faktor der Schrift (LLH-1774): `kompakt` trägt ihn unter `:root`.
    expect(css_['--lfh-schrift-faktor']).toBe(String(dichteFaktor[stufe]));
  });

  it('die beiden Nicht-:root-Stufen überschreiben genau die Dichte-Properties', () => {
    // GENAU diese Menge: eine vergessene Property fiele still auf `:root` zurück, eine
    // zusätzliche koppelte Farbe oder Form an die Dichte.
    for (const stufe of ['komfortabel', 'handschuh'] as const) {
      expect(Object.keys(DICHTE_BLOECKE[stufe]).sort(), stufe).toEqual(
        [...DICHTE_PROPERTIES].sort(),
      );
    }
  });

  it('B1 liefert den Schalter — genau EIN Setzer, und der sitzt in ThemeModeProvider', () => {
    // Der Dichte-Schalter existiert GENAU EINMAL: zwei Setzer überschrieben sich gegenseitig ohne
    // Fehler. `/src/theme/` ist absichtlich nicht ausgenommen, denn dort sitzt der Setzer.
    // Ausgenommen sind Testdateien und Kommentarzeilen. Verglichen wird auf Datei-Ebene: Setzen
    // plus Aufräumen in einer Datei ist kein Verstoß.
    const quellen = import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      eager: true,
    }) as Record<string, { default: string }>;
    const setzer = Object.entries(quellen)
      .filter(([pfad]) => !/\.test\.[jt]sx?$/.test(pfad))
      .flatMap(([pfad, modul]) =>
        modul.default
          .split('\n')
          .map((zeile, i) => [zeile, i + 1] as const)
          .filter(([zeile]) => !/^\s*(\/\/|\/\*|\*)/.test(zeile))
          .filter(([zeile]) => /dataset\.dichte\s*=|['"]?data-dichte['"]?\s*[=,]/.test(zeile))
          .map(([, nr]) => `${pfad}:${nr}`),
      );
    expect(
      [...new Set(setzer.map((treffer) => treffer.split(':')[0]))],
      'die Dichte-Umschaltung gehört an GENAU EINE Stelle',
    ).toEqual(['/src/theme/ThemeModeProvider.tsx']);
  });
});

describe('Gestaltungssprache E — die Entscheidungen selbst', () => {
  it('Rot bedient nichts: die Bedienfarbe ist in keinem Modus die Marke (LFH-315)', () => {
    expect(farbenHell.bedien).not.toBe(farbenHell.marke);
    expect(farbenDunkel.bedien).not.toBe(farbenDunkel.marke);
    // …und auch nicht der Alarm — sonst läse sich ein Fokus-Ring als Fehler.
    expect(farbenHell.bedien).not.toBe(farbenHell.alarm);
    expect(farbenDunkel.bedien).not.toBe(farbenDunkel.alarm);
  });

  it('jede Statusrolle ist in beiden Modi verschieden von den anderen', () => {
    for (const farben of [farbenHell, farbenDunkel]) {
      const status = [farben.alarm, farben.achtung, farben.normal];
      expect(new Set(status).size).toBe(3);
    }
  });

  it('die Schriften werden lokal referenziert, nie über ein CDN', () => {
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:/);
    for (const familie of Object.values(schrift)) {
      expect(familie).toMatch(/^'LFH /);
    }
  });
});

/** Schneidet den `:root`-Block aus DEM Media-Block, der ab der genannten Mindestbreite greift,
 *  und liest seine `--lfh-*`-Deklarationen. Die Schwelle steht im Regex, damit ein zweiter
 *  Media-Block (etwa `max-width`) nicht mitgelesen wird. */
function medienblock(mindestbreite: number): Record<string, string> {
  const treffer = new RegExp(`^@media \\(min-width: ${mindestbreite}px\\)\\s*\\{`, 'm').exec(css);
  if (!treffer) throw new Error(`Kein @media-Block ab ${mindestbreite}px in rollen.css`);
  const auf = css.indexOf('{', treffer.index);
  const zu = css.indexOf('\n}', auf);
  const werte: Record<string, string> = {};
  for (const [, name, wert] of css.slice(auf + 1, zu).matchAll(/(--lfh-[\w-]+):\s*([^;]+);/g)) {
    werte[name] = wert.trim();
  }
  return werte;
}

describe('Seitenrinne — CSS und TS tragen dieselben Stufen (LFH-329 · B1)', () => {
  it(':root trägt die schmale Rinne', () => {
    // Mobil zuerst: ohne Media-Kontext gilt der sichere, schmale Wert.
    expect(hell['--lfh-seiten-polsterung']).toBe(`${seitenrinne.schmal}px`);
  });

  it('der Haupt-`:root`-Block wird vom Media-Block nicht beschattet', () => {
    // Gegenprobe: `block(':root')` nimmt den ERSTEN Treffer am Zeilenanfang. Läge der Media-Block
    // davor, liefen die Farbvergleiche oben still gegen die falschen Werte.
    expect(hell['--lfh-grund']).toBe(farbenHell.grund);
  });

  it('ab der md-Schwelle trägt sie die volle Rinne', () => {
    // Die Schwelle ist antds `md`, damit CSS- und JS-Achse dieselbe Zahl tragen.
    const md = theme.getDesignToken().screenMD;
    expect(md).toBe(768);
    expect(medienblock(md)['--lfh-seiten-polsterung']).toBe(`${seitenrinne.breit}px`);
  });

  it('die Seitenrinne steht in keinem Dichte-Block (Viewport ≠ Dichte)', () => {
    // Folgt schon aus dem Partitionstest oben, hier mit benannter Diagnose.
    expect(DICHTE_BLOECKE.komfortabel['--lfh-seiten-polsterung']).toBeUndefined();
    expect(DICHTE_BLOECKE.handschuh['--lfh-seiten-polsterung']).toBeUndefined();
  });
});

describe('Rahmen — modusunabhängig dunkel (Neuentwurf, 21.09.2026)', () => {
  it.each(Object.keys(RAHMEN_ABBILDUNG) as (keyof typeof rahmenFarben)[])(
    '%s steht unter :root mit dem Wert aus tokens.ts',
    (rolle) => {
      expect(hell[RAHMEN_ABBILDUNG[rolle]]).toBe(rahmenFarben[rolle]);
    },
  );

  it('kein Rahmenwert hat einen Nachtmodus-Gegenwert — der Rahmen folgt keinem Modus', () => {
    // Folgt schon aus der Partition oben; hier mit benannter Diagnose, weil genau dieser Eintrag
    // der naheliegende Fehler ist.
    for (const property of [...Object.values(RAHMEN_ABBILDUNG), '--lfh-kopf-vordergrund']) {
      expect(dunkel[property], property).toBeUndefined();
    }
  });

  it('der Rahmen ist die Nachtpalette, nicht eine Kopie daneben', () => {
    // Literale statt `farbenDunkel.x`: der Rahmen bleibt auch dunkel, wenn jemand die Zeiger in
    // `rahmenFarben` auf `farbenHell` umbiegt.
    expect(rahmenFarben.grund).toBe('#0c0e11');
    expect(rahmenFarben.text).toBe('#e8ebee');
    // Der Rahmen ist keine Inhaltsfläche: seit den vier Flächenstufen (Change
    // `eon26eat-farbe-entlasten`, D5) hält er seine Werte selbst, statt auf `kopf`, `flaeche3`
    // und `flaeche2` zu zeigen. #0c0e11 ist zugleich das Kopf-Schwarz von Bildmarke und PWA.
    expect(rahmenFarben.aktiv).toBe('#16191d');
    expect(rahmenFarben.feld).toBe('#14171b');
  });

  it('der Kopf-Vordergrund ist der Rahmentext — eine Vordergrundfarbe, nicht zwei', () => {
    expect(hell['--lfh-kopf-vordergrund']).toBe(rahmenFarben.text);
  });
});

describe('Schriftskala — CSS und TS tragen dieselben Stufen (LLH-1773/LLH-1775)', () => {
  it.each(Object.keys(groessenstufen) as Groessenstufe[])(
    'Größenstufe %s stimmt überein und wächst nur, wenn sie soll',
    (stufe) => {
      const px = groessenstufen[stufe];
      expect(hell[`--lfh-groesse-${stufe}`]).toBe(
        WACHSENDE_STUFEN.has(stufe) ? `calc(${px}px * var(--lfh-schrift-faktor))` : `${px}px`,
      );
    },
  );

  it('die CSS-Seite trägt keine Größenstufe, die TS nicht kennt', () => {
    const bekannt = new Set(Object.keys(groessenstufen).map((s) => `--lfh-groesse-${s}`));
    const fremd = Object.keys(hell).filter(
      (k) => k.startsWith('--lfh-groesse-') && !bekannt.has(k),
    );
    expect(fremd).toEqual([]);
  });

  it.each(Object.keys(TYPO_ABBILDUNG) as Schriftstufenname[])(
    'Rolle %s stimmt überein',
    (rolle) => {
      const praefix = TYPO_ABBILDUNG[rolle];
      const ts: { stufe: Groessenstufe; gewicht: number; sperrung?: string } = schriftskala[rolle];
      expect(hell[`${praefix}-groesse`]).toBe(`var(--lfh-groesse-${ts.stufe})`);
      expect(hell[`${praefix}-gewicht`]).toBe(String(ts.gewicht));
      // Auch die ABWESENHEIT wird geprüft: eine Sperrung nur auf einer Seite ist Drift.
      expect(hell[`${praefix}-sperrung`]).toBe(ts.sperrung);
    },
  );

  it('die CSS-Seite trägt keine Rolle, die TS nicht kennt', () => {
    const bekannt = new Set(
      Object.values(TYPO_ABBILDUNG).flatMap((p) => [
        `${p}-groesse`,
        `${p}-gewicht`,
        `${p}-sperrung`,
      ]),
    );
    const fremd = Object.keys(hell).filter((k) => k.startsWith('--lfh-typo-') && !bekannt.has(k));
    expect(fremd).toEqual([]);
  });

  it('pinnt die Werte als Literale (umgekehrt 15.11.2026 gegenüber umsetzung.md § Form & Typografie)', () => {
    expect(groessenstufen).toEqual({
      fein: 11,
      klein: 12,
      text: 14,
      titel: 16,
      wert: 22,
      gross: 32,
    });
    expect(dichteFaktor).toEqual({ kompakt: 1, komfortabel: 1.15, handschuh: 1.25 });
    expect(schriftskala.augenbraue).toEqual({
      stufe: 'fein',
      gewicht: 600,
      familie: 'text',
      sperrung: '0.08em',
      versal: true,
    });
    expect(schriftskala.seitentitel).toMatchObject({ stufe: 'titel', gewicht: 600 });
    // Die Uhr ist Daueranzeige und steht hinter dem Einsatznamen (LLH-1726): Stufe `text`, sonst
    // bricht der Kopf am Handy in `handschuh` auf zwei Zeilen um (Merge mit alpha, 16.11.2026).
    expect(schriftskala.uhr).toMatchObject({ stufe: 'text', gewicht: 500, familie: 'zahl' });
    expect(schriftskala.meta).toMatchObject({ stufe: 'klein', familie: 'text' });
    expect(schriftskala.warnung).toMatchObject({ stufe: 'text', gewicht: 600 });
    expect(
      [schriftskala.datenwertKlein, schriftskala.datenwert, schriftskala.datenwertGross].map(
        (s) => [s.stufe, s.gewicht, s.familie],
      ),
    ).toEqual([
      ['wert', 500, 'zahl'],
      ['gross', 500, 'zahl'],
      ['gross', 500, 'zahl'],
    ]);
  });

  it('keine Stufe liegt unter 11 px (Spec `schriftskala`, Boden)', () => {
    expect(Math.min(...Object.values(groessenstufen))).toBe(11);
  });

  it('jeder Schnitt der Skala wird lokal ausgeliefert — kein künstlicher Fettdruck', () => {
    // Die Skala verlangt Archivo 400/500/600 und JetBrains Mono 400/500. Fehlt ein Schnitt in
    // `schriften.ts`, setzt der Browser still den nächsten.
    const familie = {
      text: 'LFH Archivo',
      zahl: 'LFH JetBrains Mono',
      display: 'LFH Archivo Narrow',
    };
    for (const stufe of Object.values(schriftskala)) {
      const fam = familie[stufe.familie];
      const treffer = SCHRIFTSCHNITTE.filter(
        (s) => s.familie === fam && s.gewicht === stufe.gewicht,
      );
      expect(treffer, `${fam} ${stufe.gewicht}`).toHaveLength(1);
    }
  });
});
