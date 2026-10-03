// LFH-813: Hält der Browser `break-after: avoid` am Seitenende ein?
// Ein Titel (h2) wird 840–1000 px tief auf Seite 1 geschoben, danach folgen Absätze mit
// `break-inside: avoid`. „TITEL-ALLEIN“: der Titel steht auf Seite 1, sein Text erst auf Seite 2.
// Aufruf: FF_BIN=… node minimalprobe.mjs firefox   |   CR_BIN=… node minimalprobe.mjs chrome
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [b] = process.argv.slice(2);
const datei = join(mkdtempSync(join(tmpdir(), 'minimalprobe-')), 'probe.pdf');
const browser = await puppeteer.launch(
  b === 'firefox'
    ? { browser: 'firefox', executablePath: process.env.FF_BIN, headless: true }
    : { browser: 'chrome', executablePath: process.env.CR_BIN, headless: true, args: ['--no-sandbox'] },
);
const page = await browser.newPage();
const ergebnis = {};
for (const [name, fall] of [['block', 'div'], ['tabellenzelle', 'td']]) {
  for (let platz = 840; platz <= 1000; platz += 20) {
    const inhalt =
      `<div style="height:${platz}px">Platzhalter</div><h2>TITEL-MARKE</h2>` +
      Array.from({ length: 3 }, (_, i) => `<p>Absatz ${i} ` + 'Wort '.repeat(160) + '</p>').join('');
    const html =
      `<style>@page{size:A4;margin:15mm} h2{break-after:avoid;margin:0} p{break-inside:avoid;margin:0 0 8px}</style>` +
      (fall === 'td' ? `<table><tbody><tr><td>${inhalt}</td></tr></tbody></table>` : `<div>${inhalt}</div>`);
    await page.setContent(html);
    writeFileSync(datei, await page.pdf({ format: 'A4' }));
    const s1 = execFileSync('pdftotext', ['-f', '1', '-l', '1', datei, '-']).toString();
    const titelS1 = s1.includes('TITEL-MARKE');
    const absatzS1 = s1.includes('Absatz 0');
    (ergebnis[name] ??= []).push(
      `${platz}:${titelS1 && !absatzS1 ? 'TITEL-ALLEIN' : titelS1 ? 'mit-text' : 'titel-S2'}`,
    );
  }
}
console.log(b, JSON.stringify(ergebnis));
await browser.close();
