import { IconLupe } from '../../icons';
import { Button, Input, Space, Typography } from 'antd';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer, SeitenStandVeraltet } from '../../components/SeitenZustand';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { monoStil, Segmentleiste, useRollen } from '../../components/instrument';
import { griffHinweis, type GriffModus, type KantenAus } from './bildGriffe';
import { KlappPaneel, LeistenAbschnitt, usePaneelZustand } from './KlappPaneel';
import type {
  PersonenEbenenAngabe,
  BetreuungEbenenAngabe,
  BrEbenenAngabe,
  TierEbenenAngabe,
} from './leistenDaten';
import type { PlatzierModus } from './PlatzierSteuerung';
import ModusBand from './ModusBand';
import Ebenenbaum from './Ebenenbaum';
import { FehlerSlot, type SektionFehler } from './leistenTeile';
import type { LeistenAnsicht } from './leistenWahl';
import './lagekarte.css';
import type { KarteMarker, NichtVerortet } from './marker';
import type { BasemapModus, KartenThemeWahl } from './basemapStil';
import type { FreiesZeichenUpdate, ZoneTyp } from '../../api/types';
import type { ZeichenModus } from './zeichnen';
import { FREIE_SKIZZE_VORGABEFARBE, ZONE_TYPEN } from './zonenStil';
import FreiesZeichenPicker, { hatZeichen, type ZeichenEntwurf } from './FreiesZeichenPicker';
import { START_ZEICHEN_SPEC } from './zeichenWahl';
import type { GefundenerOrt } from '../../anzeige/ortssuche';
import MarkerSuche from './MarkerSuche';
import type { LatLon } from '../../anzeige/koordinaten';
import type { Hintergrundbild } from '../../api/kartenbilder';
import type { UploadFortschritt } from '../../api/client';
import type { KartenAnsicht } from '../../api/types';
import type { KartenGrund } from './useKartenFehler';

export { ebenenZeileStil, leistenZeileStil, namensteilStil } from './leistenTeile';
export { loeschDialogBild } from './BildHintergruende';

export interface LayerSichtbar {
  einsatzort: boolean;
  /** Eigene Führungsstelle (LFH-1181), nur lesend; an wie der Einsatzort. */
  fuehrungsstelle: boolean;
  uhs: boolean;
  schaden: boolean;
  einheit: boolean;
  fahrzeug: boolean;
  fuehrung: boolean;
  abschnitt: boolean;
  zone: boolean;
  lagemeldung: boolean;
  freies_zeichen: boolean;
  /**
   * Ebene „Betroffene". Der Schalter ist die Wahl, nicht die Zugriffsgrenze — gezeichnet wird nur
   * bei freigegebenem Modul „Personen" (`personenZugriff`).
   */
  person: boolean;
  /**
   * Ebene „Betreuungsstellen". Wie `person`: die Zugriffsgrenze ist die Datenquelle
   * (`betreuungEbene.ts`).
   */
  betreuungsstelle: boolean;
  /** Ebene „Bereitstellungsräume" (LLH-1107), Grenze an der Datenquelle (`brEbene.ts`). */
  bereitstellungsraum: boolean;
  /** Ebene „Tiere" (LLH-1123), Grenze an der Datenquelle (`tierEbene.ts`). */
  tier: boolean;
}

/**
 * Platzierbare Punkt-Typen (Fläche/Abschnitt über `onAbschnittZeichnenStart`). `person` kommt nur
 * über den Deeplink-Auftrag der Detailseite — Personen stehen nicht in „Nicht verortet", die
 * Koordinaten-Lücke zeigt die Betroffenen-Seite.
 */
export type PlatzierenPunktTyp =
  | 'uhs'
  | 'schaden'
  | 'einheit'
  | 'fahrzeug'
  | 'fuehrung'
  | 'person'
  | 'betreuungsstelle'
  | 'bereitstellungsraum'
  | 'tier';

const NICHT_VERORTET_LABEL: Record<NichtVerortet['typ'], string> = {
  uhs: 'UHS',
  schaden: 'Schaden',
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  fuehrung: 'Personal', // beliebiges disponiertes Personal, nicht nur Führung
  abschnitt: 'Abschnitt',
  betreuungsstelle: 'Betreuungsstelle',
  bereitstellungsraum: 'Bereitstellungsraum',
  tier: 'Tier',
};

/**
 * Was gerade platziert wird, als Text für das Fuß-Band (LFH-765) — dieselbe Schreibweise wie die
 * Zeile in „Nicht verortet". Steht das Ziel dort nicht (Verschieben eines verorteten Objekts per
 * `?platzieren=`, Betroffene), bleibt der Typname.
 */
export function platzierObjekt(
  ziel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number },
  nichtVerortet: NichtVerortet[],
): string {
  if (ziel.typ === 'einsatzort') return 'Einsatzort';
  if (ziel.typ === 'person') return 'Betroffene Person';
  const typName = NICHT_VERORTET_LABEL[ziel.typ];
  const eintrag = nichtVerortet.find((o) => o.typ === ziel.typ && o.id === ziel.id);
  return eintrag ? `${typName}: ${eintrag.label}` : typName;
}

