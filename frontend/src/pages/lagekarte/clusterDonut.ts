import type { Sichtungskategorie } from '../../api/types';
import { SK_KURZZEICHEN } from '../../personen/personenKarte';
import { sichtung } from '../../theme/statusFarben';
import { sichtungsfarben } from '../../theme/tokens';
import type { MarkerTyp } from './marker';

type ClusterTyp = Exclude<MarkerTyp, 'einsatzort'>;

/**
 * Segment-Farben je Marker-Typ für den Cluster-Donut — eine eigene, kräftige Palette unabhängig von
 * den DV-102-Zeichen. Personen fehlen absichtlich: ein Personen-Cluster zeigt seine Zusammensetzung
 * nach Sichtung in den Farben der Sichtungsachse und im Kern das Kürzel der dringlichsten Kategorie
 * (siehe {@link donutSegmente}, {@link dringlichsteSichtung}).
 */
export const CLUSTER_TYP_FARBE: Record<Exclude<ClusterTyp, 'person'>, string> = {
  fahrzeug: '#64748b', // slate
  einheit: '#16a34a', // grün
  fuehrung: '#7c3aed', // violett
  abschnitt: '#0d9488', // teal
  uhs: '#2563eb', // blau
  schaden: '#ea580c', // orange
  lagemeldung: '#d48806', // amber
  freies_zeichen: '#4f46e5', // indigo
  // Nicht rot/orange/amber (Gefahr/Schaden/Meldung) und abgesetzt vom UHS-Blau.
  betreuungsstelle: '#0891b2', // cyan
};

/**
 * Segmentfarbe ohne Fachfarbe („unverletzt", ungesichtet) und Ringfarbe ohne Segmente: derselbe
 * neutrale Schieferton — „unverletzt" hat keine BBK-Farbe.
 */
const DONUT_NEUTRAL = '#94a3b8';

/**
 * Sichtungskategorien nach Dringlichkeit: SK I, II, III, dann SK IV, Tote, Unverletzte, zuletzt
 * „ohne" (der Cluster sagt dann „–"). Dieselbe Reihenfolge legt die Segmente. Dass keine Kategorie
 * fehlt, sichert `clusterDonut.test.ts`, nicht der Typ.
 */
export const SK_DRINGLICHKEIT: readonly (Sichtungskategorie | 'ohne')[] = [
  'sk1',
  'sk2',
  'sk3',
  'sk4',
  'tot',
  'unverletzt',
  'ohne',
];

/**
 * Segment- bzw. Füllfarbe einer Sichtung — auch für die WebGL-Personen-Cluster, damit Donut und
 * Kreis dieselbe Farbe tragen.
 */
export function skFarbe(k: Sichtungskategorie | 'ohne'): string {
  const farbe = k === 'ohne' ? null : sichtung[k].farbe;
  return farbe ? sichtungsfarben[farbe] : DONUT_NEUTRAL;
}

// Stabile Segment-Reihenfolge im Donut (Kräfte → Infrastruktur → Meldungen).
const TYP_REIHENFOLGE: Exclude<ClusterTyp, 'person'>[] = [
  'fahrzeug',
  'einheit',
  'fuehrung',
  'abschnitt',
  'uhs',
  'betreuungsstelle',
  'schaden',
  'lagemeldung',
  'freies_zeichen',
];

/**
 * `clusterProperties`-Spec für die GeoJSON-Source: je Typ eine Summe, MapLibre legt sie als
 * `c_<typ>` an jedes Cluster-Feature.
 */
export function clusterTypProperties(): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const t of [...TYP_REIHENFOLGE, 'person'] as const) {
    props[`c_${t}`] = ['+', ['case', ['==', ['get', 'typ'], t], 1, 0]];
  }
  // Personen je Sichtung: `sk` trägt nur ein Personen-Marker.
  for (const k of SK_DRINGLICHKEIT) {
    props[`s_${k}`] = ['+', ['case', ['==', ['get', 'sk'], k], 1, 0]];
  }
  // Größte Trefferzone der Blätter: der Donut ist mindestens so groß anklickbar wie seine Marker.
  // Ohne `treffer` (Lagekarte) 0.
  props.treffer = ['max', ['coalesce', ['get', 'treffer'], 0]];
  return props;
}

export interface DonutSegment {
  typ: ClusterTyp;
  /** Nur an Personen-Segmenten: die Kategorie, deren Farbe das Segment trägt. */
  sichtung?: Sichtungskategorie | 'ohne';
  farbe: string;
  count: number;
}

/**
 * Per-Typ-Counts (`c_<typ>`) → Segmente (count > 0) in stabiler Reihenfolge. Personen gehen je
 * Sichtung (`s_<kategorie>`) ein, nicht als ein Segment.
 */
export function donutSegmente(props: Record<string, unknown>): DonutSegment[] {
  const segs: DonutSegment[] = [];
  for (const t of TYP_REIHENFOLGE) {
    const count = Number(props[`c_${t}`] ?? 0);
    if (count > 0) segs.push({ typ: t, farbe: CLUSTER_TYP_FARBE[t], count });
  }
  for (const k of SK_DRINGLICHKEIT) {
    const count = Number(props[`s_${k}`] ?? 0);
    if (count > 0) segs.push({ typ: 'person', sichtung: k, farbe: skFarbe(k), count });
  }
  return segs;
}

