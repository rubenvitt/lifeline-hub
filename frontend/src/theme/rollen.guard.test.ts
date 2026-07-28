/**
 * Hält die zwei Seiten der Gestaltungssprache deckungsgleich (LFH-352 · A0).
 *
 * `tokens.ts` (TS, für antd) und `rollen.css` (CSS-Custom-Properties, für
 * handgeschriebenes CSS) tragen dieselben Werte. Das ist bewusste Redundanz —
 * CSS kann kein TS importieren, solange `cssVar` am ConfigProvider aus ist (die
 * Weiche ist nach A2/LFH-328 vertagt).
 *
 * WARUM DAS EINEN TEST BRAUCHT: eine Drift zwischen beiden **bricht nichts**.
 * Kein Fehler, kein roter Build — die antd-Fläche trägt dann nur eine andere
 * Farbe als die handgeschriebene daneben, und das fällt erst jemandem im Einsatz
 * auf. Dasselbe Muster wie beim Byte-Pin der Wire-Strings in `queryKeys`.
 *
 * Der Test liest die CSS-Datei als TEXT und parst sie — nicht über einen Import,
 * der von Vite transformiert würde. So prüft er, was wirklich im Repo steht.
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
// Eigene Importzeilen (LFH-329 · B1): der Bestandsblock oben bleibt so
// unangetastet, während die Seitenrinne unten ihren eigenen Guard bekommt.
import { theme } from 'antd';
import { seitenrinne } from './tokens';

const hier = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(hier, 'rollen.css'), 'utf-8');

/** Schneidet einen Selektor-Block heraus und liest seine `--lfh-*`-Deklarationen.
 *  Sucht den Selektor am ZEILENANFANG — `indexOf` fände sonst zuerst seine
 *  Erwähnung im Kopfkommentar der CSS-Datei und läse den falschen Block
 *  (gemessen: alle Nachtmodus-Prüfungen liefen gegen die Tagwerte und waren
 *  rot, obwohl beide Dateien stimmten). */