/**
 * Ab wie vielen Einträgen „Nicht verortet" ein Suchfeld trägt: ab fünf beginnt die Liste in der
 * 300-px-Leiste zu scrollen, darunter ist Hinsehen schneller als Tippen.
 */
export const NICHT_VERORTET_SUCHE_AB = 5;

/**
 * Filter der Liste „Nicht verortet": Teilstring ohne Groß-/Kleinschreibung gegen die Zeile, wie sie
 * dasteht (Typ-Präfix plus Label) — „einheit" findet alle Einheiten, der Schlüssel `fuehrung`
 * nichts.
 *
 * Das laufende Platzierungsziel bleibt immer stehen: seine Zeile zeigt, was gerade platziert wird
 * („wird platziert“; bedient wird der Modus im Modus-Band bzw. im Fuß, LLH-1028). Filterte ein
 * Begriff sie weg, verschwände der Zustand aus der Liste, an der der Modus begann.
 */
export function filtereNichtVerortet(
  liste: NichtVerortet[],
  suche: string,
  ziel: { typ: string; id: number } | null,
): NichtVerortet[] {
  const begriff = suche.trim().toLowerCase();
  if (!begriff) return liste;
  return liste.filter(
    (o) =>
      (ziel?.typ === o.typ && ziel.id === o.id) ||
      `${NICHT_VERORTET_LABEL[o.typ]}: ${o.label}`.toLowerCase().includes(begriff),
  );
}

/**
 * Platzierungsziel → exclude-Tag (typ:id) für die Ort-Vorschau. Der Einsatzort-Marker trägt die
 * echte einsatzId, nicht die 0 aus dem Platzierungsziel.
 */
export function ortVorschauExclude(
  ziel: SidebarProps['platzierungZiel'],
  einsatzId: number,
): string | undefined {
  if (!ziel) return undefined;
  if (ziel.typ === 'einsatzort') return `einsatzort:${einsatzId}`; // Marker-id = echte Einsatz-ID, nicht 0
  // Sidebar-Typen → Backend-Marker-Tags; 'fuehrung' → 'personal'. Keine Betreuungsstelle, kein
  // Bereitstellungsraum und kein Tier (LLH-1123): die Peilung prüft nur den Einsatz-Lesezugriff und darf keine
  // modulgebundenen Orte kennen (wie `person`).
  const map: Record<string, string> = {
    uhs: 'uhs',
    schaden: 'schaden',
    einheit: 'einheit',
    fahrzeug: 'fahrzeug',
    fuehrung: 'personal',
  };
  const typ = map[ziel.typ];
  return typ ? `${typ}:${ziel.id}` : undefined;
}

/**
 * Fehler-Slots je Sidebar-Sektion: gesetzt, sagt die Sektion, warum sie nichts zeigt — eine leere
 * Objektliste läse sich als „nichts da", und das ist im Einsatz eine Lagebeurteilung.
 *
 * Bewusst kein Slot an „Verortet": sie trifft keine Vollständigkeitsaussage, ihre Zahlen zählen
 * nur, und ein zweiter Fehlerkasten füllte die schmale Leiste ohne neue Tatsache. Die namentliche
 * Meldung steht am Seitenkopf.
 */
export interface SidebarSektionFehler {
  /** Die Lagebild-Quellen hinter „Nicht verortet" (und damit hinter „Alles verortet"). */
  nichtVerortet?: SektionFehler;
  /** Eigene Query: `useKartenbilder`. */
  bilder?: SektionFehler;
  /** Eigene Query: `useKartenAnsicht`. Ohne diesen Slot rendert der Switcher bei Fehler nichts. */
  ansichten?: SektionFehler;
}

/** Stand des Bild-Uploads aus `useKartenbilder` (LFH-1021). */
export interface BildUploadZustand {
  laeuft: boolean;
  /** Nur während der Übertragung gesetzt. */
  stand: UploadFortschritt | null;
  /** `mutation.error`, bis zum nächsten Upload. */
  fehler: unknown;
}

