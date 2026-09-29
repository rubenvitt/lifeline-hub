import type { FachebeneQuelle, FachebeneStatus, FeatureCollection } from '../../api/fachebenen';

type Feature = FeatureCollection['features'][number];

/**
 * Mindest-Zoom für Ebenen, die ihn über `minZoom` tragen — heute allein Energie: deren Backend
 * fragt Overpass live und lehnt Ausschnitte über {@link ENERGIE_MAX_SPANNE_GRAD} ab. Darunter steht
 * der Hinweis „näher heranzoomen" statt einer Anfrage.
 */
export const BBOX_MIN_ZOOM = 10;

/**
 * Größte Spanne eines Energie-Ausschnitts in Grad je Achse — wie `ENERGIE_MAX_SPANNE_GRAD` im
 * Backend (`src/karte/quellen.rs`). Der Zoom allein bremst nicht: bei Zoom 10 zeigt ein breiter
 * Schirm mehr als ein Grad. Das Frontend prüft selbst, statt eine Anfrage zu schicken, die mit 400
 * abgelehnt wird und die Ebene auf „offline" setzt.
 */
const ENERGIE_MAX_SPANNE_GRAD = 3;

/**
 * Passt ein Ausschnitt `west,sued,ost,nord` in die Energie-Grenze? Rein und exportiert. Ein
 * nicht lesbarer Ausschnitt gilt als passend — über ihn entscheidet das Backend.
 */
