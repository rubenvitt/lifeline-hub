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
import { abstand, farbenDunkel, farbenHell, form, schrift, type Farbrollen } from './tokens';

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