export interface SidebarProps {
  einsatzId: number;
  nichtVerortet: NichtVerortet[];
  verortet: KarteMarker[];
  /**
   * Quelle der Objektsuche unter „Verortet" — `suchbareMarker` aus `objektsuche.ts`, also ohne
   * Namen aus Modulen ohne Recht. Getrennt von `verortet`, das die Ebenen-Zeilen zählt und keine
   * Betroffenen trägt.
   */
  suchbar: KarteMarker[];
  /** Eine Quelle der Suche ist ausgefallen — dann „—" statt Zahlen, keine behauptete Leere. */
  suchbarUnvollstaendig?: boolean;
  /**
   * Ortssuche im selben Feld (LFH-638): Koordinate und Adresse anspringen. Eine `vorbelegung`
   * (`?ort=`) öffnet das Paneel „Verortet“, damit die Treffer zu sehen sind.
   */
  ortssuche?: {
    onOrtWaehlen: (ort: GefundenerOrt) => void;
    vorbelegung?: { text: string; nonce: number } | null;
    onVorbelegungVerbraucht?: (nonce: number) => void;
  };
  darfSchreiben: boolean;
  platzierungZiel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number } | null;
  onPlatzierenStart: (ziel: { typ: PlatzierenPunktTyp; id: number }) => void;
  onPlatzierenAbbrechen: () => void;
  onAbschnittZeichnenStart: (id: number) => void;
  onZoneZeichnenStart: (entwurf: { typ: ZoneTyp; modus: ZeichenModus; farbe?: string }) => void;
  /** Freies taktisches Zeichen: aktive Platzierung + Start/Abbrechen. */
  zeichenPlatzieren: FreiesZeichenUpdate | null;
  onZeichenPlatzierenStart: (spec: FreiesZeichenUpdate) => void;
  onZeichenPlatzierenAbbrechen: () => void;
  /**
   * Serienmodus des Platzierens: an heißt, ein erfolgreicher POST beendet den Platzier-Modus nicht;
   * beendet wird über „Fertig".
   */
  zeichenSerie: boolean;
  onZeichenSerieWechsel: (an: boolean) => void;
  /** Bereits gesetzte Zeichen der laufenden Serie; 0 = noch keins (dann heißt Beenden „Abbrechen"). */
  zeichenSerieAnzahl: number;
  onZeichenPlatzierenFertig: () => void;
  /**
   * Wo die Bedienung der Leistenmodi steht (Abbrechen/Fertig, Serien-Schalter, Griffwahl):
   * `band` = im Modus-Band der Leiste (ab `lg`), `fuss` = im Fuß-Band `PlatzierSteuerung` über der
   * Karte (unter `lg`, LFH-765). Das Modus-Band zeigt dann nur Titel und Zusatzangaben
   * (Koordinate, Mittelpunkt); die Zeilen zeigen auf jeder Breite nur den Zustand.
   */
  modusBedienung?: 'fuss' | 'band';
  /**
   * Der laufende Leistenmodus samt Rückmeldung „… verortet“ (LLH-1125) — derselbe Wert, den die
   * Seite dem Fuß-Band gibt. Fehlt er, steht kein Modus-Band.
   */
  platzierModus?: PlatzierModus | null;
  /** Gezeigte Ansicht der Leiste — die Seite hält sie (`useLeistenAnsicht`). */
  ansicht: LeistenAnsicht;
  onAnsichtWechsel: (ansicht: LeistenAnsicht) => void;
  onKoordinateEingeben: (lat: number, lon: number) => void;
  einsatzortVerortet: boolean;
  onEinsatzortPlatzieren: () => void;
  layer: LayerSichtbar;
  onLayerToggle: (key: keyof LayerSichtbar, an: boolean) => void;
  /**
   * Die Ebene, die nur ein Verortungsauftrag zeichnet (LLH-1125): ihre Zeile trägt „eingeblendet“,
   * der Schalter zeigt weiter `layer`.
   */
  eingeblendet?: keyof LayerSichtbar | null;
  /** Zahl der Zonen der aktiven Ansicht — UNGEGATTERT (siehe `ebenenZeilen`). */
  zonenAnzahl: number;
  /**
   * Ebene „Betroffene": Zugriff und Zahl der Personen-Marker (die laufen getrennt von `verortet`).
   * Fehlt die Angabe, gibt es keine Zeile.
   */
  personen?: PersonenEbenenAngabe;
  /** Ebene „Betreuungsstellen": nur die Zugriffsgrenze — die Marker zählen in `verortet` mit. */
  betreuung?: BetreuungEbenenAngabe;
  /** Ebene „Bereitstellungsräume" (LLH-1107): ebenso nur die Zugriffsgrenze. */
  br?: BrEbenenAngabe;
  /** Ebene „Tiere" (LLH-1123): ebenso nur die Zugriffsgrenze. */
  tier?: TierEbenenAngabe;
  /**
   * Gewählte Kartengrundlage. Gewählt wird sie in der Segmentleiste über der Karte; das Paneel
   * trägt nur, was dort keinen Platz hat.
   */
  basemap: BasemapModus;
  /** Die Grundlagen-Wahl selbst — nur auf dem Handschirm, wo sie nicht über der Karte steht. */
  grundlageWahl?: ReactNode;
  onMarkerWaehlen: (schluessel: string) => void;
  onlineVerfuegbar: boolean;
  offlineVerfuegbar: boolean;
  /** Karten-lokale Theme-Wahl (Offline-Basemap): 'auto' folgt dem App-Theme. */
  kartenTheme: KartenThemeWahl;
  onKartenThemeWechsel: (wahl: KartenThemeWahl) => void;
  /**
   * „In dieser Ansicht speichern": true, wenn der Karten-Zustand von der gespeicherten Ansicht
   * abweicht (Basemap/Ebenen/Fachebenen).
   */
  ansichtDirty: boolean;
  ansichtSpeichert: boolean;
  onAnsichtSpeichern: () => void;
  fachebenenSichtbar: import('./fachebenenAuswahl').FachebenenSichtbar;
  onFachebeneToggle: (key: import('../../api/fachebenen').FachebeneQuelle, an: boolean) => void;
  /** Status je Fachebene für Ausgrau-/Offline-Hinweis. */
  fachebenenStatus: Partial<
    Record<
      import('../../api/fachebenen').FachebeneQuelle,
      import('../../api/fachebenen').FachebeneStatus
    >
  >;
  /** Je bbox-abhängiger Ebene: aktiv, aber zu weit herausgezoomt für eine Abfrage. */
  zoomZuKlein?: Partial<Record<import('../../api/fachebenen').FachebeneQuelle, boolean>>;
  /** Lade-Zustand je Fachebene (z. B. KRITIS/Overpass lädt länger → Spinner). */
  fachebenenLaedt?: Partial<Record<import('../../api/fachebenen').FachebeneQuelle, boolean>>;
  /**
   * Abrufzeitpunkt des Servers je sichtbarer Fachebene (LFH-591) — auch neben „offline“, solange
   * die Karte gehaltene Daten zeichnet (`useFachebenen`).
   */
  fachebenenAbgerufen?: Partial<Record<import('../../api/fachebenen').FachebeneQuelle, string>>;
  /** Bild-Hintergründe */
  bilder: Hintergrundbild[];
  onBildUpload: (datei: File) => void;
  /** Laufender oder gescheiterter Bild-Upload (LFH-1021); fehlt im Historien-Modus. */
  bildUpload?: BildUploadZustand;
  onBildToggle: (id: number, sichtbar: boolean) => void;
  onBildOpazitaet: (id: number, opazitaet: number) => void;
  onBildPlatzieren: (id: number) => void;
  onBildPlatzierenFertig: () => void;
  onBildLoeschen: (id: number) => void;
  /** Bild auf eine andere Ansicht verschieben bzw. auf alle (`null`). */
  onBildVerschieben: (id: number, ansichtId: number | null) => void;
  onBildZentrieren: (id: number) => void;
  onBildUmbenennen: (id: number, name: string) => void;
  /** Mittelpunkt des gerade platzierten Bilds numerisch setzen. */
  onBildMittelpunkt: (lat: number, lon: number) => void;
  bildPlatzierenId: number | null;
  /** Scharfe Griffsorte beim Bild-Einpassen. */
  griffModus: GriffModus;
  /** Wie viele Kantengriffe die Karte mangels Platz ausblendet (LFH-764) — der Hinweis sagt es. */
  griffKantenAus: KantenAus;
  onGriffModus: (modus: GriffModus) => void;
  /** Aktueller Mittelpunkt des Platzier-Bilds (für die numerische Eingabe). */
  bildPlatzierZentrum: LatLon | null;
  ansichten: KartenAnsicht[];
  aktiveAnsichtId?: number;
  onAnsichtWaehlen: (id: number) => void;
  /** Neu, Umbenennen, Löschen: der Dialog wartet auf die Antwort (siehe `AnsichtSwitcher`). */
  onAnsichtNeu: (name: string) => Promise<unknown> | void;
  onAnsichtUmbenennen: (id: number, name: string) => Promise<unknown> | void;
  onAnsichtStandard: (id: number) => void;
  onAnsichtLoeschen: (id: number, objekte: 'freigeben' | 'loeschen') => Promise<unknown> | void;
  ansichtBusy: boolean;
  /**
   * Abgelehntes „Als Standard“ und „In dieser Ansicht speichern“ der aktiven Ansicht (LFH-1077):
   * der Grund steht im Paneel „Kartenansicht“, das dafür aufgeht. Ein Ansichtswechsel räumt ihn.
   */
  ansichtFehler?: readonly KartenGrund[];
  /** Fehler-Slots je Sektion — siehe `SidebarSektionFehler`. */
  sektionFehler?: SidebarSektionFehler;
  /**
   * Inhalt des Paneels „Ausgewählt" — die Inspectors der gewählten Objekte (Marker, Zone,
   * freies Zeichen, Fachebene). Leer → Hinweis, wie man etwas wählt.
   */
  auswahl?: ReactNode;
  /**
   * Zähler, der bei jeder Erhöhung das Paneel „Zeichnen" öffnet und in den Blick holt
   * (Zeichnen-Knopf über der Karte). Ein Zähler statt eines Booleans, damit ein zweiter Klick nach
   * dem Zuklappen wieder greift.
   */
  zeichnenAnfrage?: number;
}