/** Die dringlichste Sichtung unter den Personen eines Clusters, ohne Personen `null`. */
export function dringlichsteSichtung(
  props: Record<string, unknown>,
): Sichtungskategorie | 'ohne' | null {
  return SK_DRINGLICHKEIT.find((k) => Number(props[`s_${k}`] ?? 0) > 0) ?? null;
}

/** Wortlaut für Tooltip und zugänglichen Namen eines Personen-Clusters. */
export function personenClusterText(gesamt: number, k: Sichtungskategorie | 'ohne'): string {
  const wer = gesamt === 1 ? '1 Person' : `${gesamt} Personen`;
  if (k === 'ohne') return `${wer}, noch nicht gesichtet`;
  return `${wer}, dringlichste Sichtung: ${sichtung[k].label}`;
}

function zahlLabel(gesamt: number): string {
  return gesamt >= 1000 ? `${Math.round(gesamt / 100) / 10}k` : String(gesamt);
}

/**
 * DOM-Element eines Cluster-Donuts: conic-gradient-Ring mit Schatten, weißer Kern mit Gesamtzahl.
 * Per DOM-API (kein innerHTML); alle Werte stammen aus kontrollierten Quellen.
 *
 * Personen-Cluster: der Kern trägt unter der Zahl das Kürzel der dringlichsten Sichtung — der
 * zweite Kanal, damit SK I nicht nur als rotes Segment erkennbar ist. `title` und `aria-label`
 * sagen es als Satz.
 *
 * Liegt `treffer` über dem gezeichneten Durchmesser, hüllt eine durchsichtige Fläche den Ring und
 * ist das Klickziel.
 */
export function baueClusterDonut(props: Record<string, unknown>): HTMLDivElement {
  const gesamt = Number(props.point_count ?? 0);
  const dringlichst = dringlichsteSichtung(props);
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
    `background:${stops.length ? `conic-gradient(${stops.join(',')})` : DONUT_NEUTRAL}`,
  ].join(';');

  const kern = document.createElement('div');
  kern.style.cssText = [
    `width:${innen}px`,
    `height:${innen}px`,
    'border-radius:50%',
    'background:#fff',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'line-height:1',
    'font-family:-apple-system,Segoe UI,Roboto,sans-serif',
    'font-weight:700',
    `font-size:${Math.round(12 + Math.min(6, gesamt / 15))}px`,
    'color:#0f172a',
    'letter-spacing:-.3px',
  ].join(';');
  const zahl = document.createElement('span');
  zahl.textContent = zahlLabel(gesamt);
  kern.appendChild(zahl);
  if (dringlichst) {
    const kurz = document.createElement('span');
    kurz.dataset.lfh = 'cluster-sichtung';
    kurz.style.cssText = 'font-size:10px;margin-top:1px';
    kurz.textContent = SK_KURZZEICHEN[dringlichst];
    kern.appendChild(kurz);
    const text = personenClusterText(gesamt, dringlichst);
    ring.title = text;
    // Ein `aria-label` braucht eine Rolle. `img`, nicht `button`: der Donut ist kein Tastaturziel.
    ring.setAttribute('role', 'img');
    ring.setAttribute('aria-label', text);
    ring.dataset.sichtung = dringlichst;
  }
  ring.appendChild(kern);

  const treffer = Number(props.treffer ?? 0);
  if (treffer <= size) return ring;
  // Die Hülle übernimmt Zeigerform, Name und Klick; der Ring darin ist nur noch Bild.
  const huelle = document.createElement('div');
  huelle.dataset.lfh = 'cluster-treffer';
  huelle.style.cssText = [
    `width:${treffer}px`,
    `height:${treffer}px`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
  ].join(';');
  if (ring.title) {
    huelle.title = ring.title;
    huelle.setAttribute('role', 'img');
    huelle.setAttribute('aria-label', ring.getAttribute('aria-label')!);
    ring.removeAttribute('title');
    ring.removeAttribute('role');
    ring.removeAttribute('aria-label');
  }
  huelle.appendChild(ring);
  return huelle;
}

/**
 * Macht die Trefferzonen-Hülle durchlässig, solange ihr Spider offen ist: in `handschuh` misst sie
 * 72 px, die aufgefächerten Blätter beginnen aber schon bei 27 px vom Mittelpunkt — sonst klappte
 * ein Tipp auf ein Blatt den Spider zu. Der Ring selbst bleibt klickbar.
 */
export function setzeHuelleDurchlaessig(el: HTMLElement | undefined, durchlaessig: boolean) {
  if (!el || el.dataset.lfh !== 'cluster-treffer') return;
  el.style.pointerEvents = durchlaessig ? 'none' : '';
  const ring = el.firstElementChild as HTMLElement | null;
  if (ring) ring.style.pointerEvents = durchlaessig ? 'auto' : '';
}
