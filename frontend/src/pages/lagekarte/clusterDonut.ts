import type { MarkerTyp } from './marker';

type ClusterTyp = Exclude<MarkerTyp, 'einsatzort'>;

/**
 * Segment-Farben pro Marker-Typ für den Cluster-Donut. Eigene, kräftige + unterscheidbare
 * Donut-Palette (unabhängig von den DV-102-Zeichen) — der Ring kommuniziert die Zusammensetzung
 * eines Clusters auf einen Blick.
 */
export const CLUSTER_TYP_FARBE: Record<ClusterTyp, string> = {
  fahrzeug: '#64748b', // slate
  einheit: '#16a34a', // grün
  fuehrung: '#7c3aed', // violett
  abschnitt: '#0d9488', // teal
  uhs: '#2563eb', // blau
  schaden: '#ea580c', // orange
  lagemeldung: '#d48806', // amber
  freies_zeichen: '#4f46e5', // indigo
};

// Stabile Segment-Reihenfolge im Donut (Kräfte → Infrastruktur → Meldungen).
const TYP_REIHENFOLGE: ClusterTyp[] = [
  'fahrzeug',
  'einheit',
  'fuehrung',
  'abschnitt',
  'uhs',
  'schaden',
  'lagemeldung',
  'freies_zeichen',
];

/**
 * `clusterProperties`-Spec für die GeoJSON-Source: pro Typ eine Summe (Anzahl im Cluster).
 * MapLibre aggregiert beim Clustern → die Counts liegen als `c_<typ>` an jedem Cluster-Feature.
 */
export function clusterTypProperties(): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const t of TYP_REIHENFOLGE) {
    props[`c_${t}`] = ['+', ['case', ['==', ['get', 'typ'], t], 1, 0]];
  }
  return props;
}

export interface DonutSegment {
  typ: ClusterTyp;
  farbe: string;
  count: number;
}

/** Liest die per-Typ-Counts (`c_<typ>`) aus den Cluster-Properties → Segmente (count > 0), stabile Reihenfolge. */
export function donutSegmente(props: Record<string, unknown>): DonutSegment[] {
  const segs: DonutSegment[] = [];
  for (const t of TYP_REIHENFOLGE) {
    const count = Number(props[`c_${t}`] ?? 0);
    if (count > 0) segs.push({ typ: t, farbe: CLUSTER_TYP_FARBE[t], count });
  }
  return segs;
}

function zahlLabel(gesamt: number): string {
  return gesamt >= 1000 ? `${Math.round(gesamt / 100) / 10}k` : String(gesamt);
}

/**
 * Baut das DOM-Element eines Cluster-Donuts: conic-gradient-Ring (Typ-Segmente) mit weichem
 * Schatten + weißem Kern und der Gesamtzahl. Per DOM-API (kein innerHTML); alle Werte stammen
 * aus kontrollierten Quellen (Enum-Farben, Zahlen).
 */
export function baueClusterDonut(props: Record<string, unknown>): HTMLDivElement {
  const gesamt = Number(props.point_count ?? 0);
  const segs = donutSegmente(props);
  const total = segs.reduce((s, x) => s + x.count, 0) || 1;
  let acc = 0;
  const stops: string[] = [];
  for (const s of segs) {
    const a = (acc / total) * 100;
    acc += s.count;
    const b = (acc / total) * 100;
    stops.push(`${s.farbe} ${a}% ${b}%`);
  }
  const size = Math.round(36 + Math.min(28, Math.log2(gesamt + 1) * 6));
  const innen = size - 12;

  const ring = document.createElement('div');
  ring.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    'border-radius:50%',
    'cursor:pointer',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'box-shadow:0 4px 14px rgba(15,23,42,.28),0 1px 3px rgba(15,23,42,.22)',
    `background:${stops.length ? `conic-gradient(${stops.join(',')})` : '#94a3b8'}`,
  ].join(';');

  const kern = document.createElement('div');
  kern.style.cssText = [
    `width:${innen}px`,
    `height:${innen}px`,
    'border-radius:50%',
    'background:#fff',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-family:-apple-system,Segoe UI,Roboto,sans-serif',
    'font-weight:700',
    `font-size:${Math.round(12 + Math.min(6, gesamt / 15))}px`,
    'color:#0f172a',
    'letter-spacing:-.3px',
  ].join(';');
  kern.textContent = zahlLabel(gesamt);

  ring.appendChild(kern);
  return ring;
}
