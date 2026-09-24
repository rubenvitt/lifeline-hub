import {
  Button,
  Dropdown,
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
  UploadOutlined,
} from '@ant-design/icons';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TbLayersIntersect } from 'react-icons/tb';
import { monoStil, useRollen } from '../../components/instrument';
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
  /** Ebene „Betroffene" (LFH-648). Der Schalter ist die Wahl, NICHT die Zugriffsgrenze —
   *  gezeichnet wird nur bei freigegebenem Modul „Personen" (`personenZugriff`). */
  person: boolean;
  /** Ebene „Betreuungsstellen" (LFH-673). Wie `person` ist der Schalter die Wahl, die
   *  Zugriffsgrenze ist die Datenquelle (`betreuungEbene.ts`). */
  betreuungsstelle: boolean;
}

/** Platzierbare Punkt-Typen (Fläche/Abschnitt läuft über onAbschnittZeichnenStart).
 *  `person` (Betroffene, LFH-613) kommt nur über den Deeplink-Auftrag von der Detailseite —
 *  die Lagekarte führt Personen zwar als Ebene (LFH-648), aber nicht in „Nicht verortet":
 *  die Koordinaten-Lücke zeigt die Betroffenen-Seite. */
export type PlatzierenPunktTyp =
  'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung' | 'person' | 'betreuungsstelle';

const NICHT_VERORTET_LABEL: Record<NichtVerortet['typ'], string> = {
  uhs: 'UHS',
  schaden: 'Schaden',
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  fuehrung: 'Personal', // LFH-276: beliebiges disponiertes Personal, nicht nur Führung
  abschnitt: 'Abschnitt',
  betreuungsstelle: 'Betreuungsstelle',
};

/** Platzierungsziel → exclude-Tag (typ:id) für die Ort-Vorschau (Selbst-Ausschluss).
 *  Einsatzort-Marker trägt die echte einsatzId, nicht die Dummy-0 aus dem Platzierungs-Ziel. */
