#!/usr/bin/env node
// LFH-595: Jede SVG-Quelle gegen das PNG prüfen, das Icons8 für dieselbe Kennung ausliefert.
//
//   mise exec -- node scripts/icons/vergleiche-png.mjs [name …]
//
// Warum: Der Icons8-MCP gibt das SVG als Text in die Sitzung, abgelegt wird es durch Abschreiben.
// Ein vertauschtes Zeichen in den Pfaddaten bliebe unsichtbar, bis jemand das Icon ansieht. Das
// PNG (frei, `img.icons8.com/?id=…&format=png`) kommt dagegen byte-genau vom Server. Beide werden
// in Chromium auf 100 × 100 px gerendert und über die Deckkraft verglichen.
//
// Urteil je Quelle: mittlere Abweichung der Deckkraft und Anteil der Pixel mit mehr als 50 %
// Abweichung. Kantenglättung liefert kleine Werte, ein Abschreibfehler einen zusammenhängenden
// Fleck. Ohne Namen werden alle Quellen aus `icons.json` geprüft; eigene Zeichnungen haben kein
// Icons8-PNG und werden übersprungen. Exit 1, wenn eine Quelle die Schwelle reißt.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const frontend = join(hier, '..', '..', 'frontend');
const { chromium } = createRequire(join(frontend, 'package.json'))('@playwright/test');

const KANTE = 100;
/** Mittlere Abweichung der Deckkraft (0…1) und Anteil stark abweichender Pixel (0…1). */
const SCHWELLE = { mittel: 0.01, stark: 0.01 };

const register = JSON.parse(readFileSync(join(hier, 'icons.json'), 'utf8'));
const wahl = new Set(process.argv.slice(2));
const auftraege = register.icons
  .filter((e) => e.herkunft !== 'eigen')
  .flatMap((e) => [
    { datei: `${e.name}.svg`, id: e.icons8.id },
    ...(e.gefuellt ? [{ datei: `${e.name}.gefuellt.svg`, id: e.gefuellt.id }] : []),
  ])
  .filter((a) => wahl.size === 0 || wahl.has(a.datei.replace(/\.svg$/, '')));

const browser = await chromium.launch();
const seite = await browser.newPage();
let fehler = 0;
for (const { datei, id } of auftraege) {
  const antwort = await fetch(`https://img.icons8.com/?id=${id}&format=png&size=${KANTE}`);
  if (!antwort.ok) {
    console.log(`${datei.padEnd(32)} PNG nicht abrufbar (${antwort.status})`);
    fehler++;
    continue;
  }
  const png = Buffer.from(await antwort.arrayBuffer()).toString('base64');
  const svg = Buffer.from(readFileSync(join(hier, 'quellen', datei))).toString('base64');
  const urteil = await seite.evaluate(
    async ({ png, svg, kante }) => {
      const deckkraft = async (src) => {
        const bild = new Image();
        bild.src = src;
        await bild.decode();
        const c = new OffscreenCanvas(kante, kante);
        const ctx = c.getContext('2d');
        ctx.drawImage(bild, 0, 0, kante, kante);
        const d = ctx.getImageData(0, 0, kante, kante).data;
        return Array.from({ length: kante * kante }, (_, i) => d[i * 4 + 3] / 255);
      };
      const a = await deckkraft(`data:image/png;base64,${png}`);
      const b = await deckkraft(`data:image/svg+xml;base64,${svg}`);
      let summe = 0;
      let stark = 0;
      for (let i = 0; i < a.length; i++) {
        const diff = Math.abs(a[i] - b[i]);
        summe += diff;
        if (diff > 0.5) stark++;
      }
      return { mittel: summe / a.length, stark: stark / a.length };
    },
    { png, svg, kante: KANTE },
  );
  const gut = urteil.mittel <= SCHWELLE.mittel && urteil.stark <= SCHWELLE.stark;
  if (!gut) fehler++;
  console.log(
    `${datei.padEnd(32)} ${gut ? 'ok    ' : 'ABWEICHUNG'} mittel ${urteil.mittel.toFixed(4)} stark ${urteil.stark.toFixed(4)}`,
  );
}
await browser.close();
console.log(`vergleiche-png: ${auftraege.length - fehler}/${auftraege.length} gleich`);
process.exit(fehler ? 1 : 0);