/**
 * Derselbe Fehler über erhalten gebliebenen Zeilen statt an ihrer Stelle. Ohne `onWiederholen`
 * fällt der Slot auf die gewöhnliche Fehlermeldung zurück, nicht auf „kein Banner": dass der Stand
 * alt ist, bleibt die Aussage.
 */
function VeraltetSlot({ fehler }: { fehler?: SektionFehler }) {
  if (!fehler) return null;
  if (!fehler.onWiederholen) return <FehlerSlot fehler={fehler} />;
  return <SeitenStandVeraltet onWiederholen={fehler.onWiederholen} />;
}

/**
 * Trefflächenboden für ein handgebautes Bedienziel. Die Einträge unter „Verortet" sind klickbar,
 * aber `ListenEintrag` legt `onClick` auf ein nacktes `<div>`, dessen Höhe nur aus der Polsterung
 * der `<Liste>` käme (Handschuh grob 54 statt 72 px). Deshalb zwei Angaben: `minHeight` aus
 * `controlHeight` plus Polsterung.
 *
 * Aufgelöste Tokens, nie `var(--lfh-*)` (Arbeitsteilung in `theme/rollen.css`). Rein und
 * exportiert, damit die Zusicherung ohne Render prüfbar ist.
 *
 * Nicht gelöst: Tastaturbedienbarkeit des `<div onClick>` (LFH-335).
 */
