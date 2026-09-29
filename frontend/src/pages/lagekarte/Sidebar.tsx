import {
  Button,
  Dropdown,
  Input,
  Modal,
  Radio,
  Slider,
  Space,
  Spin,
  Switch,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenFehler, SeitenLeer, SeitenStandVeraltet } from '../../components/SeitenZustand';
import {
  AimOutlined,
  DeleteOutlined,
  FullscreenOutlined,
  LockOutlined,
  MoreOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TbLayersIntersect } from 'react-icons/tb';
import { monoStil, Segmentleiste, useRollen } from '../../components/instrument';
import { griffHinweis, type GriffModus } from './bildGriffe';
import { KlappPaneel, LeistenAbschnitt, usePaneelZustand } from './KlappPaneel';
import {
  ebenenFarbe,
  ebenenZeilen,
  type EbenenZeile,
  type PersonenEbenenAngabe,
  type BetreuungEbenenAngabe,
} from './leistenDaten';
import Sichtungslegende from './Sichtungslegende';
import './lagekarte.css';
import type { KarteMarker, NichtVerortet } from './marker';
import type { BasemapModus, KartenThemeWahl } from './basemapStil';
import type { FreiesZeichenUpdate, ZoneTyp } from '../../api/types';
import type { ZeichenModus } from './zeichnen';
import { ZONE_TYPEN } from './zonenStil';
import FreiesZeichenPicker from './FreiesZeichenPicker';
import MarkerSuche from './MarkerSuche';
import { FACHEBENEN, fachebeneKeys, istBboxAbhaengig } from './fachebenen';
import KoordinatenEingabe from '../../anzeige/KoordinatenEingabe';
import type { LatLon } from '../../anzeige/koordinaten';
import type { Hintergrundbild } from '../../api/kartenbilder';
import type { KartenAnsicht } from '../../api/types';
import AnsichtSwitcher from './AnsichtSwitcher';
import AnsichtZuordnung from './AnsichtZuordnung';

export interface LayerSichtbar {
  einsatzort: boolean;
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
}

/**
 * Platzierbare Punkt-Typen (Fläche/Abschnitt über `onAbschnittZeichnenStart`). `person` kommt nur
 * über den Deeplink-Auftrag der Detailseite — Personen stehen nicht in „Nicht verortet", die
 * Koordinaten-Lücke zeigt die Betroffenen-Seite.
 */
export type PlatzierenPunktTyp =
  'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung' | 'person' | 'betreuungsstelle';

const NICHT_VERORTET_LABEL: Record<NichtVerortet['typ'], string> = {
  uhs: 'UHS',
  schaden: 'Schaden',
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  fuehrung: 'Personal', // beliebiges disponiertes Personal, nicht nur Führung
  abschnitt: 'Abschnitt',
  betreuungsstelle: 'Betreuungsstelle',
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
 * Das laufende Platzierungsziel bleibt immer stehen: seine Zeile trägt den einzigen
 * „Abbrechen"-Knopf des Modus. Filterte ein Begriff sie weg, säße die Einsatzkraft im
 * Platzier-Modus fest.
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
  // Sidebar-Typen → Backend-Marker-Tags; 'fuehrung' → 'personal'. Keine Betreuungsstelle: die
  // Peilung prüft nur den Einsatz-Lesezugriff und darf keine Stellen kennen (wie `person`).
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

/** Ein Fehler-Slot: was schiefging, woran es lag, und der Weg zurück. */
interface SektionFehler {
  /** Aus Sicht der Einsatzkraft — kein Statuscode, kein Stacktrace. */
  text: string;
  /** Rohfehler der Query; das Primitiv filtert selbst auf `ApiError`. */
  ursache?: unknown;
  onWiederholen?: () => void;
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
   * Unter `lg` steht die Bedienung der Leistenmodi (Abbrechen/Fertig, Serien-Schalter, Griffwahl)
   * im Fuß-Band `PlatzierSteuerung` über der Karte (LFH-765). Die Leiste zeigt dann an ihrer Stelle
   * nur einen Hinweis — je Breite genau ein Knopf je Handlung. Zusatzangaben (Koordinate,
   * Mittelpunkt numerisch) bleiben hier.
   */
  modusBedienungImFuss?: boolean;
  onKoordinateEingeben: (lat: number, lon: number) => void;
  einsatzortVerortet: boolean;
  onEinsatzortPlatzieren: () => void;
  layer: LayerSichtbar;
  onLayerToggle: (key: keyof LayerSichtbar, an: boolean) => void;
  /** Zahl der Zonen der aktiven Ansicht — UNGEGATTERT (siehe `ebenenZeilen`). */
  zonenAnzahl: number;
  /**
   * Ebene „Betroffene": Zugriff und Zahl der Personen-Marker (die laufen getrennt von `verortet`).
   * Fehlt die Angabe, gibt es keine Zeile.
   */
  personen?: PersonenEbenenAngabe;
  /** Ebene „Betreuungsstellen": nur die Zugriffsgrenze — die Marker zählen in `verortet` mit. */
  betreuung?: BetreuungEbenenAngabe;
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
  /** Bild-Hintergründe */
  bilder: Hintergrundbild[];
  onBildUpload: (datei: File) => void;
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
  onGriffModus: (modus: GriffModus) => void;
  /** Aktueller Mittelpunkt des Platzier-Bilds (für die numerische Eingabe). */
  bildPlatzierZentrum: LatLon | null;
  ansichten: KartenAnsicht[];
  aktiveAnsichtId?: number;
  onAnsichtWaehlen: (id: number) => void;
  onAnsichtNeu: (name: string) => void;
  onAnsichtUmbenennen: (id: number, name: string) => void;
  onAnsichtStandard: (id: number) => void;
  onAnsichtLoeschen: (id: number, objekte: 'freigeben' | 'loeschen') => void;
  ansichtBusy: boolean;
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
 * Stil einer Ebenen-Zeile — ein handgebautes Bedienziel (`<button role="switch">`): `minHeight` aus
 * `controlHeight` plus Polsterung. Rein und exportiert.
 */
export function ebenenZeileStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
  marginSM: number;
}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: token.marginSM,
    width: '100%',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
    margin: 0,
    border: 0,
    cursor: 'pointer',
    textAlign: 'start',
  };
}

