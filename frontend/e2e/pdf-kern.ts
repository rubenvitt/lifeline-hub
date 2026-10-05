import { deflateSync } from 'node:zlib';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * PDF-Auszug für die Druck-Specs (LFH-729): Text und gezeichnete Bilder JE SEITE eines PDF aus
 * `page.pdf()`. Den Rohtext kann man nicht lesen — Chromium bettet subsettete Schriften ein und
 * komprimiert die Inhaltsströme —, deshalb liest pdf.js (Legacy-Build, läuft in Node ohne
 * Canvas). Nur Chromium erzeugt ein PDF; Firefox und WebKit kommen hier nie an.
 *
 * Selbsttest: `e2e/druck-fluss.spec.ts`, „PDF-Auszug-Selbsttest".
 */

export interface PdfBild {
  breite: number;
  hoehe: number;
}

export interface PdfSeite {
  /** Text der Seite, Einträge in Lesefolge zusammengefügt, Leerraum auf ein Zeichen gekürzt. */
  text: string;
  /** Jedes gezeichnete Rasterbild mit seinen Pixelmaßen im PDF. */
  bilder: PdfBild[];
  /** Seitenmaß in Punkt (1/72 Zoll) aus der MediaBox, z. B. A3 quer 1190,55 × 841,89 (LFH-893). */
  breite: number;
  hoehe: number;
}

export async function pdfAuszug(pdf: Buffer): Promise<PdfSeite[]> {
  const laden = getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: true,
    // Warnungen zu fehlenden Standardschriften betreffen nur das Rendern, nicht den Text.
    verbosity: 0,
  });
  try {
    const dokument = await laden.promise;
    const seiten: PdfSeite[] = [];
    for (let nr = 1; nr <= dokument.numPages; nr++) {
      const seite = await dokument.getPage(nr);
      const inhalt = await seite.getTextContent();
      const text = inhalt.items
        .map((eintrag) => ('str' in eintrag ? eintrag.str + (eintrag.hasEOL ? ' ' : '') : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      const operatoren = await seite.getOperatorList();
      const bilder: PdfBild[] = [];
      operatoren.fnArray.forEach((fn, i) => {
        const args = operatoren.argsArray[i];
        // `paintImageXObject`: [objId, Breite, Höhe] aus dem Bildwörterbuch. Kleine Inline-Bilder
        // kommen als `paintInlineImageXObject` mit dem decodierten Bild.
        if (fn === OPS.paintImageXObject) bilder.push({ breite: args[1], hoehe: args[2] });
        if (fn === OPS.paintInlineImageXObject) {
          bilder.push({ breite: args[0].width, hoehe: args[0].height });
        }
      });
      const [x0, y0, x1, y1] = seite.view;
      seiten.push({ text, bilder, breite: x1 - x0, hoehe: y1 - y0 });
    }
    return seiten;
  } finally {
    await laden.destroy();
  }
}

/** CRC-32 nach PNG-Spezifikation (Polynom 0xEDB88320). */
function crc32(daten: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of daten) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngBlock(typ: string, daten: Buffer): Buffer {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const typUndDaten = Buffer.concat([Buffer.from(typ, 'latin1'), daten]);
  const pruefsumme = Buffer.alloc(4);
  pruefsumme.writeUInt32BE(crc32(typUndDaten));
  return Buffer.concat([laenge, typUndDaten, pruefsumme]);
}

/**
 * Ein RGB-PNG ohne Alphakanal mit genau diesen Pixelmaßen (Farbverlauf, damit kein Werkzeug es
 * zu einer Fläche zusammenfasst). Ungewöhnliche Maße machen ein Bild im PDF wiedererkennbar.
 */
export function pngMitMassen(breite: number, hoehe: number): Buffer {
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(breite, 0);
  kopf.writeUInt32BE(hoehe, 4);
  kopf[8] = 8; // Bittiefe
  kopf[9] = 2; // Farbtyp RGB
  const zeilen = Buffer.alloc((breite * 3 + 1) * hoehe);
  for (let y = 0; y < hoehe; y++) {
    const start = y * (breite * 3 + 1); // Filterbyte 0 am Zeilenanfang
    for (let x = 0; x < breite; x++) {
      zeilen[start + 1 + x * 3] = Math.round((x / breite) * 255);
      zeilen[start + 2 + x * 3] = Math.round((y / hoehe) * 255);
      zeilen[start + 3 + x * 3] = 128;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngBlock('IHDR', kopf),
    pngBlock('IDAT', deflateSync(zeilen)),
    pngBlock('IEND', Buffer.alloc(0)),
  ]);
}
