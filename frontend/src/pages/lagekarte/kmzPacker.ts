/**
 * KMZ des Lagekarten-Exports (Zunder A, Entwurf
 * `docs/superpowers/specs/2026-11-24-k9tkgrou-lagekarte-geo-export-design.md`): ein ZIP mit
 * `doc.kml` als erstem Eintrag und je verschiedenem Zeichenschlüssel einem PNG unter `files/`,
 * dazu der Kreis für Punkte ohne Zeichen (`PUNKT_ICON`), falls es welche gibt.
 * `doc.kml` ist gepackt, die PNGs liegen unverändert (`level: 0`, schon komprimiert).
 *
 * Der Renderer ist ein Parameter: Tests geben einen Stub, die Seite `renderZeichenPng`.
 */
import { zipSync, strToU8, type Zippable } from 'fflate';
import type { Drawing } from '@einsatzzeichen/schema';
import type { ExportObjekt } from './geoExport';
import { PUNKT_ICON, brauchtPunktIcon, iconDateiname, writeKml } from './kmlWriter';
import { renderZeichenPng } from './zeichenPng';

export const KMZ_MEDIENTYP = 'application/vnd.google-earth.kmz';

/** Weißer Kreis 32 × 32 px mit Kantenglättung (244 Byte) für {@link PUNKT_ICON}. */
const PUNKT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAu0lEQVR42t2XwQ3DIAxFGYkRGIER2IiRGIERGMEj/HKwVKlyW0qJ7fZJ/xIl6EESsAOAYJnwawJpps60GcId4muV7zkuUGYG1hn8zNcCcaZjn85jbAnkh2XehXisjwQyzpNXBeKhmUsrEVcEOq6jvxMouJ7ySmAoCIxnAgl6JEmgKgpUSaApCjRJgBQFSBLQxp+A+Ssw/wjNf0Pzjch8K3ZxGJkfxy4KEvOSzEVR6qIsd9GYuGnN/rc7vgGTMVprRDFPIwAAAABJRU5ErkJggg==';

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
  if (brauchtPunktIcon(objekte)) {
    dateien[PUNKT_ICON] = [
      Uint8Array.from(atob(PUNKT_PNG_BASE64), (c) => c.charCodeAt(0)),
      { level: 0 },
    ];
  }
  for (const [schluessel, drawing] of zeichen) {
    const blob = await render(drawing);
    dateien[iconDateiname(schluessel)] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }

  const zip = zipSync(dateien);
  return new Blob([zip as Uint8Array<ArrayBuffer>], { type: KMZ_MEDIENTYP });
}