export function energieAusschnittPasst(bbox: string): boolean {
  const t = bbox.split(',').map(Number);
  if (t.length !== 4 || t.some((n) => Number.isNaN(n))) return true;
  const [w, s, e, n] = t;
  return e - w <= ENERGIE_MAX_SPANNE_GRAD && n - s <= ENERGIE_MAX_SPANNE_GRAD;
}

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
   * Dauerhaft sichtbarer Geltungsbereich der Quelle — als Text unter dem Label, nicht als Tooltip:
   * auf einem Touch-Gerät gibt es kein Hovern, und wer die Ebene für flächendeckend hält, plant auf
   * einer Grundlage, die es nicht gibt.
   */
  geltung?: string;
  /**
   * Takt, solange die Ebene noch keinen brauchbaren Stand hat — nur für Quellen, deren erster Lauf
   * serverseitig im Hintergrund läuft und die solange `offline` melden. Sonst wartete der Bediener
   * bis zum nächsten regulären Poll auf Daten, die nach ~30 s da sind.
   */
  aufwaermPollMs?: number;
  /**
   * Punkte der Ebene auf der Karte bündeln: die Source wird mit `cluster: true` angelegt, dazu
   * Bündel-Kreis und Bündel-Zahl (`fachebenenLayer.ts`). Heute nur KRITIS (bundesweit
   * hunderttausende Objekte, der Server verdichtet ab 5 000 zusätzlich zu Sammelpunkten).
   */
  buendeln?: boolean;
  /**
   * Mindest-Zoom, unter dem die Ebene nicht gefragt wird. Gilt nur für Ebenen, die ihn hier tragen
   * (heute Energie); KRITIS fragt in jeder Zoomstufe.
   */
  minZoom?: number;
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
    // Die Ebenenfarbe ist nur Rückfall für Panel-Punkt und Inspector-Akzent — auf der Karte trägt
    // jedes Feature seine Rollenfarbe je Meldeklasse (`hochwasserStil.ts`). Nicht das Blau von
    // `pegelonline`: beide stehen im Panel nebeneinander.
    farbe: '#08979c',
    geometrieTyp: 'punkt',
    pollMs: 300_000,
    bboxAbhaengig: false,
  },
  luftqualitaet: {
    key: 'luftqualitaet',
    label: 'Luftqualität (UBA)',
    // Nur der Panel-Punkt: auf der Karte trägt jede Station ihre Rollenfarbe
    // (`luftqualitaetStil.ts`). Deshalb ein entsättigter Ton, der keine Rollenfarbe ist — Grün
    // hieße dort schon „gute Luft".
    farbe: '#5b6b82',
    geometrieTyp: 'punkt',
    // = serverseitige TTL (900 s); die Quelle liefert Stundenwerte mit ~2 h Verzug.
    pollMs: 900_000,
    bboxAbhaengig: false,
    geltung: 'Messstationen — keine Aussage zwischen den Stationen',
  },
  odl: {
    key: 'odl',
    label: 'Strahlung / ODL (BfS)',
    // Nur Rückfall für Panel-Punkt und Inspector-Akzent — auf der Karte trägt jede Sonde ihre
    // Rollenfarbe (`odlStil.ts`).
    farbe: '#7cb305',
    geometrieTyp: 'punkt',
    // = serverseitige TTL (600 s); die Quelle liefert Stundenwerte.
    pollMs: 600_000,
    bboxAbhaengig: false,
    geltung: 'nur ortsfeste BfS-Sonden (Stundenwerte) — keine Einsatzmessungen',
  },
  autobahn: {
    key: 'autobahn',
    label: 'Autobahn-Lage (BAB)',
    // Eigener Ton neben den Bestandsebenen, nicht das `#08979c` von `hochwasser`.
    farbe: '#c41d7f',
    geometrieTyp: 'punkt',
    // = serverseitige TTL (600 s); die Ebene aggregiert 111 Autobahnen × 3 Dienste.
    pollMs: 600_000,
    bboxAbhaengig: false,
    // Der erste Lauf hängt an keinem Request (`fetch_autobahn`), die Ebene meldet solange
    // `offline`. 20 s fallen nicht auf und trommeln einen gestörten Anbieter nicht — die Antwort
    // ist dann eine winzige Leer-Antwort aus dem Backend.
    aufwaermPollMs: 20_000,
    geltung: 'nur Bundesautobahnen — keine Kreis-, Land- oder Ortsstraßen',
  },
  kritis: {
    key: 'kritis',
    label: 'KRITIS / sensible Objekte',
    farbe: '#531dab',
    geometrieTyp: 'punkt',
    // bbox-getrieben: neue Daten kommen mit jeder Kartenbewegung, nicht über einen Takt.
    pollMs: 0,
    bboxAbhaengig: true,
    // Der erste Import des OSM-Extrakts läuft minutenlang, die Ebene meldet solange `offline`; ohne
    // Aufwärm-Takt erschiene der Bestand erst beim nächsten Pannen.
    aufwaermPollMs: 30_000,
    buendeln: true,
    geltung: 'OpenStreetMap-Daten, wöchentlicher Stand — keine amtliche KRITIS-Liste',
  },
  energie: {
    key: 'energie',
    label: 'Energieanlagen',
    // `theme/tokens.ts` führt keine Fachebenen-Palette (Sichtungs- und Rollenfarben tragen
    // Bedeutung); die Bestandsfarben sind Stufe 7 der antd-Presetpalette. Gelb liegt nah am
    // DWD-Gold, ist aber unterscheidbar und die letzte freie Tonlücke. Bewusst nicht `green-7`:
    // Grün ist die Rolle `normal` und SK III, ein grüner Punkt läse sich als „in Ordnung".
    farbe: '#d4b106',
    geometrieTyp: 'punkt',
    // Wie KRITIS: kein Hintergrund-Polling, Refetch nur über den Ausschnitt (serverseitig 24 h
    // frisch).
    pollMs: 0,
    bboxAbhaengig: true,
    // Energie fragt Overpass live je Ausschnitt; das Backend lehnt alles über
    // ENERGIE_MAX_SPANNE_GRAD ab. Erst ab dieser Zoomstufe wird gefragt.
    minZoom: BBOX_MIN_ZOOM,
  },
};

/** Anzeige-Reihenfolge im Panel. */
export function fachebeneKeys(): FachebeneQuelle[] {
  return [
    'nina',
    'dwd',
    'pegelonline',
    'hochwasser',
    'odl',
    'luftqualitaet',
    'kritis',
    'energie',
    'autobahn',
  ];
}

/**
 * Poll-Takt einer Ebene nach ihrem zuletzt gesehenen Status — rein und exportiert. `undefined` und
 * `offline` gelten als „wärmt noch auf" (nur bei Ebenen mit `aufwaermPollMs`); `leer` nicht, das
 * ist ein gültiger Endzustand. Ein Ergebnis `0` schaltet in react-query den Timer ab.
 */
