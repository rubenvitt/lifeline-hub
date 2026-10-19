/**
 * Deckblatt des Design Systems (`components/Cover/preview.html`): Name, Herkunft, die tragenden
 * Rollen als Farbflächen und die zwei Schriftstimmen, Nacht über Tag. Statisch und allein aus den
 * Werten in `theme/tokens.ts` gesetzt; Text steht nur in Rollen, die die App für Text auf diesem
 * Grund nutzt (`text`, `gedaempft` auf `grund`).
 */
import {
  farbenDunkel,
  farbenHell,
  schrift,
  schriftskala,
  type Farbrollen,
} from '../../src/theme/tokens';

/** Die Rollen, die das Deckblatt als Fläche zeigt — Grundstufen, Bedienung, Signale, Marke. */
const FLAECHEN: readonly (keyof Farbrollen)[] = [
  'grund',
  'paneel',
  'flaeche',
  'flaeche3',
  'linie',
  'text',
  'bedien',
  'normal',
  'achtung',
  'alarm',
  'marke',
];

function themeBand(name: string, rollen: Farbrollen): string {
  const swatches = FLAECHEN.map(
    (rolle) =>
      `<div class="feld"><div class="probe" style="background:${rollen[rolle]}"></div>` +
      `<span class="wert">${rolle}<br>${rollen[rolle]}</span></div>`,
  ).join('');
  return [
    `<section class="band" style="background:${rollen.grund};color:${rollen.text}">`,
    `<h2 class="braue" style="color:${rollen.gedaempft}">${name}</h2>`,
    `<div class="felder" style="--rand:${rollen.linie};--meta:${rollen.gedaempft}">${swatches}</div>`,
    `<p class="zahl">14:30 · 2026-1019-0042 · <span style="color:${rollen.gedaempft}">32.U.0571234.5833456</span></p>`,
    '</section>',
  ].join('\n');
}

export function buildCover(): string {
  const titel = schriftskala.ueberschrift;
  const braue = schriftskala.augenbraue;
  const css = [
    'html,body{margin:0;padding:0}',
    `body{background:${farbenDunkel.grund};font-family:${schrift.text}}`,
    `.kopf{padding:32px 24px 8px;color:${farbenDunkel.text}}`,
    `.kopf h1{margin:0;font-size:${titel.groesse}px;font-weight:${titel.gewicht};letter-spacing:${titel.sperrung}}`,
    `.kopf p{margin:8px 0 0;font-size:14px;color:${farbenDunkel.gedaempft}}`,
    '.band{padding:16px 24px 20px}',
    `.braue{margin:0 0 12px;font-size:${braue.groesse}px;font-weight:${braue.gewicht};letter-spacing:${braue.sperrung};text-transform:uppercase}`,
    '.felder{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:12px}',
    '.feld{display:flex;flex-direction:column;gap:4px}',
    '.probe{height:40px;border:1px solid var(--rand)}',
    `.wert{font-family:${schrift.zahl};font-size:11px;color:var(--meta);font-variant-numeric:tabular-nums}`,
    `.zahl{margin:16px 0 0;font-family:${schrift.zahl};font-size:22px;font-weight:500;font-variant-numeric:tabular-nums}`,
  ].join('\n');
  return [
    '<!-- @dsCard group="Deckblatt" height=680 -->',
    '<!doctype html>',
    '<html lang="de">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Lifeline Hub</title>',
    `<style>\n${css}\n</style>`,
    '</head>',
    '<body>',
    '<header class="kopf">',
    '<h1>Lifeline Hub</h1>',
    '<p>Design System, aus dem Code von rubenvitt/lifeline-hub erzeugt · Nacht ist die Vorgabe, Tag abgeleitet · Radius 0</p>',
    '</header>',
    themeBand('Nacht', farbenDunkel),
    themeBand('Tag', farbenHell),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
