import { Button, Typography } from 'antd';
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Segmentleiste, useRollen } from '../../components/instrument';
import { griffHinweis, type GriffModus, type KantenAus } from './bildGriffe';
import type {
  PersonenEbenenAngabe,
  BetreuungEbenenAngabe,
  BrEbenenAngabe,
  TierEbenenAngabe,
} from './leistenDaten';
import type { PlatzierModus } from './PlatzierSteuerung';
import ModusBand from './ModusBand';
import Ebenenbaum from './Ebenenbaum';
import { type SektionFehler } from './leistenTeile';
import type { GezeigteAnsicht, LeistenAnsicht } from './leistenWahl';
import './lagekarte.css';
import type { KarteMarker, MarkerTyp, NichtVerortet } from './marker';
import type { BasemapModus, KartenThemeWahl } from './basemapStil';
import type { GefundenerOrt } from '../../anzeige/ortssuche';
import MarkerSuche from './MarkerSuche';
import EscKappe from './EscKappe';
import { zielSchluessel, type ObjektEintrag } from './objektsuche';
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
 * Was gerade platziert wird, als Text für das Modus- und Fuß-Band (LFH-765): Typ und Name des nicht
 * verorteten Objekts. Steht das Ziel nicht unter den nicht verorteten (Verschieben eines
 * verorteten Objekts per `?platzieren=`, Betroffene), bleibt der Typname.
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

/** Die Typen, die „Platzieren“ als Punkt kennt — Abschnitte zeichnen eine Fläche. */
const PUNKT_TYPEN: ReadonlySet<MarkerTyp> = new Set<PlatzierenPunktTyp>([
  'uhs',
  'schaden',
  'einheit',
  'fahrzeug',
  'fuehrung',
  'betreuungsstelle',
  'bereitstellungsraum',
  'tier',
]);
const istPunktTyp = (typ: MarkerTyp): typ is PlatzierenPunktTyp => PUNKT_TYPEN.has(typ);

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
 */
export interface SidebarSektionFehler {
  /**
   * Die Lagebild-Quellen hinter der Objektliste (und damit hinter „Alles verortet"): der Slot steht
   * über der Liste, Köpfe und Marke tragen „—".
   */
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
  verortet: KarteMarker[];
  /**
   * Die Objektliste der Ansicht „Objekte“ — `objektEintraege` aus `objektsuche.ts`: verortet und
   * nicht verortet, ohne Namen aus Modulen ohne Recht. Getrennt von `verortet`, das die
   * Ebenen-Zeilen zählt und keine Betroffenen trägt.
   */
  objekte: ObjektEintrag[];
  /** Eine Quelle der Liste ist ausgefallen — dann „—" statt Zahlen, keine behauptete Leere. */
  objekteUnvollstaendig?: boolean;
  /**
   * Ortssuche im selben Feld (LFH-638): Koordinate und Adresse anspringen. Eine `vorbelegung`
   * (`?ort=`) belegt das Suchfeld der Ansicht „Objekte“; die Seite holt die Ansicht nach vorn.
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
  /** Gemerkte Ansicht der Leiste — die Seite hält sie (`useLeistenAnsicht`). */
  ansicht: LeistenAnsicht;
  /**
   * Steht die Ansicht „Auswahl“ vorn (`useAuswahlVorn`)? Wirkt nur mit `auswahl`; ohne Auswahl gibt
   * es das Segment nicht.
   */
  auswahlVorn?: boolean;
  /** Zählt jedes Nach-vorn-Holen der Auswahl: die Rollfläche beginnt dann oben. */
  auswahlNr?: number;
  /** Tipp auf ein Segment: „Ebenen“/„Objekte“ lassen die Auswahl bestehen. */
  onAnsichtWechsel: (ansicht: GezeigteAnsicht) => void;
  /** Rückweg „← Ebenen“/„← Objekte“: hebt die Auswahl auf. */
  onAuswahlZurueck?: () => void;
  /** Hebt Esc gerade die Auswahl auf? Dann trägt der Rückweg die Tastenkappe. */
  auswahlEsc?: boolean;
  onKoordinateEingeben: (lat: number, lon: number) => void;
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
   * Inhalt der Ansicht „Auswahl" — die Inspectors der gewählten Objekte (Marker, Zone, freies
   * Zeichen, Fachebene), untereinander. Ohne Auswahl gibt es die Ansicht nicht.
   */
  auswahl?: ReactNode;
}

