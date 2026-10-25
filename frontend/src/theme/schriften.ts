/* Gestaltungssprache „E · Lagekarte nachts" (LFH-352 · A0) — Schriftrollen.

   LOKAL AUSGELIEFERT, NIE ÜBER EIN CDN. Der Fükw arbeitet ohne Netz; eine
   Schrift, die erst geladen werden muss, ist im Einsatz keine. Vite hasht die
   woff2 ins Bundle, rust-embed nimmt sie ins Binary.

   Alle vier Familien stehen unter SIL OFL 1.1; Herkunft und Lizenztexte in
   `src/assets/fonts/LIESMICH.md` bzw. `src/assets/fonts/lizenzen/`.
   Gesamtbudget 164,7 KB in 9 Schnitten — der Deckel aus LFH-352 liegt bei 200 KB.
   Archivo 600 und JetBrains Mono 500 kamen mit dem Neuentwurf „Instrumententafel"
   (21.09.2026) dazu: Seitentitel/Augenbraue tragen 600, Datenwerte Mono 500.

   ROLLEN (die Namen stehen auch in `tokens.ts` und `rollen.css`):
     LFH Archivo         Fließtext, Formulare, Listen
     LFH Archivo Narrow  Köpfe und Sektionsmarken — kartografisch, schmal
     LFH JetBrains Mono  alle fachlichen Zahlen (Stärke, DTG, Koordinaten, Nummern)
     Einsatzzeichen Sans Text in taktischen Zeichen (LFH-1033): Bedingungszeichen der
                         Fernmeldeskizze und Kürzel der Katalogzeichen. Die Datei kommt aus
                         `@einsatzzeichen/core/fonts`, damit sie zu den Metriken passt, an
                         denen das Paket Breiten misst; sie wandert mit jedem Update mit. Der
                         Familienname ist der, den die Renderer schreiben
                         (`TEXT_FONT_FAMILY_ATTR`; bis Paket 5.x hieß sie Arimo, LLH-1159).

   Angemeldet über die FontFace-API, nicht per `@font-face` (LFH-1108, `druck/AGENTS.md`,
   Schriften im Druck).

   `display: 'swap'` ist Absicht: lieber sofort in der Systemschrift lesbar
   als eine Sekunde lang gar nichts — im Einsatz zählt der erste Blick.

   VOR DEM ERSTEN BILD (LLH-1272): Die Bildschirm-Schnitte (`bildschirm`) lädt die App sofort, und
   `main.tsx` rendert erst, wenn sie da sind, höchstens aber nach `SCHRIFT_FRIST_MS`. Sonst stand
   das erste Bild in der Ersatzschrift (auf Linux DejaVu Sans, breiter als Archivo), und an der
   Umbruchkante sprang der Kopf nach dem Schriftwechsel von zwei Zeilen auf eine. Die Abwägung oben
   bleibt: Die Frist liegt weit unter einer Sekunde, ein langsamer oder gescheiterter Schnitt
   tauscht danach wie bisher. Herleitung:
   `openspec/changes/archive/2026-10-25-rr7jhc12-schriften-vor-erstem-bild/design.md`. */

import archivo400 from '../assets/fonts/archivo-400.woff2';
import archivo500 from '../assets/fonts/archivo-500.woff2';
import archivo600 from '../assets/fonts/archivo-600.woff2';
import archivo700 from '../assets/fonts/archivo-700.woff2';
import archivoNarrow600 from '../assets/fonts/archivo-narrow-600.woff2';
import jetbrainsMono400 from '../assets/fonts/jetbrains-mono-400.woff2';
import jetbrainsMono500 from '../assets/fonts/jetbrains-mono-500.woff2';
import jetbrainsMono600 from '../assets/fonts/jetbrains-mono-600.woff2';
import { TEXT_FONT_FAMILY_ATTR } from '@einsatzzeichen/core';
import zeichenText500 from '@einsatzzeichen/core/fonts/text-medium.woff2';