function block(selektor: string): Record<string, string> {
  const treffer = new RegExp(`^${selektor.replace(/[[\]]/g, '\\$&')}\\s*\\{`, 'm').exec(css);
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

/** Abstandsstufe in TS → Property-Name in CSS. Die Namen laufen bewusst
 *  auseinander (`xs/sm/md/lg` gegen `luft-1..4`), deshalb eine Abbildung und
 *  keine abgeleitete Namensbildung. */
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
  achtungFuellung: '--lfh-achtung-fuellung',
  normalFuellung: '--lfh-normal-fuellung',
};

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
    // Form, Raster und Schrift sind modusunabhängig und dürfen im
    // dark-Block NICHT noch einmal auftauchen; sonst driften sie unbemerkt.
    expect(Object.keys(dunkel).sort()).toEqual(Object.values(FARB_ABBILDUNG).sort());
  });

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
  });

  it('die beiden Nicht-:root-Stufen überschreiben genau die Dichte-Properties', () => {
    // Gleiche Schärfe wie beim Nachtmodus oben: GENAU diese Menge, nicht eine
    // Teilmenge. Eine vergessene Property fiele sonst still auf `:root` zurück
    // (halb umgeschaltete Stufe), eine zusätzliche würde Farbe oder Form an die
    // Dichte koppeln — beides bricht nichts und fällt erst im Einsatz auf.
    for (const stufe of ['komfortabel', 'handschuh'] as const) {
      expect(Object.keys(DICHTE_BLOECKE[stufe]).sort(), stufe).toEqual(
        [...DICHTE_PROPERTIES].sort(),
      );
    }
  });

  it('A2 liefert den Träger, nicht den Schalter — nichts setzt `data-dichte`', () => {
    // Die Umschaltung ist B5. Solange sie nicht da ist, darf kein Produktivcode
    // das Attribut setzen; sonst wäre die Stufe faktisch aktiv, ohne dass ein
    // Kontext sie begründet.
    // `/src/theme/` ist hier ABSICHTLICH NICHT ausgenommen: der Schalter käme
    // am ehesten in `ThemeModeProvider` — ein Guard, der ausgerechnet dort
    // wegsieht, bewachte nichts. Ausgenommen sind nur Testdateien und
    // Kommentarzeilen; ohne letztere meldet der Guard die eigene Begründung als
    // Verstoß (gemessen: `tokens.ts` schlug allein wegen seines Doc-Kommentars
    // an).
    const quellen = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', eager: true }) as Record<
      string,
      { default: string }
    >;
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
    expect(setzer, 'Dichte-Umschaltung gehört nach B5, nicht nach A2').toEqual([]);
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

/** Schneidet den `:root`-Block aus DEM Media-Block, der ab der genannten
 *  Mindestbreite greift, und liest seine `--lfh-*`-Deklarationen.
 *
 *  Die Schwelle steht bewusst als Argument im Regex und nicht als generisches
 *  `@media`: ein zweiter Media-Block am selben Dateiende (eine `max-width`-Regel
 *  etwa) würde sonst je nach Reihenfolge mitgelesen, und der Guard ginge aus dem
 *  falschen Grund rot. Geschnitten wird bis zur schließenden Klammer des
 *  Media-Blocks am Zeilenanfang — der eingerückte innere Block landet dabei
 *  vollständig im Ausschnitt. */
function medienblock(mindestbreite: number): Record<string, string> {
  const treffer = new RegExp(`^@media \\(min-width: ${mindestbreite}px\\)\\s*\\{`, 'm').exec(css);
  if (!treffer) throw new Error(`Kein @media-Block ab ${mindestbreite}px in rollen.css`);
  const auf = css.indexOf('{', treffer.index);
  const zu = css.indexOf('\n}', auf);
  const werte: Record<string, string> = {};
  for (const [, name, wert] of css
    .slice(auf + 1, zu)
    .matchAll(/(--lfh-[\w-]+):\s*([^;]+);/g)) {
    werte[name] = wert.trim();
  }
  return werte;
}

describe('Seitenrinne — CSS und TS tragen dieselben Stufen (LFH-329 · B1)', () => {
  it(':root trägt die schmale Rinne', () => {
    // Mobil zuerst: der Ausgangszustand ist der schmale Schirm. Wer die
    // Property ohne Media-Kontext liest, bekommt so den sicheren Wert.
    expect(hell['--lfh-seiten-polsterung']).toBe(`${seitenrinne.schmal}px`);
  });

  it('der Haupt-`:root`-Block wird vom Media-Block nicht beschattet', () => {
    // `block(':root')` ankert am Zeilenanfang und nimmt den ERSTEN Treffer. Läge
    // der Media-Block vor dem Haupt-`:root` oder wäre sein innerer Selektor
    // nicht eingerückt, liefen die 18 Farbvergleiche oben still gegen die
    // falschen Werte. Diese eine Zeile ist die Gegenprobe darauf.
    expect(hell['--lfh-grund']).toBe(farbenHell.grund);
  });

  it('ab der md-Schwelle trägt sie die volle Rinne', () => {
    // Die Schwelle wird NICHT neu erfunden: sie ist antds `md`. Damit tragen
    // die CSS-Achse (diese Datei) und jede spätere JS-Achse dieselbe Zahl.
    const md = theme.getDesignToken().screenMD;
    expect(md).toBe(768);
    expect(medienblock(md)['--lfh-seiten-polsterung']).toBe(`${seitenrinne.breit}px`);
  });

  it('die Seitenrinne steht in keinem Dichte-Block (Viewport ≠ Dichte)', () => {
    // Folgt zwar schon aus dem Partitionstest oben, liefert hier aber die
    // benannte Diagnose statt eines Mengendiffs.
    expect(DICHTE_BLOECKE.komfortabel['--lfh-seiten-polsterung']).toBeUndefined();
    expect(DICHTE_BLOECKE.handschuh['--lfh-seiten-polsterung']).toBeUndefined();
  });
});
