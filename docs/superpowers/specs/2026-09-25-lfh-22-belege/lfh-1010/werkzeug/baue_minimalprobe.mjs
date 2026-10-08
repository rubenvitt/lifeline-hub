// Minimalprobe aus LFH-813 (minimalprobe.mjs) als EINE statische Seite für Safari:
// jeder Fall (block/tabellenzelle × Platz 840..1000) beginnt auf einer neuen Seite,
// eindeutige Marken je Fall erlauben die Auswertung per pdftotext.
const teile = [];
for (const [name, fall] of [['block', 'div'], ['tabellenzelle', 'td']]) {
  for (let platz = 840; platz <= 1000; platz += 20) {
    const k = `${name}-${platz}`;
    const inhalt =
      `<div style="height:${platz}px">Platzhalter ${k}</div><h2>TITEL-MARKE-${k}</h2>` +
      Array.from({ length: 3 }, (_, i) => `<p>ABSATZ-${k}-${i} ` + 'Wort '.repeat(160) + '</p>').join('');
    const fallHtml = fall === 'td' ? `<table><tbody><tr><td>${inhalt}</td></tr></tbody></table>` : `<div>${inhalt}</div>`;
    teile.push(`<section style="break-before:page">${fallHtml}</section>`);
  }
}
const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Minimalprobe break-after avoid</title>
<style>@page{size:A4;margin:15mm} body{margin:0} h2{break-after:avoid;margin:0} p{break-inside:avoid;margin:0 0 8px}</style>
</head><body>${teile.join('\n')}</body></html>`;
process.stdout.write(html);