/**
 * Ein Schnitt einer Schriftrolle: Familie, Gewicht und Adresse der woff2. `bildschirm` heißt: das
 * erste Bild wartet auf ihn (LLH-1272), weil er Zeilen trägt, deren Breite den Umbruch des Rahmens
 * entscheidet. Archivo 700 und JetBrains Mono 600 tun das nicht, die Einsatzzeichen braucht erst
 * eine Karte oder Skizze.
 */
export interface Schriftschnitt {
  familie: string;
  gewicht: number;
  datei: string;
  bildschirm?: true;
}

/**
 * Höchstens so lange wartet das erste Bild auf die Bildschirm-Schnitte (LLH-1272, design.md D4):
 * unter der Schwelle, ab der ein leerer Schirm als Warten auffällt; aus dem HTTP-Cache dauern sie
 * wenige Millisekunden.
 */
export const SCHRIFT_FRIST_MS = 300;

export const SCHRIFTSCHNITTE: readonly Schriftschnitt[] = [
  { familie: 'LFH Archivo', gewicht: 400, datei: archivo400, bildschirm: true },
  { familie: 'LFH Archivo', gewicht: 500, datei: archivo500, bildschirm: true },
  { familie: 'LFH Archivo', gewicht: 600, datei: archivo600, bildschirm: true },
  { familie: 'LFH Archivo', gewicht: 700, datei: archivo700 },
  { familie: 'LFH Archivo Narrow', gewicht: 600, datei: archivoNarrow600, bildschirm: true },
  { familie: 'LFH JetBrains Mono', gewicht: 400, datei: jetbrainsMono400, bildschirm: true },
  { familie: 'LFH JetBrains Mono', gewicht: 500, datei: jetbrainsMono500, bildschirm: true },
  { familie: 'LFH JetBrains Mono', gewicht: 600, datei: jetbrainsMono600 },
  { familie: TEXT_FONT_FAMILY_ATTR, gewicht: 500, datei: zeichenText500 },
];

/**
 * Meldet alle Schnitte an. Die Bildschirm-Schnitte lädt sie sofort; das Ergebnis erfüllt sich,
 * sobald sie geladen sind, spätestens nach `SCHRIFT_FRIST_MS` (LLH-1272). Ein gescheiterter Schnitt
 * zählt als fertig, sein Text steht dann in der Ersatzschrift. Den Rest lädt die App, sobald die
 * Seite geladen ist und der Browser Luft hat, denn der Druck setzt ihn (Archivo 700 in
 * Markdown-Fettdruck). `wait` ist die Uhr der Frist.
 */
export function registerSchriften(
  menge: FontFaceSet = document.fonts,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((fertig) => setTimeout(fertig, ms)),
): Promise<void> {
  const schnitte = SCHRIFTSCHNITTE.map((s) => {
    const schnitt = new FontFace(s.familie, `url(${JSON.stringify(s.datei)}) format('woff2')`, {
      weight: String(s.gewicht),
      style: 'normal',
      display: 'swap',
    });
    menge.add(schnitt);
    return { schnitt, bildschirm: s.bildschirm === true };
  });
  const bildschirm = Promise.all(
    schnitte
      .filter((s) => s.bildschirm)
      .map((s) =>
        s.schnitt.load().then(
          () => undefined,
          () => undefined,
        ),
      ),
  );
  const loadAll = () => {
    for (const s of schnitte) if (!s.bildschirm) s.schnitt.load().catch(() => undefined);
  };
  const afterIdle = () =>
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(loadAll, { timeout: 5000 })
      : setTimeout(loadAll, 1000);
  if (document.readyState === 'complete') afterIdle();
  else window.addEventListener('load', afterIdle, { once: true });
  return Promise.race([bildschirm.then(() => undefined), wait(SCHRIFT_FRIST_MS)]);
}