export function ortVorschauExclude(
  ziel: SidebarProps['platzierungZiel'],
  einsatzId: number,
): string | undefined {
  if (!ziel) return undefined;
  if (ziel.typ === 'einsatzort') return `einsatzort:${einsatzId}`; // Marker-id = echte Einsatz-ID, nicht 0
  // Sidebar-Typen → Backend-Marker-Typ-Tags. 'fuehrung' = Personal-Führung → 'personal'.
  // Keine Betreuungsstelle (LFH-673): die Peilung prüft nur den Einsatz-Lesezugriff und darf
  // deshalb keine Stellen kennen — es gibt nichts auszuschließen (wie `person`).
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
export interface SektionFehler {
  /** Aus Sicht der Einsatzkraft — kein Statuscode, kein Stacktrace. */
  text: string;
  /** Rohfehler der Query; das Primitiv filtert selbst auf `ApiError`. */
  ursache?: unknown;
  onWiederholen?: () => void;
}

/**
 * Fehler-Slots je Sidebar-Sektion (LFH-331 · B3).
 *
 * Gesetzt = die Sektion sagt, WARUM sie nichts zeigt, statt eine leere Liste zu zeigen.
 * Der Unterschied ist nicht kosmetisch: eine leere Objektliste liest sich als „nichts da",
 * und im Einsatz ist „nichts da" eine Lagebeurteilung.
 *
 * Bewusst KEIN Slot an der Karte „Verortet": sie trifft keine Vollständigkeitsaussage,
 * ihre beiden Zahlen zählen nur — und ein zweiter, gleich begründeter Fehlerkasten 100 px
 * unter dem ersten füllt die 300 px breite Leiste, ohne eine neue Tatsache zu melden. Die
 * namentliche Meldung steht am Seitenkopf.
 */
export interface SidebarSektionFehler {
  /** Die Lagebild-Quellen hinter „Nicht verortet" (und damit hinter „Alles verortet"). */
  nichtVerortet?: SektionFehler;
  /** Eigene Query: `useKartenbilder`. */
  bilder?: SektionFehler;
  /** Eigene Query: `useKartenAnsicht`. Scheitert sie, rendert der Switcher heute NICHTS. */
  ansichten?: SektionFehler;
}

export interface SidebarProps {
  einsatzId: number;
  nichtVerortet: NichtVerortet[];
  verortet: KarteMarker[];
  darfSchreiben: boolean;
  platzierungZiel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number } | null;
  onPlatzierenStart: (ziel: { typ: PlatzierenPunktTyp; id: number }) => void;
  onPlatzierenAbbrechen: () => void;
  onAbschnittZeichnenStart: (id: number) => void;
  onZoneZeichnenStart: (entwurf: { typ: ZoneTyp; modus: ZeichenModus; farbe?: string }) => void;
  /** Freies taktisches Zeichen (LFH-170): aktive Platzierung + Start/Abbrechen. */
  zeichenPlatzieren: FreiesZeichenUpdate | null;
  onZeichenPlatzierenStart: (spec: FreiesZeichenUpdate) => void;
  onZeichenPlatzierenAbbrechen: () => void;
  /** Serienmodus des Platzierens (LFH-332/M76): AN heißt, ein erfolgreicher POST beendet
   *  den Platzier-Modus NICHT. Beendet wird dann über „Fertig". */
  zeichenSerie: boolean;
  onZeichenSerieWechsel: (an: boolean) => void;
  /** Bereits gesetzte Zeichen der laufenden Serie; 0 = noch keins (dann heißt Beenden „Abbrechen"). */
  zeichenSerieAnzahl: number;
  onZeichenPlatzierenFertig: () => void;
  onKoordinateEingeben: (lat: number, lon: number) => void;
  einsatzortVerortet: boolean;
  onEinsatzortPlatzieren: () => void;
  layer: LayerSichtbar;
  onLayerToggle: (key: keyof LayerSichtbar, an: boolean) => void;
  /** Zahl der Zonen der aktiven Ansicht — UNGEGATTERT (siehe `ebenenZeilen`). */
  zonenAnzahl: number;
  /**
   * Ebene „Betroffene" (LFH-648): Zugriff und Zahl der Personen-Marker. Die laufen getrennt
   * von `verortet`, die Zahl kommt deshalb von hier. Fehlt die Angabe, gibt es keine Zeile.
   */
  personen?: PersonenEbenenAngabe;
  /** Ebene „Betreuungsstellen" (LFH-673): nur die Zugriffsgrenze — die Marker zählen in
   *  `verortet` mit, wie die UHS. */
  betreuung?: BetreuungEbenenAngabe;
  /**
   * Gewählte Kartengrundlage. Gewählt wird sie in der Segmentleiste über der Karte; das
   * Paneel „Kartengrundlage" trägt nur, was dort keinen Platz hat (Karten-Design, Hinweise).
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
  /** „In dieser Ansicht speichern" (LFH-319/320): true, wenn der aktuelle Karten-Zustand von
   *  der gespeicherten Ansicht abweicht (Basemap/Ebenen/Fachebenen). */
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
  /** Je bbox-abhängiger Ebene: aktiv, aber die Karte ist zu weit herausgezoomt für eine
   *  Abfrage (LFH-81; bis dahin ein einzelnes Flag nur für KRITIS). */
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
  /** Bild auf eine andere Ansicht verschieben bzw. auf alle (`null`) — B/LFH-320. */
  onBildVerschieben: (id: number, ansichtId: number | null) => void;
  onBildZentrieren: (id: number) => void;
  onBildUmbenennen: (id: number, name: string) => void;
  /** Mittelpunkt des gerade platzierten Bilds numerisch setzen. */
  onBildMittelpunkt: (lat: number, lon: number) => void;
  bildPlatzierenId: number | null;
  /** Aktueller Mittelpunkt des Platzier-Bilds (für die numerische Eingabe). */
  bildPlatzierZentrum: LatLon | null;
  /** Ansichts-Switcher (B/LFH-320). */
  ansichten: KartenAnsicht[];
  aktiveAnsichtId?: number;
  onAnsichtWaehlen: (id: number) => void;
  onAnsichtNeu: (name: string) => void;
  onAnsichtUmbenennen: (id: number, name: string) => void;
  onAnsichtStandard: (id: number) => void;
  onAnsichtLoeschen: (id: number, objekte: 'freigeben' | 'loeschen') => void;
  ansichtBusy: boolean;
  /** Fehler-Slots je Sektion (LFH-331 · B3) — siehe `SidebarSektionFehler`. */
  sektionFehler?: SidebarSektionFehler;
  /**
   * Inhalt des Paneels „Ausgewählt" — die Inspectors der gewählten Objekte (Marker, Zone,
   * freies Zeichen, Fachebene). Leer → Hinweis, wie man etwas wählt.
   */
  auswahl?: ReactNode;
  /**
   * Zähler, der bei jeder Erhöhung das Paneel „Zeichnen" öffnet und in den Blick holt — der
   * Zeichnen-Knopf über der Karte. Ein Zähler statt eines Booleans, damit ein zweiter Klick
   * nach dem Zuklappen wieder greift.
   */
  zeichnenAnfrage?: number;
}