/** Kantenlänge des Farbfelds einer Ebenen-Zeile (Neuentwurf S5). */
const FARBFELD = 14;

/**
 * Eine Zeile im Paneel „Ebenen": Farbfeld · Name · Anzahl; Klick schaltet die Ebene.
 * `role="switch"` + `aria-checked` tragen den Zustand; das Farbfeld (gefüllt an, leer aus) ist der
 * zweite Kanal. Der zugängliche Name ist der Ebenenname allein.
 */
function EbenenZeilenKnopf({
  zeile,
  onUmschalten,
}: {
  zeile: EbenenZeile;
  onUmschalten: (an: boolean) => void;
}) {
  const { token, rollen } = useRollen();
  const farbe = ebenenFarbe(zeile.key, rollen);
  if (zeile.sperrgrund) return <GesperrteEbenenZeile zeile={zeile} grund={zeile.sperrgrund} />;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={zeile.sichtbar}
      aria-label={zeile.name}
      data-ebene={zeile.key}
      className="lfh-ebenenzeile"
      onClick={() => onUmschalten(!zeile.sichtbar)}
      style={{
        ...ebenenZeileStil(token),
        borderBlockEnd: `1px solid ${rollen.flaeche3}`,
        color: zeile.sichtbar ? rollen.text : rollen.schwach,
      }}
    >
      <span
        aria-hidden="true"
        data-lfh="ebenen-farbfeld"
        style={{
          width: FARBFELD,
          height: FARBFELD,
          flex: `0 0 ${FARBFELD}px`,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: zeile.sichtbar ? farbe : rollen.steuerRahmen,
          background: zeile.sichtbar
            ? `color-mix(in srgb, ${farbe} 55%, transparent)`
            : 'transparent',
        }}
      />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>{zeile.name}</span>
      <span style={{ ...monoStil(11), color: rollen.schwach }}>{zeile.anzahl}</span>
    </button>
  );
}

/**
 * Eine gesperrte Ebenen-Zeile (heute nur „Betroffene"), gebaut wie ein gesperrtes Modul in
 * `einsatz/ModulPanel.tsx`: `disabled`, Schloss in `aria-hidden`-Hülle, der Grund als Text statt
 * einer Zahl. Kein `role="switch"` — ohne Zugriff gibt es keinen Zustand. Die Zahl entfällt, weil
 * sie die Menge wäre, die der Benutzer nicht sehen darf.
 */
