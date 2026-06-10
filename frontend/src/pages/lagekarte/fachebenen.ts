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