/**
 * Stil einer Ebenen-Zeile — ein handgebautes Bedienziel (`<button role="switch">`), also die
 * ZWEI Angaben aus LFH-365: `minHeight` aus `controlHeight` plus Polsterung. Rein und
 * exportiert, damit die Staffel 30 / 48 / 72 ohne Rendern prüfbar ist.
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
 *
 * `role="switch"` + `aria-checked` tragen den Zustand als Wort — das Farbfeld (gefüllt an,
 * leer aus) ist nur der zweite, sichtbare Kanal, und der gedämpfte Name der dritte. Der
 * zugängliche Name ist der Ebenenname allein; die Anzahl steht sichtbar daneben.
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
 * Eine gesperrte Ebenen-Zeile (LFH-648, heute nur „Betroffene"): dieselbe Bauform wie ein
 * gesperrtes Modul in der Einsatz-Navigation (`einsatz/ModulPanel.tsx`) — `disabled`, Schloss
 * in `aria-hidden`-Hülle (sonst läse ein antd-Icon sein englisches `aria-label` „lock" vor),
 * und der GRUND als Text statt einer Zahl. Kein `role="switch"`: eine Ebene ohne Zugriff hat
 * keinen Zustand, den man umlegen könnte. Die Zahl entfällt, weil sie die Menge wäre, die der
 * Benutzer nicht sehen darf. Das leere Farbfeld hält die Spalte der übrigen Zeilen.
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
        // `text2`, nicht `schwach`: der Grund ist die Aussage der Zeile und muss im Tagmodus
        // 7 : 1 halten (Prüfliste Kriterium 5; `schwach` auf `paneel` misst dort 5,8 : 1).
        // Gesperrt sagt das Schloss und das Wort, nicht eine blassere Schrift.
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

/** Ein Fehler-Slot als Markup — oder nichts. Hält die drei Aufrufstellen unten einzeilig. */
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
 * Derselbe Fehler, aber ÜBER erhalten gebliebenen Zeilen statt an ihrer Stelle (D5).
 *
 * `SeitenStandVeraltet` verlangt einen Wiederhol-Weg — ohne ihn trüge sein „Erneut abrufen"
 * ins Leere. `SektionFehler.onWiederholen` ist optional, also fällt der Slot dann auf die
 * gewöhnliche Fehlermeldung zurück. Bewusst NICHT auf „gar kein Banner": dass der gezeigte
 * Stand alt ist, bleibt die Aussage, die die Einsatzkraft braucht.
 */
function VeraltetSlot({ fehler }: { fehler?: SektionFehler }) {
  if (!fehler) return null;
  if (!fehler.onWiederholen) return <FehlerSlot fehler={fehler} />;
  return <SeitenStandVeraltet onWiederholen={fehler.onWiederholen} />;
}

/**
 * Das Bild, dessen Entfernen gerade bestätigt werden soll — oder `null`, wenn es keins (mehr)
 * gibt (LFH-366 · B5f, Review-Fund G2).
 *
 * Warum nicht einfach `loeschBildId != null`: die Bildliste kommt über den SSE-Fan-out und kann
 * sich ändern, WÄHREND die Rückfrage offensteht — ein zweiter Bediener entfernt dasselbe Bild.
 * Gemessen an einem `rerender` ohne das Bild blieb der Dialog dann offen, sein Titel fiel auf
 * `Bild „" entfernen?` zurück, und „Entfernen" schickte ein DELETE auf ein Objekt, das es nicht
 * mehr gibt. Der Zustand, den der Dialog beschreibt, ist die ZEILE, nicht die Nummer.
 *
 * Rein und exportiert aus demselben Grund wie {@link bedienzielStil}: die Aussage ist am DOM
 * nicht führbar. antd löst die Schliess-Animation eines `<Modal>` über `transitionend` auf, das
 * in jsdom nie feuert — nach `open={false}` steht der Knopf weiter im Baum (gemessen), und die
 * naheliegende Zusicherung `queryByRole('button') → null` wäre rot, obwohl die Härtung greift.
 * Eine Zusicherung auf antds `ant-zoom-leave` hinge dagegen an einer Animationsklasse, die beim
 * nächsten Bump wandert. Also wird geprüft, was die Entscheidung trägt, statt wie sie aussieht.
 */