export function bedienzielStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
}) {
  return {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
  } as const;
}

/**
 * Ansicht „Objekte“ der Kartenleiste: Nicht verortet, Einsatzort, Verortet (Objekt- und
 * Ortssuche) und mit Schreibrecht Zeichnen — die Paneele wie vor der Gliederung in Ansichten
 * (LLH-1028); ihren Umbau zur einen Objektliste trägt das Folgeticket. Laufende Modi zeigen hier
 * nur den Zustand, bedient werden sie im Modus-Band bzw. im Fuß.
 */
function ObjekteAnsicht(props: SidebarProps & { id: string; hidden: boolean }) {
  const { nichtVerortet, darfSchreiben, platzierungZiel } = props;
  const sektionFehler = props.sektionFehler ?? {};
  /** Eine Zählung, die im Fehlerfall keine Null behauptet. */
  const zaehler = (n: number) => (sektionFehler.nichtVerortet ? '—' : n);
  const { token, rollen } = useRollen();
  const paneele = usePaneelZustand();
  const umschalten = (k: Parameters<typeof paneele.setze>[0]) => () =>
    paneele.setze(k, !paneele.zustand[k]);
  // Ein Paneel mit Fehler-Slot steht offen, egal wie es zuletzt stand: ein zugeklappter Fehler wäre
  // von „nichts da" nicht zu unterscheiden.
  // Freies-Zeichen-Schnellerfassung: der Picker erscheint erst auf Klick, der Entwurf bleibt über
  // Platzierungen erhalten.
  const [zeichenPickerOffen, setZeichenPickerOffen] = useState(false);
  const [zeichenEntwurf, setZeichenEntwurf] = useState<ZeichenEntwurf>({
    zeichen_spec: START_ZEICHEN_SPEC,
  });
  /**
   * Knopf „Platzieren" und Enter im Picker: der Entwurf übernimmt die Spec, damit der wieder
   * geöffnete Picker dort weitermacht.
   */
  const platziereZeichen = (spec: FreiesZeichenUpdate) => {
    setZeichenEntwurf(spec);
    props.onZeichenPlatzierenStart(spec);
    setZeichenPickerOffen(false);
  };
  // Suche über „Nicht verortet". Wirksam nur, solange das Feld steht: fällt die Liste unter die
  // Schwelle, verschwindet mit dem Feld sein `allowClear` — ein weiterwirkender Filter verschluckte
  // Einträge ohne Ausweg. Zurückgesetzt während des Renderns: React verwirft diesen Durchlauf vor
  // dem Commit, es gibt keinen sichtbaren Zwischenstand.
  const [nvSuche, setNvSuche] = useState('');
  const nvSucheZeigen = nichtVerortet.length >= NICHT_VERORTET_SUCHE_AB;
  if (!nvSucheZeigen && nvSuche !== '') setNvSuche('');
  const nvBegriff = nvSuche.trim();
  const nvTreffer = filtereNichtVerortet(nichtVerortet, nvBegriff, platzierungZiel);
  // Gezählt werden nur echte Treffer: die angeheftete Zeile des laufenden Ziels steht auch ohne
  // Treffer da.
  const nvTrefferzahl = nvBegriff
    ? filtereNichtVerortet(nichtVerortet, nvBegriff, null).length
    : nichtVerortet.length;

  // Zeichnen-Knopf über der Karte: Paneel öffnen und in den Blick holen. Der Effekt hängt allein am
  // Zähler, damit ein Zuklappen ihn nicht erneut auslöst.
  const zeichnenRef = useRef<HTMLDivElement>(null);
  const { setze: paneelSetzen } = paneele;
  // Ortssuche von außen (`?ort=`): das Paneel mit dem Suchfeld öffnen, je Vorbelegung einmal.
  const vorbelegungNonce = props.ortssuche?.vorbelegung?.nonce;
  useEffect(() => {
    if (vorbelegungNonce == null) return;
    paneelSetzen('verortet', true);
  }, [vorbelegungNonce, paneelSetzen]);

  useEffect(() => {
    if (!props.zeichnenAnfrage) return;
    paneelSetzen('zeichnen', true);
    // jsdom kennt `scrollIntoView` nicht — optionaler Aufruf statt Absturz im Test.
    requestAnimationFrame(() => zeichnenRef.current?.scrollIntoView?.({ block: 'nearest' }));
  }, [props.zeichnenAnfrage, paneelSetzen]);

  // Die kleine Größe steht in dieser Datei nur noch an `Liste` (Abstandsmaß); interaktive Elemente
  // erben ihre Höhe vom `ConfigProvider`. Die anklickbaren Einträge tragen `bedienzielStil`.
  //
  // Die Prop-Schreibweise steht bewusst nicht ausgeschrieben: Gate 4 zählt ihr Literal repo-weit.
  return (
    <div role="tabpanel" id={props.id} aria-label="Objekte" hidden={props.hidden}>
      <KlappPaneel
        titel="Nicht verortet"
        kennung="nichtVerortet"
        meta={zaehler(nichtVerortet.length)}
        offen={paneele.zustand.nichtVerortet || sektionFehler.nichtVerortet != null}
        onUmschalten={umschalten('nichtVerortet')}
      >
        {/* Ein Fehler ersetzt Inhalt nur, wenn es keinen gibt (`anzahl === 0`): stehen noch
            Zeilen im Zwischenspeicher, wird der Fehler zum Banner darüber, und die Liste — die
            einzige Bedienung zum Verorten — bleibt bedienbar. „Alles verortet" darf nicht
            stehen, solange unklar ist, ob etwas geladen wurde. */}
        {sektionFehler.nichtVerortet && nichtVerortet.length === 0 ? (
          <FehlerSlot fehler={sektionFehler.nichtVerortet} />
        ) : nichtVerortet.length === 0 ? (
          <SeitenLeer titel="Alles verortet" />
        ) : (
          <>
            <VeraltetSlot fehler={sektionFehler.nichtVerortet} />
            {nvSucheZeigen && (
              <div style={{ marginBlockEnd: token.marginXS }}>
                {/* Schlichtes Eingabefeld statt Suchvariante: gefiltert wird live, deren
                    Suchknopf wäre ein Tab-Ziel ohne Wirkung. Das Icon in `aria-hidden`-Hülle
                    (sonst ein englisches „search"). */}
                <Input
                  aria-label="Nicht verortete Objekte durchsuchen"
                  placeholder="Name oder Typ"
                  allowClear
                  prefix={
                    <span aria-hidden="true" style={{ color: rollen.schwach }}>
                      <IconLupe />
                    </span>
                  }
                  value={nvSuche}
                  onChange={(ev) => setNvSuche(ev.target.value)}
                />
                {/* Die Trefferzahl ist die zweite Angabe: der Kopf zählt weiter alle nicht
                    verorteten Objekte. Die Region steht mit dem Feld, auch wenn sie schweigt
                    (eine Live-Region meldet nur Änderungen), und trägt auch „0 von N" — sonst
                    hörte ein Vorleser nie, dass alles weggefiltert ist. */}
                <div
                  role="status"
                  style={{
                    ...monoStil(11),
                    color: rollen.gedaempft,
                    ...(nvBegriff ? { marginBlockStart: token.marginXXS } : {}),
                  }}
                >
                  {nvBegriff ? `${nvTrefferzahl} von ${nichtVerortet.length}` : ''}
                </div>
              </div>
            )}
            {/* Dritter Zustand: die Suche hat alles weggefiltert. Eigener Wortlaut, weil „Alles
                verortet" eine falsche Lagebeurteilung wäre; der Ausweg ist das Leeren am Feld.
                Steht das laufende Ziel als einzige Zeile da, entfällt die Leermeldung. */}
            {nvTreffer.length === 0 ? (
              <SeitenLeer titel={`Keine Treffer für „${nvBegriff}"`} />
            ) : (
              <Liste
                size="small"
                dataSource={nvTreffer}
                rowKey={(o) => `${o.typ}-${o.id}`}
                renderItem={(o) => {
                  const aktiv = platzierungZiel?.typ === o.typ && platzierungZiel?.id === o.id;
                  let action: React.ReactNode = null;
                  // Zeilenaktionen sind sekundär (umrandet) — „genau eine Primäraktion" gilt auch
                  // in der Leiste. Gefüllt ist nur, was einen laufenden Modus abschließt.
                  if (darfSchreiben) {
                    if (o.typ === 'abschnitt') {
                      action = (
                        <Button onClick={() => props.onAbschnittZeichnenStart(o.id)}>
                          Fläche zeichnen
                        </Button>
                      );
                    } else if (aktiv) {
                      action = <Typography.Text type="secondary">wird platziert</Typography.Text>;
                    } else {
                      // o.typ ist hier auf die Punkt-Typen verengt (abschnitt oben behandelt).
                      const punktTyp = o.typ;
                      action = (
                        <Button
                          onClick={() => props.onPlatzierenStart({ typ: punktTyp, id: o.id })}
                        >
                          Platzieren
                        </Button>
                      );
                    }
                  }
                  return (
                    <ListenEintrag actions={action ? [action] : []}>
                      <Typography.Text>
                        {NICHT_VERORTET_LABEL[o.typ]}: {o.label}
                      </Typography.Text>
                    </ListenEintrag>
                  );
                }}
              />
            )}
          </>
        )}
      </KlappPaneel>

      <KlappPaneel
        titel="Einsatzort"
        kennung="einsatzort"
        offen={paneele.zustand.einsatzort}
        onUmschalten={umschalten('einsatzort')}
      >
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text type={props.einsatzortVerortet ? undefined : 'warning'}>
            {props.einsatzortVerortet ? 'verortet' : 'nicht verortet'}
          </Typography.Text>
          {darfSchreiben &&
            (platzierungZiel?.typ === 'einsatzort' ? (
              <Typography.Text type="secondary">wird platziert</Typography.Text>
            ) : (
              <Button
                type={props.einsatzortVerortet ? 'default' : 'primary'}
                onClick={props.onEinsatzortPlatzieren}
              >
                {props.einsatzortVerortet ? 'Verschieben' : 'Platzieren'}
              </Button>
            ))}
        </Space>
      </KlappPaneel>

      <KlappPaneel
        titel="Verortet"
        kennung="verortet"
        offen={paneele.zustand.verortet}
        onUmschalten={umschalten('verortet')}
      >
        {/* Kein eigener Fehlerkasten (siehe `SidebarSektionFehler`), aber im Fehlerfall weder
            Zahlen noch behauptete Leere (`zaehlerUnbekannt`). */}
        <MarkerSuche
          marker={props.suchbar}
          onMarkerWaehlen={props.onMarkerWaehlen}
          zaehlerUnbekannt={
            sektionFehler.nichtVerortet != null || props.suchbarUnvollstaendig === true
          }
          ortssuche={
            props.ortssuche ? { einsatzId: props.einsatzId, ...props.ortssuche } : undefined
          }
        />
      </KlappPaneel>

      {darfSchreiben && (
        <div ref={zeichnenRef}>
          <KlappPaneel
            titel="Zeichnen"
            kennung="zeichnen"
            offen={paneele.zustand.zeichnen}
            onUmschalten={umschalten('zeichnen')}
          >
            <Space orientation="vertical" style={{ width: '100%' }} size="middle">
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Typography.Text type="secondary">Zone zeichnen</Typography.Text>
                {ZONE_TYPEN.map((t) => {
                  if (t.geometrie === 'beides') {
                    return (
                      <Space key={t.typ} wrap>
                        <Typography.Text>{t.label}</Typography.Text>
                        {/* `farbe` ist ein persistierter Datenwert: er wandert über
                            `onZoneZeichnenStart` in die Datenbank (Begründung an
                            `FREIE_SKIZZE_VORGABEFARBE`). */}
                        <Button
                          onClick={() =>
                            props.onZoneZeichnenStart({
                              typ: t.typ,
                              modus: 'polygon',
                              farbe: FREIE_SKIZZE_VORGABEFARBE,
                            })
                          }
                        >
                          Fläche
                        </Button>
                        <Button
                          onClick={() =>
                            props.onZoneZeichnenStart({
                              typ: t.typ,
                              modus: 'linie',
                              farbe: FREIE_SKIZZE_VORGABEFARBE,
                            })
                          }
                        >
                          Linie
                        </Button>
                      </Space>
                    );
                  }
                  const modus: ZeichenModus = t.geometrie === 'LineString' ? 'linie' : 'polygon';
                  return (
                    <Button
                      key={t.typ}
                      block
                      onClick={() => props.onZoneZeichnenStart({ typ: t.typ, modus })}
                    >
                      {t.label} zeichnen
                    </Button>
                  );
                })}
              </Space>
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Typography.Text type="secondary">Taktisches Zeichen</Typography.Text>
                {/* Ein laufendes Zeichen bedient das Modus-Band bzw. der Fuß (LLH-1028). */}
                {props.zeichenPlatzieren ? (
                  <Typography.Text type="secondary">wird platziert</Typography.Text>
                ) : zeichenPickerOffen ? (
                  <Space orientation="vertical" style={{ width: '100%' }}>
                    {/* Enter im Picker nimmt denselben Weg wie der Knopf — mit der mitgebrachten
                        Spec, weil `zeichenEntwurf` die per Enter gewählte Kachel in dieser Runde
                        noch nicht trägt. */}
                    <FreiesZeichenPicker
                      wert={zeichenEntwurf}
                      onChange={setZeichenEntwurf}
                      onAbsenden={platziereZeichen}
                    />
                    <Space>
                      {/* Ohne Zeichen („Kein Grundzeichen“ vor der Symbolwahl) gesperrt. */}
                      <Button
                        type="primary"
                        disabled={!hatZeichen(zeichenEntwurf)}
                        onClick={() => {
                          if (hatZeichen(zeichenEntwurf)) platziereZeichen(zeichenEntwurf);
                        }}
                      >
                        Platzieren
                      </Button>
                      <Button onClick={() => setZeichenPickerOffen(false)}>Abbrechen</Button>
                    </Space>
                  </Space>
                ) : (
                  <Button block onClick={() => setZeichenPickerOffen(true)}>
                    Taktisches Zeichen platzieren
                  </Button>
                )}
              </Space>
            </Space>
          </KlappPaneel>
        </div>
      )}
    </div>
  );
}

