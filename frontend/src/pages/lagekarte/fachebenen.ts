import type { FachebeneQuelle } from '../../api/fachebenen';

/** Mindest-Zoom-Level für KRITIS-Abfragen (unter diesem Zoom keine bbox-Anfrage). */
export const KRITIS_MIN_ZOOM = 10;

export interface FachebeneDef {
  key: FachebeneQuelle;
  label: string;
  farbe: string;
  geometrieTyp: 'polygon' | 'punkt';
  /** Poll-Intervall in ms (Frontend refetchInterval). */
  pollMs: number;
  /** True → braucht Karten-Viewport-bbox (kein Hintergrund-Polling, Refetch bei moveend). */
  bboxAbhaengig: boolean;
}

export const FACHEBENEN: Record<FachebeneQuelle, FachebeneDef> = {
  nina: { key: 'nina', label: 'Amtliche Warnungen (NINA)', farbe: '#cf1322', geometrieTyp: 'polygon', pollMs: 90_000, bboxAbhaengig: false },
  dwd: { key: 'dwd', label: 'Wetterwarnungen (DWD)', farbe: '#d48806', geometrieTyp: 'polygon', pollMs: 300_000, bboxAbhaengig: false },
  pegelonline: { key: 'pegelonline', label: 'Pegel / Hochwasser', farbe: '#096dd9', geometrieTyp: 'punkt', pollMs: 300_000, bboxAbhaengig: false },
  kritis: { key: 'kritis', label: 'KRITIS / sensible Objekte', farbe: '#531dab', geometrieTyp: 'punkt', pollMs: 0, bboxAbhaengig: true },
};

/** Anzeige-Reihenfolge im Panel. */
export function fachebeneKeys(): FachebeneQuelle[] {
  return ['nina', 'dwd', 'pegelonline', 'kritis'];
}

export function istBboxAbhaengig(key: FachebeneQuelle): boolean {
  return FACHEBENEN[key].bboxAbhaengig;
}

/**
 * Rastert eine bbox "west,sued,ost,nord" nach AUSSEN auf ein Gitter (Default 0.05° ≈ 5 km).
 * Benachbarte Viewports liefern so denselben String → identischer Query-/Cache-Schlüssel
 * (Frontend react-query UND Backend-Cache), d. h. KRITIS lädt beim Pannen innerhalb einer
 * Rasterzelle nicht neu. Nach außen gerundet, damit der sichtbare Ausschnitt stets abgedeckt ist.
 */
export function rasterBbox(bbox: string, grid = 0.05): string {
  const t = bbox.split(',').map(Number);
  if (t.length !== 4 || t.some((n) => Number.isNaN(n))) return bbox;
  const [w, s, e, n] = t;
  const ab = (v: number) => Math.floor(v / grid) * grid; // nach unten
  const auf = (v: number) => Math.ceil(v / grid) * grid; // nach oben
  const r = (v: number) => Math.round(v * 1e6) / 1e6; // Fließkomma-Rauschen kappen
  return [r(ab(w)), r(ab(s)), r(auf(e)), r(auf(n))].join(',');
}