export function loeschDialogBild<T extends { id: number; name: string }>(
  bilder: readonly T[],
  id: number | null,
): T | null {
  if (id == null) return null;
  return bilder.find((b) => b.id === id) ?? null;
}

/**
 * Trefflächenboden für ein HANDGEBAUTES Bedienziel (LFH-366 · B5f, Konvention aus LFH-365).
 *
 * Die Einträge der Karte „Verortet" sind klickbar, aber kein antd-Steuerelement: `ListenEintrag`
 * legt sein `onClick` auf ein nacktes `<div>`, und dessen Höhe entsteht allein aus der Polsterung
 * der `<Liste>`. Die trägt den Boden NICHT — gemessen kommt eine Zeile im Handschuh-Betrieb damit
 * auf grob 54 px gegen die geforderten 72. Deshalb ZWEI Angaben und nicht eine: `minHeight` aus
 * `controlHeight` (30 / 48 / 72) plus die Polsterung.
 *
 * Aufgelöste Tokens, nie `var(--lfh-*)`: die Arbeitsteilung steht in `theme/rollen.css`
 * („ZWEI QUELLEN, EINE WAHRHEIT") — handgeschriebenes CSS liest die Custom Properties, TSX liest
 * `theme.useToken()`. Präzedenz: `components/Datensicht.tsx:1255`, `etb/SlashMenu.tsx:102`.
 *
 * Rein und exportiert, damit die Zusicherung über zwei Dichtestufen prüfbar ist, OHNE zu rendern:
 * `test/utils.tsx` montiert ein nacktes `ConfigProvider` ohne unser Theme, ein gerenderter Wert
 * belegte also antd-Vorgaben statt der Staffel — und jsdom rechnet ohnehin kein Layout.
 *
 * **Was hier NICHT gelöst wird:** die Tastaturbedienbarkeit. Das `<div onClick>` hat weder `role`
 * noch `tabIndex` noch `onKeyDown`; das zu ändern hieße, `components/Liste.tsx` anzufassen, und
 * die klickbare Zeile als Ganzes ist ausdrücklich B7 (LFH-335) zugeordnet
 * (`components/Datensicht.tsx`, Festlegung 4). Der Boden hier ist die Trefffläche, nicht der
 * ganze Zugang.
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
 * Rechte Leiste der Lagekarte (Neuentwurf S5 „Karte führt, Daten folgen"), 300 px ab `lg`.
 *
 * Oben die zwei festen Abschnitte des Entwurfs — **Ebenen** (Farbfeld · Name · Anzahl, Klick
 * schaltet) und **Ausgewählt** (die Inspectors, die vorher über der Karte schwebten). Darunter
 * als einklappbare Paneele alles, was die alte linke Kartenleiste trug; nichts ist entfallen.
 * Die Kartengrundlage selbst wird in der Segmentleiste ÜBER der Karte gewählt.
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
  // Ein Paneel mit Fehler-Slot steht OFFEN, egal wie es zuletzt stand: ein zugeklappter Fehler
  // wäre von „nichts da" nicht zu unterscheiden (Fehler ≠ leer, LFH-331 · B3).
  const [koord, setKoord] = useState<LatLon | null>(null);
  // Freies-Zeichen-Schnellerfassung (LFH-170): Picker erst auf Klick sichtbar (kein Dauer-
  // Combobox in der Leiste), Entwurf bleibt über Platzierungen erhalten.
  const [zeichenPickerOffen, setZeichenPickerOffen] = useState(false);
  const [zeichenEntwurf, setZeichenEntwurf] = useState<FreiesZeichenUpdate>({
    grundzeichen: 'taktische-formation',
  });
  // Entwurfswert der numerischen Mittelpunkt-Eingabe im Bild-Platzier-Modus.
  const [bildMitte, setBildMitte] = useState<LatLon | null>(null);
  /**
   * Bild, dessen Entfernen bestätigt werden soll (LFH-366 · B5f) — EIN Dialog für die ganze
   * Liste, nicht einer je Zeile: n Dialoge im Baum wären n gleichnamige Knöpfe pro Rolle.
   */
  const [loeschBildId, setLoeschBildId] = useState<number | null>(null);
  // Entwurf verwerfen, sobald ein anderes Bild platziert wird oder der Modus endet.
  useEffect(() => setBildMitte(null), [props.bildPlatzierenId]);
  const uhsVerortet = verortet.filter((m) => m.typ === 'uhs');
  const schadenVerortet = verortet.filter((m) => m.typ === 'schaden');
  const ebenen = ebenenZeilen(
    verortet,
    props.zonenAnzahl,
    props.layer,
    sektionFehler.nichtVerortet != null,
    props.personen,
    props.betreuung,
  );
  const zeigeSichtungslegende = props.layer.person && props.personen?.zugriff === 'frei';

  // Zeichnen-Knopf über der Karte: Paneel öffnen und in den Blick holen. `setze` ist stabil;
  // der Effekt hängt allein am Zähler, damit ein Zuklappen ihn nicht erneut auslöst.
  const zeichnenRef = useRef<HTMLDivElement>(null);
  const { setze: paneelSetzen } = paneele;
  useEffect(() => {
    if (!props.zeichnenAnfrage) return;
    paneelSetzen('zeichnen', true);
    // jsdom kennt `scrollIntoView` nicht — optionaler Aufruf statt Absturz im Test.
    requestAnimationFrame(() => zeichnenRef.current?.scrollIntoView?.({ block: 'nearest' }));
  }, [props.zeichnenAnfrage, paneelSetzen]);

  // Zum kleinen `size`-Prop in dieser Datei (LFH-328/A1 Festlegung 4): auf allen
  // interaktiven Elementen — Button, Switch, Radio.Group — ist es ENTFERNT; deren Höhe kommt
  // aus der Dichte-Staffel am `ConfigProvider`. Stehen bleiben die `Liste`-Angaben (dort ein
  // Abstandsmaß, keine Treffläche) und der eine `Spin` (eine Anzeige). Die anklickbaren
  // Einträge unter „Verortet" tragen `bedienzielStil`, die Ebenen-Zeilen `ebenenZeileStil`.
  //
  // Die Prop-Schreibweise steht hier bewusst NICHT ausgeschrieben: Gate 4 zählt ihr Literal
  // repo-weit, und ein erklärender Kommentar darf das Gate, das er erklärt, nicht füllen.
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
            Klick auf die Karte setzt die Koordinate. (Abbrechen beendet.)
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
        {/* Die Weiche ist das Paar aus D3 und D5 (LFH-331 · B3) — dasselbe wie in
            `PersonenPage`/`SchaedenPage`/`TierePage`, und der `anzahl === 0`-Wächter ist
            der tragende Teil daran: **ein Fehler ersetzt Inhalt nur, wenn es keinen
            Inhalt gibt.** Stehen noch Zeilen im Zwischenspeicher, wird der Fehler zum Banner
            DARÜBER (`SeitenStandVeraltet`), und die Liste — die einzige Bedienung zum
            Verorten — bleibt bedienbar. „Alles verortet" ist eine Erfolgsaussage und darf
            nicht stehen, solange unklar ist, ob überhaupt etwas geladen wurde. */}
        {sektionFehler.nichtVerortet && nichtVerortet.length === 0 ? (
          <FehlerSlot fehler={sektionFehler.nichtVerortet} />
        ) : nichtVerortet.length === 0 ? (
          <SeitenLeer titel="Alles verortet" />
        ) : (
          <>
            <VeraltetSlot fehler={sektionFehler.nichtVerortet} />
            <Liste
              size="small"
              dataSource={nichtVerortet}
              rowKey={(o) => `${o.typ}-${o.id}`}
              renderItem={(o) => {
                const aktiv = platzierungZiel?.typ === o.typ && platzierungZiel?.id === o.id;
                let action: React.ReactNode = null;
                // Zeilenaktionen sind SEKUNDÄR (umrandet): n Zeilen mit je einem gefüllten
                // Knopf wären n Primäraktionen nebeneinander — „genau eine Primäraktion" gilt
                // auch in der Leiste. Gefüllt bleibt nur, was einen laufenden Modus abschließt.
                if (darfSchreiben) {
                  if (o.typ === 'abschnitt') {
                    action = (
                      <Button onClick={() => props.onAbschnittZeichnenStart(o.id)}>
                        Fläche zeichnen
                      </Button>
                    );
                  } else if (aktiv) {
                    action = <Button onClick={props.onPlatzierenAbbrechen}>Abbrechen</Button>;
                  } else {
                    // o.typ ist hier auf die Punkt-Typen verengt (abschnitt oben behandelt).
                    const punktTyp = o.typ;
                    action = (
                      <Button onClick={() => props.onPlatzierenStart({ typ: punktTyp, id: o.id })}>
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
              <Button onClick={props.onPlatzierenAbbrechen}>Abbrechen</Button>
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
        {/* Kein eigener Fehlerkasten (Begründung an `SidebarSektionFehler`), aber die Zahlen
            dürfen nicht lügen: „UHS (0)" ist eine Aussage über die Lage, und im Fehlerfall
            hat sie niemand geprüft. Ein Template-Literal, damit der Text EIN Knoten bleibt. */}
        <Typography.Text type="secondary">{`UHS (${zaehler(uhsVerortet.length)})`}</Typography.Text>
        <Liste
          size="small"
          dataSource={uhsVerortet}
          rowKey={(m) => m.schluessel}
          renderItem={(m) => (
            <ListenEintrag
              style={bedienzielStil(token)}
              onClick={() => props.onMarkerWaehlen(m.schluessel)}
            >
              {m.label}
            </ListenEintrag>
          )}
        />
        <Typography.Text type="secondary">{`Schäden (${zaehler(schadenVerortet.length)})`}</Typography.Text>
        <Liste
          size="small"
          dataSource={schadenVerortet}
          rowKey={(m) => m.schluessel}
          renderItem={(m) => (
            <ListenEintrag
              style={bedienzielStil(token)}
              onClick={() => props.onMarkerWaehlen(m.schluessel)}
            >
              {m.label}
            </ListenEintrag>
          )}
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
                        {/* `farbe` ist ein PERSISTIERTER Datenwert: er wandert über
                            `onZoneZeichnenStart` in die Zone und damit in die Datenbank. Er
                            darf deshalb NICHT auf ein Laufzeit-Token zeigen — ein
                            Themenwechsel würde sonst gespeicherte Zonen nachträglich
                            uminterpretieren. Das Literal bleibt bewusst (LFH-328/T14). */}
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
                    {/* Serienmodus (LFH-332/M76). Der Schalter steht hier und nicht im Picker,
                        weil er den LAUFENDEN Modus beschreibt und mitten in einer Serie
                        umgelegt werden können muss. */}
                    <Space>
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
                    {/* Ein Knopf, zwei Wahrheiten: solange nichts gesetzt ist, verwirft
                        Beenden nur die Absicht („Abbrechen"). Ab dem ersten gesetzten Zeichen
                        wäre „Abbrechen" eine Lüge — das Gespeicherte bleibt. */}
                    {props.zeichenSerieAnzahl > 0 ? (
                      <Button type="primary" onClick={props.onZeichenPlatzierenFertig}>
                        Fertig
                      </Button>
                    ) : (
                      <Button onClick={props.onZeichenPlatzierenAbbrechen}>Abbrechen</Button>
                    )}
                  </Space>
                ) : zeichenPickerOffen ? (
                  <Space orientation="vertical" style={{ width: '100%' }}>
                    <FreiesZeichenPicker wert={zeichenEntwurf} onChange={setZeichenEntwurf} />
                    <Space>
                      <Button
                        type="primary"
                        onClick={() => {
                          props.onZeichenPlatzierenStart(zeichenEntwurf);
                          setZeichenPickerOffen(false);
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
            {/* Seit LFH-320 schreibt der Button in die AKTIVE Ansicht, nicht in eine
                einsatzweite Einstellung (LFH-325). */}
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
              <Space key={key} style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space align="start">
                  <Switch checked={sichtbar} onChange={(v) => props.onFachebeneToggle(key, v)} />
                  <span style={{ color: def.farbe }} aria-hidden="true">
                    ■
                  </span>
                  {/* Der Geltungsbereich steht als ZEILE, nicht als Tooltip (LFH-80): auf
                      einem Führungs-Tablet gibt es kein Hovern. */}
                  <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
                    <span>{def.label}</span>
                    {def.geltung && (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {def.geltung}
                      </Typography.Text>
                    )}
                  </span>
                </Space>
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
                    {/* `nowrap`: sonst bricht die Marke mitten im Wort (LFH-83). */}
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
              </Space>
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
          {/* Der Slot ist ein BANNER über der Liste, kein Ersatz für sie: die Bild-Overlays
              liegen weiter sichtbar auf der KARTE — verschwänden nur ihre Bedienelemente,
              liesse sich ein Bild nicht mehr abschalten. `SeitenFehler` statt
              `SeitenStandVeraltet`, weil dieser Slot eine `ursache` führt. Der Upload darunter
              hängt an einer eigenen Route und bleibt bedienbar. */}
          <FehlerSlot fehler={sektionFehler.bilder} />
          {props.bilder.map((b) => {
            const imPlatzieren = props.bildPlatzierenId === b.id;
            return (
              <div
                key={b.id}
                style={{ borderBottom: `1px solid ${rollen.flaeche3}`, paddingBottom: 6 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Switch
                    checked={b.sichtbar}
                    aria-label={b.name}
                    onChange={(v) => props.onBildToggle(b.id, v)}
                    style={{ flexShrink: 0 }}
                  />
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
                  {/* Drei Aktionen an einer Zeile werden gebündelt (LFH-365 · B5e). OHNE
                      Schreibrecht bleibt genau eine — dann steht der Zentrieren-Knopf direkt
                      da, ein Menü wäre ein Umweg. Beide Fälle sind als Paar getestet. */}
                  <div style={{ flexShrink: 0 }}>
                    {darfSchreiben ? (
                      <Dropdown
                        trigger={['click']}
                        // `autoFocus`: ohne ihn klebt der Fokus am Auslöser (Befund an
                        // `components/Datensicht.tsx`). In jsdom nicht prüfbar.
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
                             * Die Trennung zwischen destruktiver und harmloser Aktion (AK2): im
                             * Menü ist sie der Trenner. Er trennt VISUELL; sein Weissraum
                             * skaliert nicht mit der Dichte (antd rechnet ihn aus `lineWidth`),
                             * was mitzieht, sind die Zeilenhöhen des Menüs.
                             */
                            { type: 'divider' as const },
                            {
                              key: 'loeschen',
                              icon: <DeleteOutlined />,
                              label: 'Bild entfernen …',
                              danger: true,
                            },
                          ],
                          // Zuordnung am MENÜ, nicht je Eintrag: ein Riegel hat dann einen Ort.
                          onClick: ({ key }) => {
                            if (key === 'zentrieren') props.onBildZentrieren(b.id);
                            else if (key === 'platzieren') {
                              if (imPlatzieren) props.onBildPlatzierenFertig();
                              else props.onBildPlatzieren(b.id);
                            } else if (key === 'loeschen') setLoeschBildId(b.id);
                          },
                        }}
                      >
                        {/* Der Name trägt die Bild-Kennung (LFH-364). Kein `size`. */}
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
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Auf der Karte: Ecken = Größe (Seitenverhältnis), Kanten = frei strecken, ↻ =
                      drehen, Mitte = verschieben. Oder Mittelpunkt numerisch:
                    </Typography.Text>
                    <div style={{ marginTop: 6 }}>
                      <KoordinatenEingabe
                        value={bildMitte ?? props.bildPlatzierZentrum}
                        onChange={setBildMitte}
                        einsatzId={props.einsatzId}
                      />
                    </div>
                    <Space style={{ marginTop: 6, width: '100%', justifyContent: 'space-between' }}>
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
                      <Button type="primary" onClick={props.onBildPlatzierenFertig}>
                        Fertig
                      </Button>
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

      {/*
        Löschbestätigung als EIN Dialog für die ganze Bildliste (LFH-366 · B5f). Kein
        `Popconfirm`: der bräuchte im Menü-Label ein `stopPropagation`. `okButtonProps={{
        danger: true }}` ist AK2 — sonst bestätigt man das Entfernen mit einem blauen Knopf.
        Er steht AUSSERHALB der `map` und des Paneels: n Dialoge im Baum trügen n gleichnamige
        Knöpfe, und ein zugeklapptes Paneel darf eine offene Rückfrage nicht abhängen.
      */}
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
                style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
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