/**
 * Trefflächenboden für ein handgebautes Bedienziel. Die Orts-Treffer der Objektsuche sind klickbar,
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
 * Ansicht „Objekte“ der Kartenleiste (LLH-1033): ein Suchfeld und eine Liste aller Objekte, verortet
 * und nicht verortet (`MarkerSuche`), der Einsatzort als erste Zeile; „Nicht verortet“ ist ein
 * Filter. Laufende Modi zeigen hier nur den Zustand, bedient werden sie im Modus-Band bzw. im Fuß.
 * Gezeichnet wird über das Werkzeugmenü an der Karte (LLH-1038); die Leiste trägt keinen
 * Zeichenweg, nur „Fläche zeichnen“ verortet einen Abschnitt.
 */
function ObjekteAnsicht(props: SidebarProps & { id: string; hidden: boolean }) {
  const { darfSchreiben, platzierungZiel } = props;
  const sektionFehler = props.sektionFehler ?? {};
  const ziel = zielSchluessel(platzierungZiel);
  /**
   * Rechts in der Zeile: sekundäre (umrandete) Knöpfe — „genau eine Primäraktion" gilt auch in der
   * Leiste. Das laufende Ziel zeigt nur „wird platziert“: „Abbrechen“ steht im Modus-Band bzw. im
   * Fuß (LLH-1028), je Breite ein Knopf je Handlung.
   */
  const zeilenAktion = (e: ObjektEintrag): ReactNode => {
    if (!darfSchreiben) return null;
    if (e.schluessel === ziel)
      return <Typography.Text type="secondary">wird platziert</Typography.Text>;
    if (e.typ === 'einsatzort')
      return (
        <Button onClick={props.onEinsatzortPlatzieren}>
          {e.verortet ? 'Verschieben' : 'Platzieren'}
        </Button>
      );
    if (e.verortet) return null;
    if (e.typ === 'abschnitt')
      return <Button onClick={() => props.onAbschnittZeichnenStart(e.id)}>Fläche zeichnen</Button>;
    const typ = e.typ;
    if (!istPunktTyp(typ)) return null;
    return <Button onClick={() => props.onPlatzierenStart({ typ, id: e.id })}>Platzieren</Button>;
  };

  return (
    <div role="tabpanel" id={props.id} aria-label="Objekte" hidden={props.hidden}>
      <div data-paneel="objekte">
        <MarkerSuche
          eintraege={props.objekte}
          onMarkerWaehlen={props.onMarkerWaehlen}
          fehler={sektionFehler.nichtVerortet}
          zaehlerUnbekannt={props.objekteUnvollstaendig === true}
          angeheftet={ziel}
          zeilenAktion={zeilenAktion}
          ortssuche={
            props.ortssuche ? { einsatzId: props.einsatzId, ...props.ortssuche } : undefined
          }
        />
      </div>
    </div>
  );
}

const ANSICHT_NAME: Record<LeistenAnsicht, string> = { ebenen: 'Ebenen', objekte: 'Objekte' };

/**
 * Rechte Leiste der Lagekarte, 300 px ab `lg` (LLH-1028, LLH-1033, Zielgliederung LLH-1023). Von
 * oben:
 * 1. Segmentleiste „Ebenen“ · „Objekte“ · „Auswahl“ (Tabliste, jedes Segment ein festes Drittel —
 *    „Auswahl“ gibt es nur mit einer Auswahl, ohne sie bleibt ihr Drittel leer, damit kein Segment
 *    wandert);
 * 2. das Modus-Band des laufenden Leistenmodus (`ModusBand`);
 * 3. die Rollfläche mit der gezeigten Ansicht.
 *
 * Alle Ansichten bleiben montiert und werden nur verborgen: Suchbegriffe, Filter, Zeichen-Entwurf
 * und Klappzustand überleben so jeden Wechsel und jeden Kartenmodus. Die Rollfläche merkt sich ihre
 * Lage je Ansicht; „Auswahl“ beginnt bei jeder neuen Auswahl oben. Welche Ansicht vorn steht, hält
 * die Seite (`useLeistenAnsicht`, `useAuswahlVorn`), weil sie wissen muss, ob der Kopf der Ebenen zu
 * sehen ist.
 */