function GesperrteEbenenZeile({ zeile, grund }: { zeile: EbenenZeile; grund: string }) {
  const { token, rollen } = useRollen();
  return (
    <button
      type="button"
      disabled
      aria-label={`${zeile.name} – ${grund}`}
      title={grund}
      data-ebene={zeile.key}
      data-gesperrt="true"
      className="lfh-ebenenzeile"
      style={{
        ...ebenenZeileStil(token),
        cursor: 'not-allowed',
        background: 'transparent',
        borderBlockEnd: `1px solid ${rollen.flaeche3}`,
        // `text2`, nicht `schwach`: der Grund ist die Aussage der Zeile und muss am Tag 7 : 1
        // halten (`schwach` auf `paneel`: 5,8 : 1).
        color: rollen.text2,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: FARBFELD,
          height: FARBFELD,
          flex: `0 0 ${FARBFELD}px`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: rollen.schwach,
        }}
      >
        <LockOutlined />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>{zeile.name}</span>
      <span style={{ fontSize: 11 }}>{grund}</span>
    </button>
  );
}

/** Ein Fehler-Slot als Markup — oder nichts. */
function FehlerSlot({ fehler }: { fehler?: SektionFehler }) {
  if (!fehler) return null;
  return (
    <SeitenFehler
      text={fehler.text}
      ursache={fehler.ursache}
      onWiederholen={fehler.onWiederholen}
    />
  );
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
 * Das Bild, dessen Entfernen bestätigt werden soll — oder `null`, wenn es keins (mehr) gibt. Nicht
 * bloß `loeschBildId != null`: die Bildliste kommt live, und entfernt ein zweiter Bediener das Bild
 * während der Rückfrage, stünde der Dialog mit leerem Titel und einem DELETE ins Leere da.
 *
 * Rein und exportiert, weil die Aussage am DOM nicht prüfbar ist: antd schließt ein `<Modal>` über
 * `transitionend`, das in jsdom nie feuert.
 */
export function loeschDialogBild<T extends { id: number; name: string }>(
  bilder: readonly T[],
  id: number | null,
): T | null {
  if (id == null) return null;
  return bilder.find((b) => b.id === id) ?? null;
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
 * Eine Schalter-Zeile der Leiste, die umbrechen darf: der Kippschalter ist im Handschuh 144 px
 * breit, nach der Polsterung bleiben 247 px — eine starre Zeile ließe dem Namen 19 px. Mit {@link
 * namensteilStil} rückt der Namensteil in eine eigene Zeile, sobald neben dem Schalter kein Platz
 * bleibt; in kompakt und komfortabel bleibt es eine Zeile. Das folgt aus dem Layout, nicht aus
 * einer Stufenabfrage. Nachweis: `e2e/lagekarte-leiste-dichte.spec.ts`.
 */
export function leistenZeileStil(token: { marginXS: number }) {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: token.marginXS,
  } as const;
}

/**
 * Der Namensteil einer {@link leistenZeileStil}-Zeile — Name und was ihm rechts folgt (Menü,
 * Statuswort) als eine Umbrucheinheit; getrennt umgebrochen rutschte das Menü allein in eine zweite
 * Zeile.
 *
 * Basis 0 plus Mindestbreite: das Element bricht um, sobald die Mindestbreite nicht mehr neben die
 * Vorgänger passt. Boden ist `6em` Name plus ein Bedienziel der Stufe (`controlHeight`).
 */
export function namensteilStil(token: { controlHeight: number; marginXS: number }) {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: token.marginXS,
    flex: '1 1 0',
    minWidth: `calc(6em + ${token.controlHeight}px)`,
  } as const;
}

/**
 * Rechte Leiste der Lagekarte, 300 px ab `lg`. Oben die festen Abschnitte Ebenen und Ausgewählt
 * (die Inspectors), darunter als einklappbare Paneele alles Übrige. Die Kartengrundlage selbst wird
 * in der Segmentleiste über der Karte gewählt.
 */
