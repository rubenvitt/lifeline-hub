import type { FachebeneQuelle, FachebeneStatus, FeatureCollection } from '../../api/fachebenen';

type Feature = FeatureCollection['features'][number];

/**
 * Mindest-Zoom-Level für ALLE bbox-abhängigen Ebenen (unter diesem Zoom keine bbox-Anfrage).
 * Bis LFH-81 hiess die Konstante `KRITIS_MIN_ZOOM` und galt nur für KRITIS; der Wert ist
 * beim Verallgemeinern unverändert geblieben. Das Backend begrenzt die bbox ohnehin auf 1°.
 */
export const BBOX_MIN_ZOOM = 10;

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
  /**
   * Punkte der Ebene auf der Karte bündeln (LFH-83). Die Source wird dann mit
   * `cluster: true` angelegt, und neben dem Einzelpunkt-Layer stehen Bündel-Kreis und
   * Bündel-Zahl (`fachebenenLayer.ts`). Heute nur KRITIS: bundesweit mehrere
   * hunderttausend Objekte, die der Server ab 5 000 zusätzlich zu Sammelpunkten verdichtet.
   */
  buendeln?: boolean;
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
  odl: {
    key: 'odl',
    label: 'Strahlung / ODL (BfS)',
    // Wie bei `hochwasser` nur Rückfall für Panel-Punkt und Inspector-Akzent — auf der Karte
    // trägt jede Sonde ihre Rollenfarbe je Stufe (`odlStil.ts`). Eigener Ton neben den
    // sechs belegten, damit die Ebene im Panel unterscheidbar bleibt.
    farbe: '#7cb305',
    geometrieTyp: 'punkt',
    // = serverseitige TTL (600 s). Die Quelle liefert Stundenwerte; häufiger abzufragen
    // wird nicht frischer, seltener ließe einen neuen Stundenwert zu lange liegen.
    pollMs: 600_000,
    bboxAbhaengig: false,
    geltung: 'nur ortsfeste BfS-Sonden (Stundenwerte) — keine Einsatzmessungen',
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
    // bbox-getrieben: neue Daten kommen mit jeder Kartenbewegung, nicht über einen Takt.
    pollMs: 0,
    bboxAbhaengig: true,
    // Der erste Import des OSM-Extrakts läuft nach dem Start minutenlang im Hintergrund,
    // die Ebene meldet solange `offline`. Ohne Aufwärm-Takt erschiene der erste Bestand
    // erst beim nächsten Pannen. 30 s: der Import dauert Minuten, feiner zu fragen brächte
    // nichts — die Antwort ist bis dahin eine winzige Leer-Antwort aus dem Backend.
    aufwaermPollMs: 30_000,
    buendeln: true,
    geltung: 'OpenStreetMap-Daten, wöchentlicher Stand — keine amtliche KRITIS-Liste',
  },
  energie: {
    key: 'energie',
    label: 'Energieanlagen',
    // antd `lime-7`. `theme/tokens.ts` führt keine Fachebenen-Palette — dort stehen nur die
    // Sichtungsfarben und die Farbrollen, und beide tragen Bedeutung (`normal` = grün,
    // `alarm` = rot, `bedien` = blau); eine Ebenenfarbe daraus behauptete einen Status. Die
    // Bestandsfarben sind wie diese hier Stufe 7 der antd-Presetpalette (rot, gold, blau,
    // cyan, magenta, violett, lime). Die zunächst gewählte lime-7 hat inzwischen ODL
    // (LFH-78) belegt — Gelb (`#d4b106`) liegt nah am DWD-Gold, ist aber unterscheidbar und
    // die letzte freie Stufe-7-Tonlücke. Bewusst NICHT `green-7`: Grün ist die Rolle
    // `normal` und die Sichtungsfarbe SK III, ein grüner Punkt läse sich als „in Ordnung".
    farbe: '#d4b106',
    geometrieTyp: 'punkt',
    // Wie KRITIS: kein Hintergrund-Polling, Refetch nur über den Ausschnitt. Der Stand ist
    // serverseitig 24 h frisch (design.md, Entscheidung 1).
    pollMs: 0,
    bboxAbhaengig: true,
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
 * Poll-Takt einer Ebene nach ihrem zuletzt gesehenen Status. Rein und exportiert, damit die
 * Aufwärm-Regel ohne Render prüfbar ist.
 *
 * `undefined` (noch nichts geladen) und `offline` gelten als „wärmt noch auf" — aber nur bei
 * Ebenen mit `aufwaermPollMs`. `leer` NICHT: das heisst „Quelle erreichbar, gerade nichts zu
 * melden" — ein gültiger Endzustand, den kurz zu takten nichts brächte. Ein Ergebnis `0`
 * (KRITIS mit Bestand) schaltet in react-query den Timer ab.
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
 * True, sobald IRGENDEINE bbox-abhängige Ebene sichtbar ist — dann braucht die Seite den
 * Karten-Ausschnitt (LFH-81). Aus der Registry abgeleitet statt als Aufzählung, damit eine
 * weitere bbox-Ebene die Meldung nicht wieder vergisst; bis LFH-81 hing sie an KRITIS allein.
 */
export function braucheViewportBbox(sichtbar: Record<FachebeneQuelle, boolean>): boolean {
  return fachebeneKeys().some((k) => sichtbar[k] && istBboxAbhaengig(k));
}

/**
 * Rasterleiter in Grad, fein → grob. Die kleinste Stufe ist das bisherige Stadtraster.
 */
const RASTER_LEITER = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10] as const;

