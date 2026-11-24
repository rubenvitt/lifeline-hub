/**
 * KMZ des Lagekarten-Exports (Zunder A, Entwurf
 * `docs/superpowers/specs/2026-11-24-k9tkgrou-lagekarte-geo-export-design.md`): ein ZIP mit
 * `doc.kml` als erstem Eintrag und je verschiedenem Zeichenschlüssel einem PNG unter `files/`.
 * `doc.kml` ist gepackt, die PNGs liegen unverändert (`level: 0`, schon komprimiert).
 *
 * Der Renderer ist ein Parameter: Tests geben einen Stub, die Seite `renderZeichenPng`.
 */
import { zipSync, strToU8, type Zippable } from 'fflate';
import type { Drawing } from '@einsatzzeichen/schema';
import type { ExportObjekt } from './geoExport';
import { iconDateiname, writeKml } from './kmlWriter';
import { renderZeichenPng } from './zeichenPng';

export const KMZ_MEDIENTYP = 'application/vnd.google-earth.kmz';

export async function packKmz(
  objekte: ExportObjekt[],
  meta: { stand: Date; einsatzName: string },
  render: (drawing: Drawing) => Promise<Blob> = renderZeichenPng,
): Promise<Blob> {
  const zeichen = new Map<string, Drawing>();
  for (const o of objekte) {
    if (o.zeichen && !zeichen.has(o.zeichen.schluessel)) {
      zeichen.set(o.zeichen.schluessel, o.zeichen.drawing);
    }
  }

  // Ein Zeichen nach dem anderen: Canvas und Schrift sind nicht für Parallelität gemacht.
  const dateien: Zippable = {
    'doc.kml': [strToU8(writeKml(objekte, meta, iconDateiname)), { level: 6 }],
  };
  for (const [schluessel, drawing] of zeichen) {
    const blob = await render(drawing);
    dateien[iconDateiname(schluessel)] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }

  const zip = zipSync(dateien);
  return new Blob([zip as Uint8Array<ArrayBuffer>], { type: KMZ_MEDIENTYP });
}