export default function Sidebar(props: SidebarProps) {
  const { nichtVerortet, verortet, darfSchreiben, platzierungZiel } = props;
  const sektionFehler = props.sektionFehler ?? {};
  /** Eine Zählung, die im Fehlerfall keine Null behauptet. */
  const zaehler = (n: number) => (sektionFehler.nichtVerortet ? '—' : n);
  const { token, rollen } = useRollen();
  const paneele = usePaneelZustand();
  const umschalten = (k: Parameters<typeof paneele.setze>[0]) => () =>
    paneele.setze(k, !paneele.zustand[k]);
  // Ein Paneel mit Fehler-Slot steht offen, egal wie es zuletzt stand: ein zugeklappter Fehler wäre
  // von „nichts da" nicht zu unterscheiden.
  const [koord, setKoord] = useState<LatLon | null>(null);
  // Freies-Zeichen-Schnellerfassung: der Picker erscheint erst auf Klick, der Entwurf bleibt über
  // Platzierungen erhalten.
  const [zeichenPickerOffen, setZeichenPickerOffen] = useState(false);
  const [zeichenEntwurf, setZeichenEntwurf] = useState<FreiesZeichenUpdate>({
    grundzeichen: 'taktische-formation',
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
  // Entwurfswert der numerischen Mittelpunkt-Eingabe im Bild-Platzier-Modus.
  const [bildMitte, setBildMitte] = useState<LatLon | null>(null);
  /**
   * Bild, dessen Entfernen bestätigt werden soll — ein Dialog für die ganze Liste, nicht je Zeile
   * (n Dialoge wären n gleichnamige Knöpfe).
   */
  const [loeschBildId, setLoeschBildId] = useState<number | null>(null);
  // Entwurf verwerfen, sobald ein anderes Bild platziert wird oder der Modus endet.
  useEffect(() => setBildMitte(null), [props.bildPlatzierenId]);
  const ebenen = ebenenZeilen(
    verortet,
    props.zonenAnzahl,
    props.layer,
    sektionFehler.nichtVerortet != null,
    props.personen,
    props.betreuung,
  );
  const zeigeSichtungslegende = props.layer.person && props.personen?.zugriff === 'frei';

  // Zeichnen-Knopf über der Karte: Paneel öffnen und in den Blick holen. Der Effekt hängt allein am
  // Zähler, damit ein Zuklappen ihn nicht erneut auslöst.
  const zeichnenRef = useRef<HTMLDivElement>(null);
  const { setze: paneelSetzen } = paneele;
  useEffect(() => {
    if (!props.zeichnenAnfrage) return;
    paneelSetzen('zeichnen', true);
    // jsdom kennt `scrollIntoView` nicht — optionaler Aufruf statt Absturz im Test.
    requestAnimationFrame(() => zeichnenRef.current?.scrollIntoView?.({ block: 'nearest' }));
  }, [props.zeichnenAnfrage, paneelSetzen]);

  // Die kleine Größe steht in dieser Datei nur noch an `Liste` (Abstandsmaß) und am `Spin`
  // (Anzeige); interaktive Elemente erben ihre Höhe vom `ConfigProvider`. Die anklickbaren Einträge
  // tragen `bedienzielStil`, die Ebenen-Zeilen `ebenenZeileStil`.
  //
  // Die Prop-Schreibweise steht bewusst nicht ausgeschrieben: Gate 4 zählt ihr Literal repo-weit.
  return (
    <div
      data-lfh="kartenleiste"
      style={{
        height: '100%',
        overflowY: 'auto',
        background: rollen.paneel,
        color: rollen.text,
      }}
    >
      {platzierungZiel && darfSchreiben && (
        <div
          data-lfh="platzieren-hinweis"
          style={{
            padding: token.padding,
            borderBlockEnd: `1px solid ${rollen.linie}`,
            borderInlineStart: `2px solid ${rollen.bedien}`,
            background: rollen.flaeche2,
          }}
        >
          <Typography.Text type="secondary">
            Klick auf die Karte setzt die Koordinate.{' '}
            {props.modusBedienungImFuss ? '(Beenden über der Karte.)' : '(Abbrechen beendet.)'}
          </Typography.Text>
          <div style={{ marginTop: token.marginXS }}>
            <KoordinatenEingabe
              value={koord}
              onChange={setKoord}
              einsatzId={props.einsatzId}
              exclude={ortVorschauExclude(props.platzierungZiel, props.einsatzId)}
            />
          </div>
          <div style={{ marginTop: token.marginXS }}>
            <Button
              disabled={!koord}
              onClick={() => {
                if (koord) {
                  props.onKoordinateEingeben(koord.lat, koord.lon);
                  setKoord(null);
                }
              }}
            >
              Übernehmen
            </Button>
          </div>
        </div>
      )}

      <LeistenAbschnitt titel="Ebenen" kennung="ebenen" zeichen={<TbLayersIntersect size={16} />}>
        <div role="group" aria-label="Ebenen ein- und ausblenden">
          {ebenen.map((z) => (
            <EbenenZeilenKnopf
              key={z.key}
              zeile={z}
              onUmschalten={(an) => props.onLayerToggle(z.key, an)}
            />
          ))}
        </div>
        {zeigeSichtungslegende && <Sichtungslegende />}
      </LeistenAbschnitt>

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
            Nichts gewählt. Ein Objekt auf der Karte oder unter „Verortet" antippen.
          </p>
        )}
      </LeistenAbschnitt>

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
                    Suchknopf wäre ein Tab-Ziel ohne Wirkung. Die Ikone in `aria-hidden`-Hülle
                    (sonst ein englisches „search"). */}
                <Input
                  aria-label="Nicht verortete Objekte durchsuchen"
                  placeholder="Name oder Typ"
                  allowClear
                  prefix={
                    <span aria-hidden="true" style={{ color: rollen.schwach }}>
                      <SearchOutlined />
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
                      action = props.modusBedienungImFuss ? (
                        <Typography.Text type="secondary">wird platziert</Typography.Text>
                      ) : (
                        <Button onClick={props.onPlatzierenAbbrechen}>Abbrechen</Button>
                      );
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
              props.modusBedienungImFuss ? (
                <Typography.Text type="secondary">wird platziert</Typography.Text>
              ) : (
                <Button onClick={props.onPlatzierenAbbrechen}>Abbrechen</Button>
              )
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
                            `onZoneZeichnenStart` in die Datenbank. Kein Laufzeit-Token, sonst
                            deutete ein Themenwechsel gespeicherte Zonen um — das Literal bleibt
                            bewusst. */}
                        <Button
                          onClick={() =>
                            props.onZoneZeichnenStart({
                              typ: t.typ,
                              modus: 'polygon',
                              farbe: '#1677ff',
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
                              farbe: '#1677ff',
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
                {props.zeichenPlatzieren ? (
                  <Space orientation="vertical" style={{ width: '100%' }}>
                    <Typography.Text type="secondary">
                      Auf Karte klicken zum Platzieren.
                    </Typography.Text>
                    {props.modusBedienungImFuss ? (
                      <Typography.Text type="secondary">Bedienung über der Karte.</Typography.Text>
                    ) : (
                      <>
                        {/* Serienmodus: der Schalter beschreibt den laufenden Modus und steht
                            deshalb hier, nicht im Picker. `wrap`: im Handschuh ist er 144 px breit. */}
                        <Space wrap>
                          <Switch
                            checked={props.zeichenSerie}
                            onChange={props.onZeichenSerieWechsel}
                            aria-label="Weitere platzieren"
                          />
                          <Typography.Text>Weitere platzieren</Typography.Text>
                        </Space>
                        {props.zeichenSerieAnzahl > 0 && (
                          <Typography.Text type="secondary">
                            {props.zeichenSerieAnzahl} platziert
                          </Typography.Text>
                        )}
                        {/* Solange nichts gesetzt ist, verwirft Beenden nur die Absicht
                            („Abbrechen"); ab dem ersten Zeichen wäre „Abbrechen" falsch — das
                            Gespeicherte bleibt. */}
                        {props.zeichenSerieAnzahl > 0 ? (
                          <Button type="primary" onClick={props.onZeichenPlatzierenFertig}>
                            Fertig
                          </Button>
                        ) : (
                          <Button onClick={props.onZeichenPlatzierenAbbrechen}>Abbrechen</Button>
                        )}
                      </>
                    )}
                  </Space>
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
                      <Button type="primary" onClick={() => platziereZeichen(zeichenEntwurf)}>
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

      <KlappPaneel
        titel="Kartenansicht"
        kennung="ansicht"
        offen={paneele.zustand.ansicht || sektionFehler.ansichten != null}
        onUmschalten={umschalten('ansicht')}
      >
        {sektionFehler.ansichten ? (
          <FehlerSlot fehler={sektionFehler.ansichten} />
        ) : (
          <AnsichtSwitcher
            ansichten={props.ansichten}
            aktiveAnsichtId={props.aktiveAnsichtId}
            darfSchreiben={darfSchreiben}
            busy={props.ansichtBusy}
            onWaehlen={props.onAnsichtWaehlen}
            onNeu={props.onAnsichtNeu}
            onUmbenennen={props.onAnsichtUmbenennen}
            onStandard={props.onAnsichtStandard}
            onLoeschen={props.onAnsichtLoeschen}
          />
        )}
        {darfSchreiben && props.ansichtDirty && (
          <Space orientation="vertical" style={{ width: '100%', marginTop: token.marginSM }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Karten-Konfiguration weicht von der gespeicherten Ansicht ab.
            </Typography.Text>
            {/* Schreibt in die aktive Ansicht, nicht in eine einsatzweite Einstellung. */}
            <Button
              type="primary"
              block
              loading={props.ansichtSpeichert}
              onClick={props.onAnsichtSpeichern}
            >
              In dieser Ansicht speichern
            </Button>
          </Space>
        )}
      </KlappPaneel>

      <KlappPaneel
        titel="Fachebenen (extern)"
        kennung="fachebenen"
        offen={paneele.zustand.fachebenen}
        onUmschalten={umschalten('fachebenen')}
        meta={fachebeneKeys().filter((k) => props.fachebenenSichtbar[k]).length || undefined}
      >
        <Space orientation="vertical" style={{ width: '100%' }}>
          {fachebeneKeys().map((key) => {
            const def = FACHEBENEN[key];
            const status = props.fachebenenStatus[key];
            const sichtbar = props.fachebenenSichtbar[key];
            const offline = status === 'offline';
            const laedt = sichtbar && props.fachebenenLaedt?.[key];
            const zoomHinweis = sichtbar && istBboxAbhaengig(key) && props.zoomZuKlein?.[key];
            return (
              <div key={key} data-fachebene={key} style={leistenZeileStil(token)}>
                {/* Der Name steht am Schalter selbst — sonst läse ein Vorleser namenlose
                    Schalter. */}
                <Switch
                  checked={sichtbar}
                  aria-label={def.label}
                  onChange={(v) => props.onFachebeneToggle(key, v)}
                />
                {/* Marke, Beschriftung und Statuswort sind ein Umbruchteil: das Farbquadrat geht
                    mit seinem Wort. */}
                <span style={namensteilStil(token)}>
                  <span style={{ color: def.farbe }} aria-hidden="true">
                    ■
                  </span>
                  {/* Der Geltungsbereich steht als Zeile, nicht als Tooltip: auf dem Tablet gibt
                      es kein Hovern. */}
                  <span style={{ display: 'inline-flex', flexDirection: 'column', flex: 1 }}>
                    <span>{def.label}</span>
                    {def.geltung && (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {def.geltung}
                      </Typography.Text>
                    )}
                  </span>
                  {laedt ? (
                    <Spin size="small" />
                  ) : zoomHinweis ? (
                    <Tooltip
                      title={`${def.label}: Objekte werden erst ab einer näheren Zoomstufe geladen`}
                    >
                      <Typography.Text type="warning" style={{ fontSize: 11 }}>
                        näher heranzoomen
                      </Typography.Text>
                    </Tooltip>
                  ) : (
                    <>
                      {/* `nowrap`: sonst bricht die Marke mitten im Wort. */}
                      {sichtbar && offline && (
                        <Tooltip title="Quelle offline — Ebene wird leer angezeigt">
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                          >
                            offline
                          </Typography.Text>
                        </Tooltip>
                      )}
                      {sichtbar && status === 'leer' && (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                        >
                          keine Daten
                        </Typography.Text>
                      )}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </Space>
      </KlappPaneel>

      <KlappPaneel
        titel="Bild-Hintergründe"
        kennung="bilder"
        offen={paneele.zustand.bilder || sektionFehler.bilder != null}
        onUmschalten={umschalten('bilder')}
        meta={props.bilder.length || undefined}
      >
        <Space orientation="vertical" style={{ width: '100%' }}>
          {/* Der Slot ist ein Banner über der Liste, kein Ersatz: die Overlays liegen weiter auf
              der Karte, ohne Bedienelemente ließe sich keins mehr abschalten. `SeitenFehler`,
              weil der Slot eine `ursache` führt. Der Upload hängt an einer eigenen Route und
              bleibt bedienbar. */}
          <FehlerSlot fehler={sektionFehler.bilder} />
          {props.bilder.map((b) => {
            const imPlatzieren = props.bildPlatzierenId === b.id;
            return (
              <div
                key={b.id}
                style={{
                  borderBottom: `1px solid ${rollen.flaeche3}`,
                  paddingBottom: token.paddingSM,
                }}
              >
                <div style={{ ...leistenZeileStil(token), alignItems: 'center' }}>
                  <Switch
                    checked={b.sichtbar}
                    aria-label={b.name}
                    onChange={(v) => props.onBildToggle(b.id, v)}
                    style={{ flexShrink: 0 }}
                  />
                  <span style={{ ...namensteilStil(token), alignItems: 'center' }}>
                    <Typography.Text
                      ellipsis={{ tooltip: b.name }}
                      editable={
                        darfSchreiben
                          ? {
                              tooltip: 'Umbenennen',
                              onChange: (val) => {
                                const t = val.trim();
                                if (t && t !== b.name) props.onBildUmbenennen(b.id, t);
                              },
                            }
                          : false
                      }
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {b.name}
                    </Typography.Text>
                    {/* Drei Aktionen an einer Zeile werden gebündelt; ohne Schreibrecht bleibt
                        eine, dann steht der Zentrieren-Knopf direkt da. */}
                    <div style={{ flexShrink: 0 }}>
                      {darfSchreiben ? (
                        <Dropdown
                          trigger={['click']}
                          // `autoFocus`: ohne ihn klebt der Fokus am Auslöser. In jsdom nicht
                          // prüfbar.
                          autoFocus
                          menu={{
                            items: [
                              {
                                key: 'zentrieren',
                                icon: <FullscreenOutlined />,
                                label: 'Auf Bild zentrieren',
                              },
                              {
                                key: 'platzieren',
                                icon: <AimOutlined />,
                                label: imPlatzieren
                                  ? 'Platzieren beenden'
                                  : 'Auf der Karte platzieren',
                              },
                              /*
                               * Die Trennung zwischen destruktiver und harmloser Aktion ist im Menü
                               * der Trenner.
                               */
                              { type: 'divider' as const },
                              {
                                key: 'loeschen',
                                icon: <DeleteOutlined />,
                                label: 'Bild entfernen …',
                                danger: true,
                              },
                            ],
                            // Zuordnung am Menü, nicht je Eintrag: ein Riegel hat dann einen Ort.
                            onClick: ({ key }) => {
                              if (key === 'zentrieren') props.onBildZentrieren(b.id);
                              else if (key === 'platzieren') {
                                if (imPlatzieren) props.onBildPlatzierenFertig();
                                else props.onBildPlatzieren(b.id);
                              } else if (key === 'loeschen') setLoeschBildId(b.id);
                            },
                          }}
                        >
                          {/* Der Name trägt die Bild-Kennung. Kein `size`. */}
                          <Button
                            type="text"
                            icon={<MoreOutlined />}
                            aria-label={`Aktionen zu ${b.name}`}
                          />
                        </Dropdown>
                      ) : (
                        <Tooltip title="Auf Bild zentrieren">
                          <Button
                            icon={<FullscreenOutlined />}
                            onClick={() => props.onBildZentrieren(b.id)}
                            aria-label={`${b.name} zentrieren`}
                          />
                        </Tooltip>
                      )}
                    </div>
                  </span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  value={b.opazitaet}
                  disabled={!darfSchreiben}
                  onChange={(v) => props.onBildOpazitaet(b.id, v as number)}
                  tooltip={{ formatter: (v) => `${v}%` }}
                />
                <AnsichtZuordnung
                  ansichten={props.ansichten}
                  wert={b.ansicht_id}
                  disabled={!darfSchreiben}
                  onChange={(ansichtId) => props.onBildVerschieben(b.id, ansichtId)}
                />
                {imPlatzieren && darfSchreiben && (
                  <div
                    style={{
                      padding: token.paddingXS,
                      background: token.colorPrimaryBg,
                      borderRadius: token.borderRadiusSM,
                    }}
                  >
                    {/* Ein Umschalter statt zehn gleichzeitig scharfer Griffe: in Fingergröße
                        lägen Ecken, Kanten, Drehung und Mitte auf einem kleinen Bild
                        übereinander. Der Hinweis nennt nur die aktiven Griffe. */}
                    {props.modusBedienungImFuss ? (
                      <Typography.Text type="secondary" style={{ display: 'block' }}>
                        Bedienung über der Karte.
                      </Typography.Text>
                    ) : (
                      <Segmentleiste<GriffModus>
                        beschriftung="Griffe auf der Karte"
                        wert={props.griffModus}
                        onWechsel={props.onGriffModus}
                        optionen={[
                          { wert: 'verschieben', label: 'Verschieben' },
                          { wert: 'groesse', label: 'Größe' },
                          { wert: 'drehen', label: 'Drehen' },
                        ]}
                        style={{ marginBottom: token.marginXS }}
                      />
                    )}
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12, display: 'block' }}
                      data-lfh="bildgriff-hinweis"
                    >
                      {griffHinweis(props.griffModus)} Oder Mittelpunkt numerisch:
                    </Typography.Text>
                    <div style={{ marginTop: token.marginSM }}>
                      <KoordinatenEingabe
                        value={bildMitte ?? props.bildPlatzierZentrum}
                        onChange={setBildMitte}
                        einsatzId={props.einsatzId}
                      />
                    </div>
                    <Space
                      style={{
                        marginTop: token.marginSM,
                        width: '100%',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Button
                        disabled={!bildMitte}
                        onClick={() => {
                          if (bildMitte) {
                            props.onBildMittelpunkt(bildMitte.lat, bildMitte.lon);
                            setBildMitte(null);
                          }
                        }}
                      >
                        Mittelpunkt setzen
                      </Button>
                      {!props.modusBedienungImFuss && (
                        <Button type="primary" onClick={props.onBildPlatzierenFertig}>
                          Fertig
                        </Button>
                      )}
                    </Space>
                  </div>
                )}
              </div>
            );
          })}
          {darfSchreiben && (
            <Upload
              accept="image/png,image/jpeg"
              showUploadList={false}
              beforeUpload={(datei) => {
                props.onBildUpload(datei as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>Bild hochladen</Button>
            </Upload>
          )}
        </Space>
      </KlappPaneel>

      {/* Löschbestätigung als ein Dialog für die ganze Bildliste, rot bestätigt. Kein
          `Popconfirm`: der bräuchte im Menü-Label ein `stopPropagation`. Außerhalb der `map` und
          des Paneels: n Dialoge trügen n gleichnamige Knöpfe, und ein zugeklapptes Paneel darf
          eine offene Rückfrage nicht abhängen. */}
      <Modal
        // Eine Quelle für Sichtbarkeit UND Titel (siehe `loeschDialogBild`).
        open={loeschDialogBild(props.bilder, loeschBildId) != null}
        title={`Bild „${loeschDialogBild(props.bilder, loeschBildId)?.name ?? ''}" entfernen?`}
        okText="Entfernen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        onOk={() => {
          if (loeschBildId != null) props.onBildLoeschen(loeschBildId);
          setLoeschBildId(null);
        }}
        onCancel={() => setLoeschBildId(null)}
        destroyOnHidden
      >
        <Typography.Paragraph>
          Das Bild wird aus der Lagekarte entfernt. Bereits gesetzte Eckpunkte gehen dabei verloren.
        </Typography.Paragraph>
      </Modal>

      <KlappPaneel
        titel="Kartengrundlage"
        kennung="grundlage"
        offen={paneele.zustand.grundlage}
        onUmschalten={umschalten('grundlage')}
      >
        <Space orientation="vertical" style={{ width: '100%' }}>
          {props.grundlageWahl ?? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Gewählt wird die Grundlage oben links auf der Karte.
            </Typography.Text>
          )}
          {!props.onlineVerfuegbar && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Online-Karte: nicht konfiguriert
            </Typography.Text>
          )}
          {!props.offlineVerfuegbar && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Offline-Karte: nicht konfiguriert
            </Typography.Text>
          )}
          {props.basemap === 'offline' && (
            <div>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, display: 'block', marginBottom: token.marginXS }}
              >
                Karten-Design
              </Typography.Text>
              <Radio.Group
                value={props.kartenTheme}
                onChange={(e) => props.onKartenThemeWechsel(e.target.value as KartenThemeWahl)}
                optionType="button"
                aria-label="Karten-Design"
                name="lagekarte-karten-design"
              >
                <Tooltip title="folgt dem App-Design">
                  <Radio.Button value="auto">Auto</Radio.Button>
                </Tooltip>
                <Radio.Button value="light">Hell</Radio.Button>
                <Radio.Button value="dark">Dunkel</Radio.Button>
              </Radio.Group>
            </div>
          )}
          {props.basemap === 'blind' && (
            <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
              Keine Basemap konfiguriert — Marker und Verorten funktionieren weiterhin.
            </Typography.Paragraph>
          )}
        </Space>
      </KlappPaneel>
    </div>
  );
}