/**
 * Rasterweite zu einer bbox-Breite (Grad West-Ost): die kleinste Leiterstufe, die mindestens
 * ein Achtel der Breite misst. Damit überdeckt eine Zelle stets einen spürbaren Bruchteil der
 * Ansicht — auf Stadtebene wie bisher 0,05°, auf Deutschland-Ebene 2°. Die Breite in Länge
 * hängt in Mercator nur an der Zoomstufe, nicht an der Lage; Pannen wechselt die Stufe also
 * nicht, Zoomen schon.
 */
export function rasterWeite(breite: number): number {
  const ziel = breite / 8;
  return RASTER_LEITER.find((w) => w >= ziel) ?? RASTER_LEITER[RASTER_LEITER.length - 1];
}

/**
 * Rastert eine bbox "west,sued,ost,nord" nach AUSSEN auf ein Gitter, dessen Weite mit der
 * bbox-Breite wächst (`rasterWeite`). Benachbarte Viewports liefern so denselben String →
 * identischer Query-Schlüssel, d. h. KRITIS lädt beim Pannen innerhalb einer Rasterzelle
 * nicht neu — auf Stadt- wie auf Deutschland-Ebene (LFH-83; vorher festes 0,05°-Raster, das
 * erst ab Zoom 10 gefragt wurde). Nach außen gerundet, damit der sichtbare Ausschnitt stets
 * abgedeckt ist.
 *
 * MapLibre meldet Längen jenseits ±180, sobald die Karte über den Antimeridian geschoben ist
 * (Weltkopien) — das Backend lehnt solche bboxes ab (400), die Ebene stünde dann `offline`.
 * Deshalb wird der Ausschnitt zuerst als Ganzes um Vielfache von 360° zurückgeschoben (eine
 * Weltkopie Deutschlands bei 365–376° wird zu 5–16°), erst dann gerastert und gekappt. Ergibt
 * das keine gültige bbox mehr (Ausschnitt breiter als die Welt, oder nach dem Kappen
 * `west ≥ ost`), gilt die ganze Welt — das Backend beantwortet sie verdichtet; eine
 * ausgelassene Anfrage ließe die Ebene dagegen dauerhaft leer (Review LFH-83).
 */