export default function Sidebar(props: SidebarProps) {
  const { token, rollen } = useRollen();
  const ebenenId = useId();
  const objekteId = useId();
  const auswahlId = useId();
  const modus = props.platzierModus ?? null;
  const bedienung = (props.modusBedienung ?? 'band') === 'band';
  const ziel = props.platzierungZiel;
  const auswahlOffen = props.auswahl != null;
  const gezeigt: GezeigteAnsicht =
    auswahlOffen && props.auswahlVorn !== false ? 'auswahl' : props.ansicht;
  // Je Ziel ein neues Band: ein Koordinaten- oder Mittelpunkt-Entwurf wandert nicht ins nächste.
  const bandSchluessel =
    modus == null
      ? 'kein'
      : modus.art === 'platzieren' && ziel
        ? `platzieren:${ziel.typ}:${ziel.id}`
        : modus.art === 'bild'
          ? `bild:${props.bildPlatzierenId ?? ''}`
          : modus.art;

  // Rollposition je Ansicht: die Rollfläche ist eine für alle drei. Gemerkt wird beim Rollen,
  // gesetzt beim Wechsel (vor dem Malen, `useLayoutEffect`); „Auswahl“ beginnt oben.
  const rollRef = useRef<HTMLDivElement>(null);
  const rollLage = useRef<Partial<Record<GezeigteAnsicht, number>>>({});
  const gezeigtRef = useRef(gezeigt);
  gezeigtRef.current = gezeigt;
  const auswahlNr = props.auswahlNr ?? 0;
  useLayoutEffect(() => {
    const flaeche = rollRef.current;
    if (!flaeche) return;
    flaeche.scrollTop = gezeigt === 'auswahl' ? 0 : (rollLage.current[gezeigt] ?? 0);
  }, [gezeigt, auswahlNr]);

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
        className={
          auswahlOffen
            ? 'lfh-leisten-ansichten lfh-leisten-ansichten--drei'
            : 'lfh-leisten-ansichten'
        }
        style={{ padding: token.paddingXS, borderBlockEnd: `1px solid ${rollen.linie}` }}
      >
        <Segmentleiste<GezeigteAnsicht>
          rolle="tablist"
          beschriftung="Ansicht der Leiste"
          wert={gezeigt}
          onWechsel={props.onAnsichtWechsel}
          optionen={[
            { wert: 'ebenen', label: 'Ebenen', steuert: ebenenId },
            { wert: 'objekte', label: 'Objekte', steuert: objekteId },
            ...(auswahlOffen
              ? [{ wert: 'auswahl' as const, label: 'Auswahl', steuert: auswahlId }]
              : []),
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
      <div
        ref={rollRef}
        data-lfh="leisten-rollflaeche"
        onScroll={(ev) => {
          rollLage.current[gezeigtRef.current] = ev.currentTarget.scrollTop;
        }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        <div role="tabpanel" id={ebenenId} aria-label="Ebenen" hidden={gezeigt !== 'ebenen'}>
          <Ebenenbaum {...props} />
        </div>
        <ObjekteAnsicht {...props} id={objekteId} hidden={gezeigt !== 'objekte'} />
        {auswahlOffen && (
          <section
            role="tabpanel"
            id={auswahlId}
            aria-label="Auswahl"
            data-paneel="ausgewaehlt"
            hidden={gezeigt !== 'auswahl'}
          >
            <div
              data-lfh="auswahl-kopf"
              style={{ padding: token.paddingXS, borderBlockEnd: `1px solid ${rollen.linie}` }}
            >
              {/* Der Rückweg benennt sein Ziel; er hebt die Auswahl auf (LLH-1023 D1). */}
              <Button
                type="text"
                onClick={props.onAuswahlZurueck}
                aria-label={`Zurück zu ${ANSICHT_NAME[props.ansicht]}`}
                aria-keyshortcuts={props.auswahlEsc ? 'Escape' : undefined}
              >
                <span aria-hidden="true">←</span> {ANSICHT_NAME[props.ansicht]}
                {props.auswahlEsc && <EscKappe />}
              </Button>
            </div>
            {props.auswahl}
          </section>
        )}
      </div>
    </div>
  );
}
