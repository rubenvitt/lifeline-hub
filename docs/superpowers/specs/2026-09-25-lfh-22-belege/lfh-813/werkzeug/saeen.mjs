// LFH-813: Testdaten für die Druckprüfung, angelehnt an das Seeding der e2e-Specs
// (druck-fluss, etb-druck, meldebild-tabelle). Ausgabe: JSON mit den IDs auf stdout.
import { deflateSync } from 'node:zlib';

const BASIS = process.argv[2];
let cookie = '';

async function anfrage(pfad, methode = 'GET', daten, roh) {
  for (let versuch = 0; ; versuch++) {
    const r = await fetch(BASIS + pfad, {
      method: methode,
      headers: { cookie, ...(roh ? {} : daten ? { 'content-type': 'application/json' } : {}) },
      body: roh ?? (daten ? JSON.stringify(daten) : undefined),
    });
    const sc = r.headers.getSetCookie?.() ?? [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    if (r.status === 503 && versuch < 4) {
      await new Promise((f) => setTimeout(f, 300 * (versuch + 1)));
      continue;
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }
}

function langerText(abschnitt, absaetze, ende = '') {
  const satz =
    'Die Lage im Einsatzabschnitt hat sich seit der letzten Meldung verändert, die Kräfte ' +
    'vor Ort melden eine Ausweitung des Schadensgebiets nach Nordosten, der Pegel steigt ' +
    'weiter und die Zufahrt über die Kreisstraße ist nur noch für geländegängige Fahrzeuge ' +
    'befahrbar. ';
  const l = Array.from({ length: absaetze }, (_, i) => `${abschnitt} Absatz ${i + 1}: ${satz}${satz}`);
  if (ende) l.push(ende);
  return l.join('\n\n');
}

// Erkennbares PNG-Logo: rotes Kreuz auf weißem Grund mit dunklem Rand, 160 × 64.
function logoPng(b = 160, h = 64) {
  const crc = (buf) => {
    let c, t = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    let x = 0xffffffff;
    for (const v of buf) x = t[(x ^ v) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (typ, daten) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(daten.length);
    const td = Buffer.concat([Buffer.from(typ), daten]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(b, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const zeilen = [];
  for (let y = 0; y < h; y++) {
    const z = Buffer.alloc(1 + b * 3);
    for (let x = 0; x < b; x++) {
      const rand = x < 3 || y < 3 || x >= b - 3 || y >= h - 3;
      const kreuz = (Math.abs(x - 32) < 7 && y > 10 && y < 54) || (Math.abs(y - 32) < 7 && x > 10 && x < 54);
      const balken = x > 70 && x < 150 && ((y > 14 && y < 26) || (y > 38 && y < 50));
      const [r, g, bl] = rand ? [30, 30, 30] : kreuz ? [220, 0, 0] : balken ? [40, 40, 120] : [255, 255, 255];
      z[1 + x * 3] = r; z[2 + x * 3] = g; z[3 + x * 3] = bl;
    }
    zeilen.push(z);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(zeilen))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LB = ['auftrag', 'gefahren_schadenlage', 'eigene_lage', 'lageentwicklung', 'fuehrungsprobleme', 'antraege_vorschlaege', 'medienlage', 'zusammenfassung'];

async function lagebericht(eid, freigeben, titel) {
  const { id } = await anfrage(`/api/einsaetze/${eid}/lageberichte`, 'POST', { vorlage: 'lagebericht', titel });
  await anfrage(`/api/einsaetze/${eid}/lageberichte/${id}`, 'PATCH', {
    abschnitte: LB.map((s, i) => ({ schluessel: s, text: langerText(s, 6, i === LB.length - 1 ? 'ENDE-LAGEBERICHT' : '') })),
  });
  if (freigeben) await anfrage(`/api/einsaetze/${eid}/lageberichte/${id}/freigeben`, 'POST');
  return id;
}

async function befehl(eid, freigeben, titel) {
  const { id } = await anfrage(`/api/einsaetze/${eid}/befehle`, 'POST', { vorlage: 'befehl_lad', titel });
  const ab = ['lage', 'auftrag', 'durchfuehrung'];
  await anfrage(`/api/einsaetze/${eid}/befehle/${id}`, 'PATCH', {
    abschnitte: ab.map((s, i) => ({ schluessel: s, text: langerText(s, 12, i === ab.length - 1 ? 'ENDE-BEFEHL' : '') })),
  });
  if (freigeben) await anfrage(`/api/einsaetze/${eid}/befehle/${id}/freigeben`, 'POST');
  return id;
}

await anfrage('/api/auth/login', 'POST', { benutzername: 'admin', passwort: 'e2e-admin-pw' });
await anfrage('/api/organisation', 'PATCH', { name: 'DRK KV Musterstadt' });
const fd = new FormData();
fd.append('datei', new Blob([logoPng()], { type: 'image/png' }), 'logo.png');
await anfrage('/api/organisation/logo', 'POST', undefined, fd);

const einsatz = await anfrage('/api/einsaetze', 'POST', { bezeichnung: 'Hochwasser Musterstadt (Druckprobe LFH-813)', stichwort: 'H3' });
const eid = einsatz.id;
const out = { eid };
out.lbFrei = await lagebericht(eid, true, 'Lagebericht 1 (freigegeben)');
out.lbEntwurf = await lagebericht(eid, false, 'Lagebericht 2 (Entwurf)');
out.befFrei = await befehl(eid, true, 'Befehl LAD (freigegeben)');
out.befEntwurf = await befehl(eid, false, 'Befehl LAD (Entwurf)');

for (let i = 0; i < 40; i++) {
  await anfrage(`/api/einsaetze/${eid}/personal`, 'POST', {
    adhoc: { name: `Kirchgassner-Wohlfahrt, Maximiliane ${i}`, funktion: 'Abschnittsleitung Technische Hilfeleistung', traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest' },
  });
}

const etb = (d) => anfrage(`/api/einsaetze/${eid}/etb`, 'POST', d);
const grund = await etb({ typ: 'meldung', inhalt: 'Grundmeldung Deich Nord', von: 'Florian 1', an: 'ELW' });
for (let i = 0; i < 510; i += 15) {
  await Promise.all(Array.from({ length: Math.min(15, 510 - i) }, (_, j) => etb({ typ: 'meldung', inhalt: `Saatmeldung ${i + j + 1}` })));
}
const nachtrag = await etb({ typ: 'meldung', inhalt: 'Nachgetragene Meldung', ereigniszeit: new Date(Date.now() - 7200e3).toISOString() });
const berichtigung = await etb({ typ: 'berichtigung', inhalt: 'Berichtigung: Deich Süd, nicht Nord', berichtigt_eintrag_id: grund.id });
out.etb = { grund: grund.lfd_nr, nachtrag: nachtrag.lfd_nr, berichtigung: berichtigung.lfd_nr };
console.log(JSON.stringify(out));