export function rasterBbox(bbox: string): string {
  const t = bbox.split(',').map(Number);
  if (t.length !== 4 || t.some((n) => Number.isNaN(n))) return bbox;
  const [w0, s, e0, n] = t;
  if (e0 - w0 >= 360) return WELT_BBOX;
  const versatz = Math.floor(((w0 + e0) / 2 + 180) / 360) * 360;
  const w = w0 - versatz;
  const e = e0 - versatz;
  const grid = rasterWeite(e - w);
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
 * Mergt neue Features in `sammlung` (dedupliziert über die Koordinate), begrenzt auf `max`
 * (älteste zuerst entfernt). So bleiben einmal geladene Objekte einer bbox-Ebene sichtbar, auch wenn
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

/** Koordinate als Schlüssel der Sammlung — dieselbe Form wie in {@link mergeFeatures}. */
const koordinatenSchluessel = (f: Feature) => JSON.stringify(f.geometry?.coordinates ?? null);

const herkunftVon = (f: Feature): string => {
  const h = f.properties?.herkunft;
  return typeof h === 'string' ? h : '';
};

/**
 * Merge der Energie-Ebene (LFH-81). Anders als {@link mergeFeatures} (first-wins, für
 * KRITIS unverändert) GEWINNT hier die neuere Fassung an derselben Koordinate: nach einem
 * Teilausfall des MaStR-Teils kommt dieselbe OSM-Anlage später als `osm+mastr` mit
 * amtlicher Leistung und Nummer zurück — first-wins behielte die ärmere Fassung für immer.
 *
 * Danach fallen reine `mastr`-Punkte weg, deren `mastr_nummer` ein `osm+mastr`-Punkt der
 * Sammlung in seinen `mastr_nummern` führt: im Ausfall stand die Einheit als eigener Punkt
 * da, jetzt ist sie einer OSM-Anlage zugeordnet und stünde sonst doppelt auf der Karte (an
 * verschiedenen Koordinaten, deshalb greift die Koordinaten-Deduplizierung dort nicht).
 * Die Bereinigung läuft über die GANZE Sammlung, nicht nur über den neuen Stand — die
 * Reihenfolge des Eintreffens darf das Ergebnis nicht ändern.
 *
 * Mutiert `sammlung`; true bei Änderung. Eine inhaltsgleiche Fassung gilt NICHT als
 * Änderung, sonst liefe jeder Refetch als neues Objekt durch die Karte.
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
    // `Map.set` auf einen vorhandenen Schlüssel behält dessen Position — die
    // Älteste-zuerst-Kappung unten bleibt damit an der ersten Sichtung ausgerichtet.
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
 * Quellennennung der Energie-Ebene aus der GEZEICHNETEN Sammlung (LFH-81), nicht aus der
 * letzten Antwort: die Sammlung akkumuliert über Ausschnitte, und nach dem Pannen in reines
 * OSM-Gebiet stünden sonst MaStR-Punkte ohne die dl-de/by-2-0-Nennung auf der Karte — die
 * Lizenz verlangt sie aber für jeden gezeigten Datensatz.
 *
 * `teile` sind die in bisherigen Antworten gesehenen Nennungsteile. Ein Teil mit
 * „OpenStreetMap" bleibt, solange ein Punkt mit `osm` in der Herkunft gesammelt ist, einer
 * mit „Marktstammdatenregister" entsprechend für `mastr`. Ein Teil, der keiner der beiden
 * Quellen zuzuordnen ist, bleibt, solange überhaupt ein Punkt gezeigt wird. Ein Punkt ohne
 * Herkunft trägt beide Nennungen. Rein.
 */
export function energieNennung(teile: readonly string[], features: readonly Feature[]): string[] {
  if (features.length === 0) return [];
  let osm = false;
  let mastr = false;
  for (const f of features) {
    const h = herkunftVon(f);
    // Ohne Herkunft ist nicht entscheidbar, woher der Punkt stammt — dann beide Nennungen:
    // eine überzählige Nennung schadet nicht, eine fehlende verletzt die Lizenz.
    if (!h || h.includes('osm')) osm = true;
    if (!h || h.includes('mastr')) mastr = true;
  }
  return teile.filter((t) => {
    if (t.includes('OpenStreetMap')) return osm;
    if (t.includes('Marktstammdatenregister')) return mastr;
    return true;
  });
}
