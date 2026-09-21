import type { FachebeneQuelle, FachebeneStatus, FeatureCollection } from '../../api/fachebenen';

type Feature = FeatureCollection['features'][number];

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
  /**
   * Dauerhaft sichtbarer Geltungsbereich der Quelle — bewusst als TEXT unter dem Label und
   * nicht als Tooltip (LFH-80): eine Reichweiten-Einschränkung, die man nur beim Hovern
   * sieht, ist auf einem Touch-Führungsgerät gar nicht zu sehen, und wer die Ebene für
   * flächendeckend hält, plant einen Anmarschweg auf einer Grundlage, die es nicht gibt.
   */
  geltung?: string;
  /**
   * Takt, solange die Ebene noch KEINEN brauchbaren Stand hat (LFH-80). Nur für Quellen,
   * deren erster Lauf serverseitig im Hintergrund läuft und die deshalb kurz `offline`
   * melden, obwohl sie gerade füllen. Ohne den kurzen Takt wartete der Bediener bis zum
   * nächsten regulären Poll — bei 600 s also zehn Minuten auf Daten, die nach ~30 s da sind.
   */
  aufwaermPollMs?: number;
}

export const FACHEBENEN: Record<FachebeneQuelle, FachebeneDef> = {
  nina: {
    key: 'nina',
    label: 'Amtliche Warnungen (NINA)',
    farbe: '#cf1322',
    geometrieTyp: 'polygon',
    pollMs: 90_000,
    bboxAbhaengig: false,
  },
  dwd: {
    key: 'dwd',
    label: 'Wetterwarnungen (DWD)',
    farbe: '#d48806',
    geometrieTyp: 'polygon',
    pollMs: 300_000,
    bboxAbhaengig: false,
  },
  pegelonline: {
    key: 'pegelonline',
    label: 'Pegel / Hochwasser',
    farbe: '#096dd9',
    geometrieTyp: 'punkt',
    pollMs: 300_000,
    bboxAbhaengig: false,
  },
  hochwasser: {
    key: 'hochwasser',
    label: 'Hochwasser-Meldeklassen (LHP)',
    // Die Ebenenfarbe ist nur der Rückfall für Panel-Punkt und Inspector-Akzent — auf der
    // Karte trägt jedes Feature seine eigene Rollenfarbe je Meldeklasse
    // (`hochwasserStil.ts`). Bewusst nicht das Blau von `pegelonline`: die beiden Ebenen
    // stehen nebeneinander und sind im Panel sonst nicht auseinanderzuhalten.
    farbe: '#08979c',
    geometrieTyp: 'punkt',
    pollMs: 300_000,
    bboxAbhaengig: false,
  },
  luftqualitaet: {
    key: 'luftqualitaet',
    label: 'Luftqualität (UBA)',
    // Nur der Panel-Punkt: auf der Karte trägt jede Station ihre Rollenfarbe je Indexstufe
    // (`luftqualitaetStil.ts`), und der Inspector-Akzent folgt ihr. Deshalb ein entsättigter
    // Ton, der KEINE Rollenfarbe ist — ein Grün hieße dort schon „gute Luft", Gelb „mäßig".
    farbe: '#5b6b82',
    geometrieTyp: 'punkt',
    // = serverseitige TTL (900 s). Die Quelle liefert Stundenwerte mit ~2 h Verzug.
    pollMs: 900_000,
    bboxAbhaengig: false,
    geltung: 'Messstationen — keine Aussage zwischen den Stationen',
  },
  autobahn: {
    key: 'autobahn',
    label: 'Autobahn-Lage (BAB)',
    // Eigener Ton neben Rot/Orange/Blau/Türkis/Violett der fünf Bestandsebenen. NICHT das
    // `#08979c` von `hochwasser` — die beiden stünden im Panel untereinander.
    farbe: '#c41d7f',
    geometrieTyp: 'punkt',
    // = serverseitige TTL (600 s). Die Ebene aggregiert 111 Autobahnen × 3 Dienste;
    // häufiger abzufragen belastet die Quelle, ohne frischer zu werden.
    pollMs: 600_000,
    bboxAbhaengig: false,
    // Der erste Lauf hängt an keinem Request (siehe `fetch_autobahn`), die Ebene meldet
    // währenddessen `offline`. 20 s ist kurz genug, dass die Aufwärmphase nicht auffällt,
    // und lang genug, dass ein dauerhaft gestörter Anbieter nicht getrommelt wird — der
    // Abruf ist dann eine winzige Leer-Antwort aus dem Backend, kein neuer Fächer.
    aufwaermPollMs: 20_000,
    geltung: 'nur Bundesautobahnen — keine Kreis-, Land- oder Ortsstraßen',
  },
  kritis: {
    key: 'kritis',
    label: 'KRITIS / sensible Objekte',
    farbe: '#531dab',
    geometrieTyp: 'punkt',
    pollMs: 0,
    bboxAbhaengig: true,
  },
};

/** Anzeige-Reihenfolge im Panel. */
export function fachebeneKeys(): FachebeneQuelle[] {
  return ['nina', 'dwd', 'pegelonline', 'hochwasser', 'luftqualitaet', 'kritis', 'autobahn'];
}

/**
 * Poll-Takt der Autobahn-Ebene nach ihrem zuletzt gesehenen Status. Rein und exportiert,
 * damit die Aufwärm-Regel ohne Render prüfbar ist.
 *
 * `undefined` (noch nichts geladen) und `offline` gelten als „wärmt noch auf". `leer` NICHT:
 * das heisst „Quelle erreichbar, gerade nichts zu melden" — ein gültiger Endzustand, den
 * kurz zu takten nichts brächte.
 */
export function autobahnTakt(status: FachebeneStatus | undefined): number {
  const def = FACHEBENEN.autobahn;
  const waermtAuf = status === undefined || status === 'offline';
  return waermtAuf ? (def.aufwaermPollMs ?? def.pollMs) : def.pollMs;
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

/**
 * Mergt neue Features in `sammlung` (dedupliziert über die Koordinate), begrenzt auf `max`
 * (älteste zuerst entfernt). So bleiben einmal geladene KRITIS-Objekte sichtbar, auch wenn
 * man wegzoomt oder das Gebiet wechselt. Mutiert `sammlung`; true bei Änderung.
 */
export function mergeFeatures(
  sammlung: Map<string, Feature>,
  neue: Feature[],
  max: number,
): boolean {
  let geaendert = false;
  for (const f of neue) {
    const key = JSON.stringify(f.geometry?.coordinates ?? null);
    if (!sammlung.has(key)) {
      sammlung.set(key, f);
      geaendert = true;
    }
  }
  if (geaendert) {
    while (sammlung.size > max) {
      const aeltester = sammlung.keys().next().value;
      if (aeltester === undefined) break;
      sammlung.delete(aeltester);
    }
  }
  return geaendert;
}