/**
 * Rechte Leiste der Lagekarte, 300 px ab `lg` (LLH-1028, Zielgliederung LLH-1023). Von oben:
 * 1. Segmentleiste „Ebenen“ · „Objekte“ (Tabliste, jedes Segment ein festes Drittel — das dritte
 *    bleibt bis zur Ansicht „Auswahl“ leer, damit kein Segment wandert);
 * 2. das Modus-Band des laufenden Leistenmodus (`ModusBand`);
 * 3. die Rollfläche: „Ausgewählt“ (übergangsweise über beiden Ansichten), dann die Ansicht.
 *
 * Beide Ansichten bleiben montiert und werden nur verborgen: Suchbegriffe, Zeichen-Entwurf und
 * Klappzustand überleben so jeden Wechsel und jeden Kartenmodus. Die gezeigte Ansicht hält die
 * Seite (`useLeistenAnsicht`), weil sie wissen muss, ob der Kopf der Ebenen zu sehen ist.
 */
export default function Sidebar(props: SidebarProps) {
  const { token, rollen } = useRollen();
  const ebenenId = useId();
  const objekteId = useId();
  const modus = props.platzierModus ?? null;
  const bedienung = (props.modusBedienung ?? 'band') === 'band';
  const ziel = props.platzierungZiel;
  // Je Ziel ein neues Band: ein Koordinaten- oder Mittelpunkt-Entwurf wandert nicht ins nächste.
  const bandSchluessel =
    modus == null
      ? 'kein'
      : modus.art === 'platzieren' && ziel
        ? `platzieren:${ziel.typ}:${ziel.id}`
        : modus.art === 'bild'
          ? `bild:${props.bildPlatzierenId ?? ''}`
          : modus.art;
  return (
    <div
      data-lfh="kartenleiste"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: rollen.paneel,
        color: rollen.text,
      }}
    >
      <div
        className="lfh-leisten-ansichten"
        style={{ padding: token.paddingXS, borderBlockEnd: `1px solid ${rollen.linie}` }}
      >
        <Segmentleiste<LeistenAnsicht>
          rolle="tablist"
          beschriftung="Ansicht der Leiste"
          wert={props.ansicht}
          onWechsel={props.onAnsichtWechsel}
          optionen={[
            { wert: 'ebenen', label: 'Ebenen', steuert: ebenenId },
            { wert: 'objekte', label: 'Objekte', steuert: objekteId },
          ]}
        />
      </div>
      {props.darfSchreiben && (
        <ModusBand
          key={bandSchluessel}
          modus={modus}
          bedienung={bedienung}
          platzieren={
            ziel
              ? {
                  einsatzId: props.einsatzId,
                  exclude: ortVorschauExclude(ziel, props.einsatzId),
                  onKoordinate: props.onKoordinateEingeben,
                }
              : undefined
          }
          bild={{
            einsatzId: props.einsatzId,
            griffHinweis: griffHinweis(props.griffModus, { kantenAus: props.griffKantenAus }),
            zentrum: props.bildPlatzierZentrum,
            onMittelpunkt: props.onBildMittelpunkt,
          }}
        />
      )}
      <div data-lfh="leisten-rollflaeche" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <LeistenAbschnitt titel="Ausgewählt" kennung="ausgewaehlt">
          {props.auswahl ?? (
            <p
              style={{
                margin: 0,
                padding: token.padding,
                fontSize: 12,
                color: rollen.gedaempft,
              }}
            >
              Nichts gewählt
            </p>
          )}
        </LeistenAbschnitt>
        <div role="tabpanel" id={ebenenId} aria-label="Ebenen" hidden={props.ansicht !== 'ebenen'}>
          <Ebenenbaum {...props} />
        </div>
        <ObjekteAnsicht {...props} id={objekteId} hidden={props.ansicht !== 'objekte'} />
      </div>
    </div>
  );
}
