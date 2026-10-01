import type { FeatureCollection } from '../../api/fachebenen';

type Feature = FeatureCollection['features'][number];

/**
 * RFC 3339 mit Pflicht-Offset — was der Server mit `parse_from_rfc3339` liest. `Date.parse` allein
 * nähme auch Werte ohne Offset (Ortszeit) oder ein bloßes Datum (UTC-Mitternacht) an, und dann
 * entschieden Server und Karte verschieden.
 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

/** Zeitpunkt einer DWD-Property in ms; fehlend, kein RFC 3339 oder unlesbar → `null`. */
function zeitpunkt(v: unknown): number | null {
  if (typeof v !== 'string' || !RFC3339.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Ende erreicht (`EXPIRES ≤ jetzt`). Ohne lesbares Ende gilt eine Warnung weiter. */
function abgelaufen(p: Record<string, unknown>, jetztMs: number): boolean {
  const ende = zeitpunkt(p.EXPIRES);
  return ende !== null && ende <= jetztMs;
}

/**
 * Beginn liegt in der Zukunft (`ONSET > jetzt`). Genau auf dem Beginn gilt die Warnung schon;
 * ohne lesbaren Beginn gilt sie als geltend. Auch der Inspector entscheidet hierüber.
 */
export function istAngekuendigt(p: Record<string, unknown>, jetztMs: number): boolean {
  const beginn = zeitpunkt(p.ONSET);
  return beginn !== null && beginn > jetztMs;
}

/**
 * Gültigkeit der DWD-Warnungen auf der Karte (LFH-662, design.md D3): abgelaufene entfernen,
 * angekündigte mit `angekuendigt: true` markieren. Dieselbe Ablaufregel wie der Server
 * (`quellen::dwd_gueltige`); hier läuft sie zusätzlich im Minutentakt, weil der Poll nur alle fünf
 * Minuten kommt und bei einem Ausfall des eigenen Servers ganz aussetzt. Die Markierung gehört in
 * den Client: der Übergang „angekündigt → geltend“ geschieht ohne Abruf.
 *
 * Rein; ohne Änderung kommt dieselbe Referenz zurück, damit die Karte nicht ohne Not `setData`
 * ruft.
 */
export function dwdGueltigkeit(fc: FeatureCollection, jetztMs: number): FeatureCollection {
  let geaendert = false;
  const features: Feature[] = [];
  for (const f of fc.features) {
    const p = f.properties ?? {};
    if (abgelaufen(p, jetztMs)) {
      geaendert = true;
      continue;
    }
    const soll = istAngekuendigt(p, jetztMs);
    if (soll !== (p.angekuendigt === true)) {
      geaendert = true;
      const properties = { ...p };
      if (soll) properties.angekuendigt = true;
      else delete properties.angekuendigt;
      features.push({ ...f, properties });
    } else {
      features.push(f);
    }
  }
  return geaendert ? { ...fc, features } : fc;
}