export function fachebeneTakt(key: FachebeneQuelle, status: FachebeneStatus | undefined): number {
  const def = FACHEBENEN[key];
  const waermtAuf = status === undefined || status === 'offline';
  return waermtAuf ? (def.aufwaermPollMs ?? def.pollMs) : def.pollMs;
}

export function istBboxAbhaengig(key: FachebeneQuelle): boolean {
  return FACHEBENEN[key].bboxAbhaengig;
}

/**
 * True, sobald irgendeine bbox-abhängige Ebene sichtbar ist — dann braucht die Seite den
 * Kartenausschnitt. Aus der Registry abgeleitet, damit eine neue bbox-Ebene die Meldung nicht
 * vergisst.
 */
export function braucheViewportBbox(sichtbar: Record<FachebeneQuelle, boolean>): boolean {
  return fachebeneKeys().some((k) => sichtbar[k] && istBboxAbhaengig(k));
}

/** Rasterleiter in Grad, fein → grob. Die kleinste Stufe ist das Stadtraster. */
const RASTER_LEITER = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10] as const;

/**
 * Rasterweite zu einer bbox-Breite (Grad West-Ost): die kleinste Leiterstufe, die mindestens ein
 * Achtel der Breite misst — auf Stadtebene 0,05°, auf Deutschland-Ebene 2°. Die Breite in Länge
 * hängt in Mercator nur am Zoom, Pannen wechselt die Stufe also nicht.
 */
export function rasterWeite(breite: number): number {
  const ziel = breite / 8;
  return RASTER_LEITER.find((w) => w >= ziel) ?? RASTER_LEITER[RASTER_LEITER.length - 1];
}

/**
 * Rastert eine bbox "west,sued,ost,nord" nach außen auf ein Gitter, dessen Weite mit der Breite
 * wächst (`rasterWeite`). Benachbarte Viewports liefern so denselben String → derselbe
 * Query-Schlüssel, KRITIS lädt beim Pannen innerhalb einer Zelle nicht neu. Nach außen gerundet,
 * damit der Ausschnitt stets abgedeckt ist.
 *
 * MapLibre meldet jenseits des Antimeridians Längen über ±180 (Weltkopien), die das Backend mit 400
 * ablehnt. Der Ausschnitt wird deshalb erst um Vielfache von 360° zurückgeschoben, dann gerastert
 * und gekappt. Ergibt das keine gültige bbox (breiter als die Welt, oder `west ≥ ost`), gilt die
 * ganze Welt — eine ausgelassene Anfrage ließe die Ebene dauerhaft leer.
 *
 * `grid` setzt eine feste Rasterweite: Energie nimmt das 0,05°-Stadtraster, weil die Leiter einen
 * Zoom-10-Ausschnitt zu einer unnötig größeren Overpass-Abfrage aufrundete.
 */
export function rasterBbox(bbox: string, grid?: number): string {
  const t = bbox.split(',').map(Number);
  if (t.length !== 4 || t.some((n) => Number.isNaN(n))) return bbox;
  const [w0, s, e0, n] = t;
  if (e0 - w0 >= 360) return WELT_BBOX;
  const versatz = Math.floor(((w0 + e0) / 2 + 180) / 360) * 360;
  const w = w0 - versatz;
  const e = e0 - versatz;
  grid ??= rasterWeite(e - w);
  const ab = (v: number) => Math.floor(v / grid) * grid; // nach unten
  const auf = (v: number) => Math.ceil(v / grid) * grid; // nach oben
  const r = (v: number) => Math.round(v * 1e6) / 1e6; // Fließkomma-Rauschen kappen
  const kappe = (v: number, grenze: number) => Math.min(grenze, Math.max(-grenze, v));
  const ergebnis = [
    r(kappe(ab(w), 180)),
    r(kappe(ab(s), 90)),
    r(kappe(auf(e), 180)),
    r(kappe(auf(n), 90)),
  ];
  const [rw, rs, re, rn] = ergebnis;
  if (!(rw < re) || !(rs < rn)) return WELT_BBOX;
  return ergebnis.join(',');
}

/** Rückfall von {@link rasterBbox}, wenn sich kein gültiger Ausschnitt bilden lässt. */
export const WELT_BBOX = '-180,-90,180,90';

