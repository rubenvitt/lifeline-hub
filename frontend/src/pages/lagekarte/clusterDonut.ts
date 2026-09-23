import type { Sichtungskategorie } from '../../api/types';
import { SK_KURZZEICHEN } from '../../personen/personenKarte';
import { sichtung } from '../../theme/statusFarben';
import { sichtungsfarben } from '../../theme/tokens';
import type { MarkerTyp } from './marker';

type ClusterTyp = Exclude<MarkerTyp, 'einsatzort'>;

/**
 * Segment-Farben pro Marker-Typ für den Cluster-Donut. Eigene, kräftige + unterscheidbare
 * Donut-Palette (unabhängig von den DV-102-Zeichen) — der Ring kommuniziert die Zusammensetzung
 * eines Clusters auf einen Blick.
 *
 * **Personen fehlen hier absichtlich (LFH-650).** LFH-613 hatte ihnen ein eigenes Segment
 * `#be185d` (Rosé) gegeben — ein Literal außerhalb der Tokens, auf derselben Karte neben
 * SK-I-Rot und nicht auf Verwechslung geprüft. Ein Personen-Cluster zeigt stattdessen seine
 * Zusammensetzung nach SICHTUNG in den festen Farben der Sichtungsachse und im Kern das
 * Kürzel der dringlichsten Kategorie (siehe {@link donutSegmente}, {@link dringlichsteSichtung}).
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
};

/**
 * Segmentfarbe ohne Fachfarbe („unverletzt", noch nicht gesichtet) und Ringfarbe ohne
 * Segmente. Derselbe Schieferton, den der Donut ohnehin für einen leeren Ring nahm — kein
 * neuer Wert, und bewusst neutral: „unverletzt" hat keine BBK-Farbe (CLAUDE.md, Sichtung).
 */
const DONUT_NEUTRAL = '#94a3b8';

/**
 * Sichtungskategorien in der Reihenfolge der DRINGLICHKEIT: SK I vor II vor III, dann SK IV
 * (ohne Überlebenschance — betreuend, nicht zuerst), Tote, Unverletzte, und zuletzt „ohne":
 * noch nicht gesichtet ist keine Kategorie, der Cluster sagt dann „–". Dieselbe Reihenfolge
 * legt die Segmente im Ring. Ein Array, kein Record — dass keine Kategorie aus `SK_KURZZEICHEN`
 * fehlt, sichert `clusterDonut.test.ts` („führt jede Kategorie … genau einmal"), nicht der Typ.
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

function skFarbe(k: Sichtungskategorie | 'ohne'): string {
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
  for (const t of [...TYP_REIHENFOLGE, 'person'] as const) {
    props[`c_${t}`] = ['+', ['case', ['==', ['get', 'typ'], t], 1, 0]];
  }
  // Personen je Sichtung (LFH-650): `sk` trägt nur ein Personen-Marker.
  for (const k of SK_DRINGLICHKEIT) {
    props[`s_${k}`] = ['+', ['case', ['==', ['get', 'sk'], k], 1, 0]];
  }
  // Größte Trefferzone der Blätter (LFH-650): der Donut macht sich mindestens so groß
  // anklickbar wie seine Marker. Ohne `treffer` (Lagekarte) 0 — dort ändert sich nichts.
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
 * Liest die per-Typ-Counts (`c_<typ>`) aus den Cluster-Properties → Segmente (count > 0),
 * stabile Reihenfolge. Personen gehen NICHT als ein Segment ein, sondern je Sichtung
 * (`s_<kategorie>`) in den Farben der Sichtungsachse (LFH-650).
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
 * Baut das DOM-Element eines Cluster-Donuts: conic-gradient-Ring (Typ-Segmente) mit weichem
 * Schatten + weißem Kern und der Gesamtzahl. Per DOM-API (kein innerHTML); alle Werte stammen
 * aus kontrollierten Quellen (Enum-Farben, Zahlen).
 *
 * **Personen-Cluster (LFH-650):** der Kern trägt unter der Zahl das Kürzel der dringlichsten
 * Sichtung („I") — derselbe zweite Kanal wie im Einzelmarker, damit SK I nicht nur als
 * rotes Ringsegment erkennbar ist (WCAG 1.4.1). `title` und `aria-label` sagen es als Satz.
 *
 * **Trefferzone:** liegt `treffer` über dem gezeichneten Durchmesser, hüllt eine durchsichtige
 * Fläche den Ring; das Klickziel ist dann die Hülle. Der Ring bleibt so groß wie bisher.
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
    // Ein `aria-label` braucht eine Rolle, sonst wird es auf einem nackten `div` übergangen.
    // `img`, nicht `button`: der Donut ist kein Tastaturziel (die Auffächerung ist Zeiger-
    // Bedienung der Karte), eine Knopfrolle ohne Fokus versprach etwas, das nicht geht.
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
 * Macht die Trefferzonen-Hülle eines Donuts für Klicks durchlässig, solange sein Spider offen
 * ist (Review LFH-650). In `handschuh` misst die Hülle 72 px (Radius 36), die aufgefächerten
 * Blätter liegen aber schon ab 40 px vom Mittelpunkt — ihr gezeichneter Kreis beginnt bei
 * 27 px. Ohne das fing die Hülle den Tipp auf den inneren Teil eines Blatts ab und klappte den
 * Spider zu, statt die Person zu öffnen. Der Ring selbst bleibt klickbar (erneuter Klick
 * klappt weiter ein), nur die Fläche um ihn herum gibt nach. Ohne Hülle: nichts zu tun.
 */
export function setzeHuelleDurchlaessig(el: HTMLElement | undefined, durchlaessig: boolean) {
  if (!el || el.dataset.lfh !== 'cluster-treffer') return;
  el.style.pointerEvents = durchlaessig ? 'none' : '';
  const ring = el.firstElementChild as HTMLElement | null;
  if (ring) ring.style.pointerEvents = durchlaessig ? 'auto' : '';
}