/**
 * Mergt neue Features in `sammlung` (dedupliziert über die Koordinate, begrenzt auf `max`, älteste
 * zuerst entfernt): einmal geladene Objekte einer bbox-Ebene bleiben sichtbar. Mutiert `sammlung`;
 * true bei Änderung.
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

/** Koordinate als Schlüssel der Sammlung — dieselbe Form wie in {@link mergeFeatures}. */
const koordinatenSchluessel = (f: Feature) => JSON.stringify(f.geometry?.coordinates ?? null);

const herkunftVon = (f: Feature): string => {
  const h = f.properties?.herkunft;
  return typeof h === 'string' ? h : '';
};

/**
 * Merge der Energie-Ebene. Anders als {@link mergeFeatures} (first-wins, KRITIS) gewinnt die neuere
 * Fassung an derselben Koordinate: nach einem Teilausfall des MaStR-Teils kommt dieselbe Anlage
 * später als `osm+mastr` mit amtlichen Angaben zurück.
 *
 * Danach fallen reine `mastr`-Punkte weg, deren `mastr_nummer` ein `osm+mastr`-Punkt in seinen
 * `mastr_nummern` führt — sonst stünde die Anlage doppelt (an verschiedenen Koordinaten). Die
 * Bereinigung läuft über die ganze Sammlung, damit die Eintreffreihenfolge das Ergebnis nicht
 * ändert.
 *
 * Mutiert `sammlung`; true bei Änderung. Eine inhaltsgleiche Fassung ist keine Änderung, sonst
 * liefe jeder Refetch als neues Objekt durch die Karte.
 */
export function mergeEnergieFeatures(
  sammlung: Map<string, Feature>,
  neue: Feature[],
  max: number,
): boolean {
  let geaendert = false;
  for (const f of neue) {
    const key = koordinatenSchluessel(f);
    const alt = sammlung.get(key);
    if (alt !== undefined && JSON.stringify(alt) === JSON.stringify(f)) continue;
    // `Map.set` auf einen vorhandenen Schlüssel behält dessen Position — die Kappung unten bleibt
    // an der ersten Sichtung ausgerichtet.
    sammlung.set(key, f);
    geaendert = true;
  }

  const zugeordnet = new Set<string>();
  for (const f of sammlung.values()) {
    if (herkunftVon(f) !== 'osm+mastr') continue;
    const nummern = f.properties?.mastr_nummern;
    if (typeof nummern !== 'string') continue;
    for (const n of nummern.split(',')) {
      const t = n.trim();
      if (t) zugeordnet.add(t);
    }
  }
  if (zugeordnet.size > 0) {
    for (const [key, f] of sammlung) {
      const nummer = f.properties?.mastr_nummer;
      if (herkunftVon(f) === 'mastr' && typeof nummer === 'string' && zugeordnet.has(nummer)) {
        sammlung.delete(key);
        geaendert = true;
      }
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

/** Trenner der Nennungsteile in der `attribution` einer Antwort (design.md, Entscheidung 5). */
export const NENNUNG_TRENNER = ' · ';

/**
 * Quellennennung der Energie-Ebene aus der gezeichneten Sammlung, nicht aus der letzten Antwort:
 * die Sammlung akkumuliert über Ausschnitte, und die Lizenz verlangt die dl-de/by-2-0-Nennung für
 * jeden gezeigten MaStR-Punkt.
 *
 * Ein Teil mit „OpenStreetMap" bleibt, solange ein Punkt mit `osm` gesammelt ist, einer mit
 * „Marktstammdatenregister" entsprechend für `mastr`; ein anderer Teil bleibt, solange überhaupt
 * ein Punkt gezeigt wird. Ein Punkt ohne Herkunft trägt beide. Rein.
 */
export function energieNennung(teile: readonly string[], features: readonly Feature[]): string[] {
  if (features.length === 0) return [];
  let osm = false;
  let mastr = false;
  for (const f of features) {
    const h = herkunftVon(f);
    // Ohne Herkunft beide Nennungen: eine überzählige schadet nicht, eine fehlende verletzt die
    // Lizenz.
    if (!h || h.includes('osm')) osm = true;
    if (!h || h.includes('mastr')) mastr = true;
  }
  return teile.filter((t) => {
    if (t.includes('OpenStreetMap')) return osm;
    if (t.includes('Marktstammdatenregister')) return mastr;
    return true;
  });
}
