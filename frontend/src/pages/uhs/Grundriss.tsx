import {
  IconAbmelden,
  IconAuto,
  IconHakenKreis,
  IconKreispfeile,
  IconMuelleimer,
  IconPerson,
  IconPersonPlus,
  IconPfeilZurueckGebogen,
  IconSchloss,
  IconSchraubenschluessel,
} from '../../icons';
import {
  App,
  Button,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Space,
  Tabs,
  Tooltip,
  Typography,
  theme,
  type MenuProps,
} from 'antd';
import { Select } from '../../components/Select';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDndContext,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import {
  aenderePersonBelegung,
  aktualisierePlatz,
  legePlaetzeAn,
  setzePlatzVerfuegbarkeit,
  stornierePlatz,
} from '../../api/einsatzUhs';
import { erfasseVerbleib, listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import type {
  Person,
  PlatzTyp,
  UhsDetail,
  UhsPlatz,
  VerbleibArt,
  Verfuegbarkeit,
} from '../../api/types';
import { fehlerText } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import PersonDetailDrawer from '../../personen/PersonDetailDrawer';
import { ErfassungsModal } from '../../components/Erfassung';
import StatusTag from '../../components/StatusTag';
import { Augenbraue, Paneel, StatusChip, monoStil, useRollen } from '../../components/instrument';
import { rollenFarbe, verfuegbarkeit as verfuegbarkeitVertrag } from '../../theme/statusFarben';
import { useViewport } from '../../components/useViewport';
import { useFehlerMeldung } from '../../components/useFehlerMeldung';
import { ZugPointerSensor } from '../../components/zugPointerSensor';

// Feste Karten-Höhe: unter dem Raster-Zeilenabstand (`raster_position` SCHRITT_Y=120 im Backend),
// damit absolut platzierte Karten nicht überlappen, und groß genug für den Worst Case (2-zeiliger
// Titel + Tag + Belegung + Aktionszeile).
export const PLATZ_KARTE_HOEHE = 116;

// Feste Karten-Breite — dieselbe Bindung an der anderen Achse: SCHRITT_X = 160, die 20 px je Seite
// sind der Spaltengraben.
export const PLATZ_KARTE_BREITE = 140;
const PLATZ_KARTE_RAND = 2;
const PLATZ_KARTE_POLSTER = 6;

/** Innenbreite der Aktionszeile: 140 − 2×2 Rand − 2×6 Polsterung = 124 px. */
const AKTIONSZEILE_BREITE = PLATZ_KARTE_BREITE - 2 * PLATZ_KARTE_RAND - 2 * PLATZ_KARTE_POLSTER;

/** Höhe des Aktionsstreifens im 100-px-Innenraum (Rechnung an `platzBedienform`). */
const AKTIONSZEILE_HOEHE = 24;

/**
 * Überlaufregel des Kartenmenüs: umklappen und ins Fenster schieben. antds Typ `AdjustOverflow`
 * kennt nur `adjustX`/`adjustY`, zur Laufzeit reicht antd das Objekt aber an rc-trigger durch, wo
 * `shiftY` wirkt (ohne ist der e2e-Test „alle Menüeinträge liegen im Fenster" rot). Als Konstante,
 * weil die Excess-Property-Prüfung am Literal anschlägt.
 */
const MENUE_UEBERLAUF: { adjustY: 1; shiftY: true } = { adjustY: 1, shiftY: true };

/** Voll ausgebaute Zeile: Transport, zurückweisen, „als frei", Platzaktionen. */
const AKTIONEN_MAX = 4;

/**
 * Bedienform der Platzkarte: Knopfzeile oder die ganze Karte als ein Ziel.
 *
 * Die Karte hat fest 124 × 100 px Innenraum (Karte 140 × 116, weil `raster_position` im Backend die
 * Felder vergibt), die Aktionszeile davon einen 24-px-Streifen. Eine Zeile gibt es nur, wenn beides
 * passt:
 * - Höhe: die kleinen Knöpfe (`controlHeightSM`, 24 / 48 / 72) stehen im 24-px-Streifen.
 * - Breite: vier icon-only-Knöpfe plus drei Lücken von vollem `marginSM` passen in 124 px. Die
 *   Lücke ist ungedeckelt, weil „zurückweisen" als `danger`-Knopf mindestens `marginSM` Abstand
 *   braucht. Das gilt nur in `kompakt` (4 × 24 + 3 × 7 = 117 ≤ 124, 24 px ist dort der
 *   Gate-3-Boden). Ab `komfortabel` reißen Höhe und Breite; dort wird die ganze Karte (140 × 116 ≥
 *   72) das eine Bedienziel und öffnet das Aktionsmenü. Zwei 72-px-Ziele passen in keiner Achse.
 *
 * Rein und exportiert: jsdom rechnet kein Layout, und `test/utils.tsx` montiert ein
 * `ConfigProvider` ohne unser Theme. Testfalle: dort ist `marginSM` 12, also 4 × 24 + 3 × 12 = 132
 * > 124 und damit die Kartenform — wer in Vitest die Knopfzeile erwartet, rendert im App-Theme
 * `kompakt` (`antdToken(farbenDunkel, 'kompakt')`, Muster in `Grundriss.test.tsx`).
 */
type PlatzBedienform = { form: 'zeile'; abstand: number } | { form: 'karte' };
export function platzBedienform(token: {
  controlHeightSM: number;
  marginSM: number;
}): PlatzBedienform {
  const passtHoehe = token.controlHeightSM <= AKTIONSZEILE_HOEHE;
  const breite = AKTIONEN_MAX * token.controlHeightSM + (AKTIONEN_MAX - 1) * token.marginSM;
  const passtBreite = breite <= AKTIONSZEILE_BREITE;
  return passtHoehe && passtBreite ? { form: 'zeile', abstand: token.marginSM } : { form: 'karte' };
}

/**
 * Lage einer Platzkarte, aus der ihr Menü folgt. Setzt Schreibrecht voraus: ohne gibt es in keiner
 * Form ein Menü.
 */
interface PlatzMenueLage {
  form: PlatzBedienform['form'];
  belegt: boolean;
  /** Unbelegt, mit Schreibrecht, nicht im Bearbeiten-Modus — die Bedingung des Wurzelklicks. */
  zuweisbar: boolean;
  /** Der Rückweg existiert (belegt, mit Schreibrecht; s. `onZurueckInWartebereich`). */
  wartebereich: boolean;
  bearbeitbar: boolean;
  /** Eine Belegung läuft: Bewegungen der Person sperren, nichts entfernen. */
  belegungLaeuft: boolean;
}

const VERFUEGBARKEIT_EINTRAEGE = [
  { key: 'frei', label: 'als frei markieren', icon: <IconHakenKreis /> },
  { key: 'defekt', label: 'als defekt markieren', icon: <IconSchraubenschluessel /> },
  { key: 'aufbereitung', label: 'als in Aufbereitung markieren', icon: <IconKreispfeile /> },
  { key: 'gesperrt', label: 'als gesperrt markieren', icon: <IconSchloss /> },
];

/**
 * Einträge des Platzmenüs für beide Bedienformen — eine Ableitung, damit Rechte und Sperren nicht
 * auseinanderlaufen.
 *
 * Zeilenform: das „…"-Menü; Patientenaktionen und „als frei" sind Knöpfe der Zeile. „Patient
 * zuweisen" steht trotzdem im Menü: der Wurzelklick ist die Berührungsfläche, das Menü der
 * Tastaturweg.
 *
 * Kartenform: die Karte ist das einzige Ziel, also wandert alles hinein — Primäraktion oben
 * (unbelegt „Patient zuweisen", belegt „Verbleib / Entlassung erfassen"), „Person öffnen", der
 * Rückweg, die Verfügbarkeiten, und die Gefahr hinter einem Trenner (der ersetzt den Abstand, den
 * „zurückweisen" als Knopf brauchte).
 *
 * Die Icons bringen ihr englisches `aria-label` in den zugänglichen Namen mit; Tests greifen per
 * Teilstring.
 */
export function platzMenueEintraege(lage: PlatzMenueLage): NonNullable<MenuProps['items']> {
  const { form, belegt, zuweisbar, wartebereich, bearbeitbar, belegungLaeuft } = lage;
  const karte = form === 'karte';
  const trenner = { type: 'divider' as const };
  const zuweisen = zuweisbar
    ? [
        {
          key: 'zuweisen',
          label: 'Patient zuweisen',
          icon: <IconPersonPlus />,
          disabled: belegungLaeuft,
        },
      ]
    : [];
  const verbleib =
    karte && belegt
      ? [
          {
            key: 'verbleib',
            label: 'Verbleib / Entlassung erfassen',
            icon: <IconAuto />,
            disabled: belegungLaeuft,
          },
        ]
      : [];
  const person =
    karte && belegt ? [{ key: 'person', label: 'Person öffnen', icon: <IconPerson /> }] : [];
  // Rückweg in den Wartebereich: der Drag auf `drop-inbox` ist unter `lg` strukturell weg (anderer
  // Reiter, `destroyOnHidden`).
  const rueckweg = wartebereich
    ? [
        {
          key: 'wartebereich',
          label: 'Zurück in den Wartebereich',
          icon: <IconPfeilZurueckGebogen />,
          disabled: belegungLaeuft,
        },
      ]
    : [];
  const gefahr = [
    ...(karte && belegt
      ? [
          {
            key: 'zurueckweisen',
            label: 'zurückweisen',
            icon: <IconAbmelden />,
            danger: true,
            disabled: belegungLaeuft,
          },
        ]
      : []),
    ...(bearbeitbar
      ? [{ key: 'storno', label: 'Platz löschen', icon: <IconMuelleimer />, danger: true }]
      : []),
  ];
  const kopf = [...zuweisen, ...verbleib, ...person, ...rueckweg];
  // Zeilenform: der Trenner steht nur hinter „zuweisen", der Rückweg geht bündig in die
  // Verfügbarkeiten über (von den Zeilen-Tests gepinnt).
  const kopfMitTrenner = karte
    ? kopf.length > 0
      ? [...kopf, trenner]
      : []
    : [...zuweisen, ...(zuweisen.length > 0 ? [trenner] : []), ...rueckweg];
  return [
    ...kopfMitTrenner,
    ...VERFUEGBARKEIT_EINTRAEGE,
    ...(gefahr.length > 0 ? [trenner, ...gefahr] : []),
  ];
}

// Die vier Aktionsknöpfe der Platzkarte tragen die kleine Größe und stehen deshalb in der
// Schuldliste von `components/dichte.guard.test.ts`. Das ist keine Unterschreitung: gerendert
// werden sie nur in `kompakt`, wo 24 px der Boden sind (siehe `platzBedienform`); in den
// Berührungsstufen trägt das Kartenmenü ihre Aktionen. Die Karte darf nicht wachsen, weil SCHRITT_Y
// = 120 im Backend sitzt.
//
// Prop-Literal und Token-Name stehen bewusst nicht ausgeschrieben: Gate 4 zählt beide repo-weit.

function personLabel(person: Person): string {
  const nr = registrierAnzeige(person.registrier_nr);
  return person.name ? `${nr} · ${person.name}` : `${nr} · unbekannt`;
}

interface PersonenkartenProps {
  person: Person | undefined;
  kompakt?: boolean;
  /**
   * Test-Marke an der gerenderten Personenmarke, nur vom DragOverlay gesetzt: ohne sie ist „der
   * Drag läuft wirklich" in Playwright nicht behauptbar.
   */
  testId?: string;
}
function Personenkarte({ person, kompakt, testId }: PersonenkartenProps) {
  const { token, rollen } = useRollen();
  if (!person) return null;
  /*
   * Personenmarke statt antd-`Tag`: Radius 0, Haarlinie, Grund `flaeche2`, Registriernummer Mono.
   * Die Höhe ist dichteunabhängig (wie antds Tag: `fontSizeSM` × `lineHeightSM` + 2 px Rahmen),
   * weil die belegte Platzkarte diesen Streifen mit 24 px einplant. Kein Bedienziel: Klick und Zug
   * trägt `PersonenkarteDrag`. `data-lfh="personenkarte"` ist die Marke der e2e-Specs.
   */
  const nr = registrierAnzeige(person.registrier_nr);
  const style: React.CSSProperties = {
    display: 'inline-block',
    maxWidth: kompakt ? 124 : '100%',
    margin: 2,
    paddingInline: token.paddingXS,
    border: `1px solid ${rollen.linie}`,
    borderRadius: 0,
    background: rollen.flaeche2,
    color: rollen.text2,
    fontSize: token.fontSizeSM,
    lineHeight: `${Math.round(token.fontSizeSM * token.lineHeightSM)}px`,
    whiteSpace: 'nowrap',
    // `kompakt` (auf der Platzkarte): einzeilig mit Ellipsis, damit die absolut positionierte Karte
    // unabhängig von der Namenslänge ihre Höhe hält.
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    verticalAlign: 'top',
  };
  return (
    <span
      data-lfh="personenkarte"
      data-testid={testId}
      style={style}
      title={kompakt ? personLabel(person) : undefined}
    >
      <span style={monoStil(token.fontSizeSM)}>{nr}</span>
      {/* `||` wie in `personLabel`: ein leerer Name ist „unbekannt“, nicht „R-007 · “. */}
      {` · ${person.name || 'unbekannt'}`}
    </span>
  );
}

function PersonenkarteDrag({
  person,
  disabled,
  kompakt,
  onOeffnen,
  keinZiel,
}: {
  person: Person;
  disabled: boolean;
  kompakt?: boolean;
  onOeffnen?: (personId: number) => void;
  /**
   * Die Marke liegt in einem Auslöser, der selbst das Ziel ist (Kartenform). `useDraggable` setzt
   * `role="button"` und `tabIndex` auch bei `disabled` — ohne diese Rücknahme stünde ein
   * fokussierbarer Knopf im Knopf (axe `nested-interactive`), und Enter/Leertaste startete einen
   * Tastatur-Zug. Die Zeiger-Listener bleiben; den Tastaturweg zurück trägt der Menüeintrag „Zurück
   * in den Wartebereich".
   */
  keinZiel?: boolean;
}) {
  // Kein Inline-`transform`: die gezogene Karte rendert als DragOverlay. Ein transformierter
  // Originalknoten vergrößerte die Scroll-Region seiner overflow:auto-Spalte.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `person-${person.id}`,
    data: { kind: 'person', personId: person.id },
    disabled,
  });
  // Ein Klick ohne 5-px-Bewegung (PointerSensor) öffnet den Detail-Drawer; ein echter Drag
  // unterdrückt den nativen Click.
  const style: React.CSSProperties = {
    cursor: disabled ? 'pointer' : 'grab',
    opacity: isDragging ? 0.4 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      {...(keinZiel
        ? {
            role: undefined,
            tabIndex: -1,
            'aria-disabled': undefined,
            'aria-pressed': undefined,
            'aria-roledescription': undefined,
            'aria-describedby': undefined,
          }
        : {})}
      style={style}
      onClick={onOeffnen ? () => onOeffnen(person.id) : undefined}
    >
      <Personenkarte person={person} kompakt={kompakt} />
    </div>
  );
}

interface PlatzKarteProps {
  platz: UhsPlatz;
  belegtVon: Person | undefined;
  schreibgeschuetzt: boolean;
  /**
   * Eine Belegungs-Mutation läuft. Bewusst getrennt von `schreibgeschuetzt`: das ist ein
   * dauerhafter Rechtezustand und nimmt Bedienelemente aus dem Baum; dieser hier ist transient und
   * darf das nicht — ein Portal-Overlay stirbt mit seinem Auslöser, ein offenes Platzmenü ginge
   * verloren (LFH-457). Gesperrt werden nur die Wege, die eine zweite Belegung anstoßen würden.
   */
  belegungLaeuft: boolean;
  bearbeitbar: boolean;
  onVerfuegbarkeit: (v: Verfuegbarkeit) => void;
  onAustritt: () => void;
  onTransport: () => void;
  onStorno: () => void;
  onOeffnen: (personId: number) => void;
  onZuweisen: () => void;
  /** Nur gesetzt, wenn der Platz belegt ist — sonst gibt es nichts zurückzustellen. */
  onZurueckInWartebereich?: () => void;
}

function PlatzKarte({
  platz,
  belegtVon,
  schreibgeschuetzt,
  belegungLaeuft,
  bearbeitbar,
  onVerfuegbarkeit,
  onAustritt,
  onTransport,
  onStorno,
  onOeffnen,
  onZuweisen,
  onZurueckInWartebereich,
}: PlatzKarteProps) {
  // Die Platzkarte ist Drop-Target (Personen zuweisen) und — nur im Bearbeiten-Modus — Drag-Source
  // (Layout verschieben).
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
  } = useDraggable({
    id: `platz-${platz.id}`,
    data: { kind: 'platz', platzId: platz.id },
    disabled: !bearbeitbar,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-platz-${platz.id}`,
    data: { kind: 'platz', platzId: platz.id, uhsId: platz.uhs_id },
  });
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const bedienform = platzBedienform(token);
  const karte = bedienform.form === 'karte';
  // Kontrolliert, weil drei Wege öffnen (Klick, Enter/Leertaste über `aufTaste`) und die Menüwahl
  // schließt. Gemerkt wird, in welchem Belegungszustand das Menü geöffnet wurde: ändert ein
  // Live-Update die Belegung, bauten sich die Einträge unter dem Finger um — das Menü ist dann zu,
  // abgeleitet statt per Effekt. Der Kartenknopf trägt ein `aria-label`, seine Kinder sind damit
  // präsentational; Belegung und Verfügbarkeit hängen deshalb als Beschreibung daran.
  const beschreibungsId = useId();
  const belegungsSchluessel = belegtVon ? `belegt:${belegtVon.id}` : 'frei';
  const [offenBei, setOffenBei] = useState<string | null>(null);
  // Den gemerkten Zustand beim Wechsel verwerfen, nicht nur vergleichen: sonst öffnete ein
  // Rücksprung (Rollback nach 409) das Menü von selbst wieder. Zurückgesetzt während des Renderns.
  if (offenBei !== null && offenBei !== belegungsSchluessel) setOffenBei(null);
  const menueOffen = offenBei === belegungsSchluessel;
  const setMenueOffen = (offen: boolean) => setOffenBei(offen ? belegungsSchluessel : null);
  // Läuft ein Zug, gehört die Tastatur dnd-kit: es beendet den Zug an `document`, der Handler an
  // der Karte läuft vorher und öffnete sonst zusätzlich das Menü.
  const zugLaeuft = useDndContext().active !== null;
  const setRef = (n: HTMLDivElement | null) => {
    setDragRef(n);
    setDropRef(n);
  };
  // Klick-Ersatzweg für den Drag: die ganze Karte nimmt einen Patienten an. Nur unbelegt (ein
  // belegter Platz trägt eigene Klickziele) und nicht im Bearbeiten-Modus (dort gehört der Klick
  // dem Layout-Zug). Die Verfügbarkeit wird bewusst nicht geprüft — das Drop-Target tut es auch
  // nicht, und ein Ersatzweg darf nicht strenger sein als die Geste.
  const zuweisbar = !schreibgeschuetzt && !bearbeitbar && !belegtVon;
  // Während einer Belegung sind „Patient zuweisen" und „Zurück in den Wartebereich" gesperrt, nicht
  // entfernt: ein Eintrag, der aus dem offenen Menü verschwände, verschöbe die Liste unter dem
  // Cursor (bei `autoFocus` fiele der Fokus auf `<body>`). Der Wurzelklick hat keinen sichtbaren
  // Sperrzustand; er ruht.
  const zuweisenGesperrt = belegungLaeuft;
  const style: React.CSSProperties = {
    position: 'absolute',
    left: platz.pos_x ?? 10,
    top: platz.pos_y ?? 10,
    width: PLATZ_KARTE_BREITE,
    // Feste Höhe + overflow:hidden: die Kartengröße ist invariant gegen Belegung, Titelumbruch und
    // Tag-Anzahl, alle Karten bleiben unter dem Raster-Zeilenabstand (120 px).
    height: PLATZ_KARTE_HOEHE,
    overflow: 'hidden',
    boxSizing: 'border-box',
    cursor: bearbeitbar ? 'grab' : zuweisbar || (karte && belegtVon) ? 'pointer' : 'default',
    // Rand und Polsterung aus den Konstanten: `AKTIONSZEILE_BREITE` rechnet mit genau diesen
    // Werten.
    border: `${PLATZ_KARTE_RAND}px solid ${rollenFarbe(verfuegbarkeitVertrag[platz.verfuegbarkeit].rolle, token)}`,
    // Belegt: Fläche `bedienFlaeche` + „belegt"-Tag; „frei" und „belegt" schließen sich aus, andere
    // Verfügbarkeiten bleiben sichtbar. Nur Farbe und Ecke kommen aus dem Neuentwurf — Höhe, Rand
    // und Polsterung bleiben an die Konstanten gebunden.
    background: isOver ? token.colorPrimaryBg : belegtVon ? rollen.bedienFlaeche : rollen.flaeche,
    padding: PLATZ_KARTE_POLSTER,
    borderRadius: 0,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  // Menüinhalt aus einer Ableitung für beide Formen (`platzMenueEintraege`). Verfügbarkeit ändern
  // steht auch außerhalb des Bearbeiten-Modus im Menü, „Platz löschen" nur darin.
  const menueEintraege = platzMenueEintraege({
    form: bedienform.form,
    belegt: Boolean(belegtVon),
    zuweisbar,
    wartebereich: Boolean(onZurueckInWartebereich),
    bearbeitbar,
    belegungLaeuft,
  });
  const waehle = (key: string) => {
    if (key === 'zuweisen') onZuweisen();
    else if (key === 'verbleib') onTransport();
    else if (key === 'person') {
      if (belegtVon) onOeffnen(belegtVon.id);
    } else if (key === 'wartebereich') onZurueckInWartebereich?.();
    else if (key === 'zurueckweisen') onAustritt();
    else if (key === 'storno') onStorno();
    else onVerfuegbarkeit(key as Verfuegbarkeit);
  };
  const menu = {
    items: menueEintraege,
    autoFocus: true,
    // Zeilenform: das Dropdown rendert im Portal, sein Klick steigt aber im Komponentenbaum auf und
    // erreichte den Wurzel-onClick der Karte. Ein `domEvent.stopPropagation()` hier kommt zu spät;
    // wirksam ist der `click`-Riegel an der Aktionszeile unten. Wer den Auslöser von dort
    // wegbewegt, nimmt den Riegel mit.
    onClick: ({ key }: { key: string }) => {
      setMenueOffen(false);
      waehle(key);
    },
  };
  // „frei" und „belegt" widersprechen sich; echte Sonderzustände bleiben auch belegt sichtbar.
  const zeigeVerfTag = !(belegtVon && platz.verfuegbarkeit === 'frei');
  // dnd-kit-Drag-Props nur im Bearbeiten-Modus spreizen: sonst setzt `useDraggable` (disabled)
  // `role="button"` + `aria-disabled="true"`, und der ganze Teilbaum gilt als deaktiviert.
  const dragProps = bearbeitbar ? { ...attributes, ...listeners } : {};

  // ── Kartenform: die ganze Karte ist das eine Ziel ── Ohne Schreibrecht gibt es kein Menü: belegt
  // öffnet der Tipp direkt die Person (ein Menü mit einem Eintrag wäre ein Umweg), unbelegt ist die
  // Karte kein Ziel.
  const kartenMenue = karte && !schreibgeschuetzt;
  const kartenPerson = karte && schreibgeschuetzt && belegtVon ? belegtVon : undefined;
  const kartenAktion = kartenMenue
    ? () => setMenueOffen(true)
    : kartenPerson
      ? () => onOeffnen(kartenPerson.id)
      : undefined;
  // Enter öffnet immer. Die Leertaste nur außerhalb des Bearbeiten-Modus: dort startet sie den
  // Layout-Zug (KeyboardSensor). Enter wird deshalb nicht an dnd-kit durchgereicht, sonst liefen
  // Menü und Zug gleichzeitig los.
  const aufTaste = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const oeffnet = e.key === 'Enter' || (e.key === ' ' && !bearbeitbar);
    if (kartenAktion && oeffnet && !zugLaeuft && e.target === e.currentTarget) {
      e.preventDefault();
      kartenAktion();
      return;
    }
    listeners?.onKeyDown?.(e);
  };
  const kartenZiel = kartenAktion
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': kartenMenue
          ? `Aktionen zu ${platz.bezeichnung}`
          : `${platz.bezeichnung}: Person öffnen`,
        ...(kartenMenue ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menueOffen } : {}),
        'aria-describedby': `${beschreibungsId}-status ${beschreibungsId}-belegung`,
        onKeyDown: aufTaste,
        // Im Menü-Fall öffnet der Dropdown-Auslöser selbst; ein eigener onClick riefe dasselbe
        // zweimal.
        onClick: kartenMenue ? undefined : kartenAktion,
      }
    : {};

  const knoten = (
    <div
      ref={setRef}
      data-testid="platz-karte"
      style={style}
      {...dragProps}
      {...(karte
        ? kartenZiel
        : { onClick: zuweisbar && !zuweisenGesperrt ? onZuweisen : undefined })}
    >
      {/* Titel: max. 2 Zeilen, dann Ellipsis. Feste maxHeight, damit ein Umbruch die Karte nicht
          vergrößert. */}
      <Typography.Text
        strong
        title={platz.bezeichnung}
        style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden',
          lineHeight: '15px',
          fontSize: 13,
          maxHeight: 30,
        }}
      >
        {platz.bezeichnung}
      </Typography.Text>
      {/* Status-Tags: eine Zeile, kein Umbruch (feste Höhe). */}
      <div
        id={`${beschreibungsId}-status`}
        style={{ height: 24, overflow: 'hidden', whiteSpace: 'nowrap' }}
      >
        {zeigeVerfTag && <StatusTag darstellung={verfuegbarkeitVertrag[platz.verfuegbarkeit]} />}
        {belegtVon && <StatusChip ton="bedien" wort="belegt" />}
      </div>
      {/* Belegung: feste Höhe, auch wenn leer. Die belegte Person ist ziehbar (→ Wartebereich
          oder Transport), im Bearbeiten-Modus nicht. Unter `lg` ist der Rückweg per Drag
          unmöglich (anderer Reiter), der Menüeintrag „Zurück in den Wartebereich" trägt ihn. In
          der Kartenform ist die Marke kein eigenes Klickziel: ihr Klick steigt zur Karte auf und
          öffnet das Menü; der Zug bleibt. */}
      <div id={`${beschreibungsId}-belegung`} style={{ height: 24, overflow: 'hidden' }}>
        {belegtVon && (
          <PersonenkarteDrag
            person={belegtVon}
            disabled={schreibgeschuetzt || belegungLaeuft || bearbeitbar}
            kompakt
            onOeffnen={karte ? undefined : onOeffnen}
            keinZiel={karte}
          />
        )}
      </div>
      {/* Aktionszeile als direkte Icon-Buttons, nur in der Zeilenform (kompakt).

          Der `click`-Riegel der Karte sitzt hier, einmal am Container: die Knöpfe stoppen nur
          `pointerdown` (gegen den Drag-Start), das hält den `click` nicht auf. Der Container
          fängt die direkten Knöpfe und das Dropdown-Menü, dessen Portal-Klick hier durchläuft —
          sonst öffnete jeder Aktionsklick zusätzlich den Zuweisungsdialog. */}
      {bedienform.form === 'zeile' && (
        <div
          style={{ display: 'flex', gap: bedienform.abstand, height: 24, alignItems: 'center' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Gesperrt, nicht entfernt, solange eine Belegung läuft: das optimistische Update
              setzt die Person sofort auf diese Karte, beide Knöpfe gingen auf dieselbe Person
              und denselben Endpunkt wie die laufende Mutation. */}
          {belegtVon && !schreibgeschuetzt && (
            <>
              <Tooltip title="Verbleib / Entlassung erfassen">
                {/* stopPropagation: sonst startet eine kleine Mausbewegung beim Klick einen Drag. */}
                <Button
                  size="small"
                  aria-label="Verbleib / Entlassung erfassen"
                  icon={<IconAuto />}
                  disabled={belegungLaeuft}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onTransport}
                />
              </Tooltip>
              <Tooltip title="zurückweisen">
                <Button
                  size="small"
                  danger
                  aria-label="zurückweisen"
                  icon={<IconAbmelden />}
                  disabled={belegungLaeuft}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onAustritt}
                />
              </Tooltip>
            </>
          )}
          {/* Primäraktion direkt: ein nicht-freier Platz wird per Klick frei (z. B. Aufbereitung
              abgeschlossen), auch außerhalb des Bearbeiten-Modus. */}
          {!schreibgeschuetzt && platz.verfuegbarkeit !== 'frei' && (
            <Tooltip title="als frei markieren">
              <Button
                size="small"
                aria-label="als frei markieren"
                icon={<IconHakenKreis />}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onVerfuegbarkeit('frei')}
              />
            </Tooltip>
          )}
          {/* Weitere Platz-Aktionen (Verfügbarkeit, im Bearbeiten-Modus auch Löschen). */}
          {!schreibgeschuetzt && (
            <Dropdown menu={menu} trigger={['click']}>
              {/* Zeilenkennung im Namen: sonst lieferten n Plätze n gleichnamige Knöpfe. */}
              <Button
                size="small"
                type="text"
                aria-label={`Platzaktionen zu ${platz.bezeichnung}`}
                onPointerDown={(e) => e.stopPropagation()}
              >
                …
              </Button>
            </Dropdown>
          )}
        </div>
      )}
    </div>
  );
  if (!kartenMenue) return knoten;
  // Kartenform mit Menü: die Karte selbst ist der Auslöser, die Einträge messen `controlHeight`.
  // Ein belegter Platz trägt im Handschuh-Betrieb rund 600 px Menü — mehr, als über oder unter der
  // Karte Platz hat. `shiftY` schiebt es ins Fenster (es darf die Karte überdecken), die
  // Höhengrenze mit eigenem Scroll fängt noch niedrigere Fenster ab.
  return (
    <Dropdown
      menu={{
        ...menu,
        style: { maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto' },
      }}
      autoAdjustOverflow={MENUE_UEBERLAUF}
      // Fokus beim Öffnen auf den ersten Eintrag: erst `autoFocus` am Dropdown setzt ihn ins Menü,
      // `menu.autoFocus` allein ließ ihn auf der Karte.
      autoFocus
      trigger={['click']}
      open={menueOffen}
      onOpenChange={(offen) => setMenueOffen(offen)}
    >
      {knoten}
    </Dropdown>
  );
}

/** Schmale Personen-Liste als Spalten-Karte (links: Eingang/Wartebereich). */
function PersonenSpalte({
  titel,
  personen,
  schreibgeschuetzt,
  belegungLaeuft,
  droppableId,
  leerText,
  onOeffnen,
  onVerbleib,
}: {
  titel: string;
  personen: Person[];
  schreibgeschuetzt: boolean;
  /** Belegung läuft — sperrt den Drag, ohne Bedienelemente abzuhängen. */
  belegungLaeuft: boolean;
  droppableId?: string;
  leerText: string;
  onOeffnen: (personId: number) => void;
  /**
   * Verbleib erfassen aus der Liste heraus: `onDragEnd` nimmt `kind === 'transport'` von jeder
   * Person entgegen, `drop-transport` liegt unter `lg` aber in einem anderen Reiter, und die
   * direkten Verbleib-Knöpfe gibt es nur an belegten Plätzen. Ohne diesen Weg bekäme eine Person im
   * Wartebereich auf schmalem Schirm keinen Verbleib.
   *
   * Nicht gesetzt heißt „kein Schreibrecht" — der Auslöser wird dann gar nicht gerendert: ein
   * Verbleib ohne Schreibrecht ist keine Aktion, ein gesperrter Knopf kostete nur Platz.
   */
  onVerbleib?: (person: Person) => void;
}) {
  // Optionales Drop-Target (Wartebereich nimmt Personen ohne Platz auf).
  const drop = useDroppable({
    id: droppableId ?? `nodrop-${titel}`,
    data: { kind: 'inbox' },
    disabled: !droppableId,
  });
  const { token } = theme.useToken();
  return (
    <Paneel
      titel={titel}
      ueberschrift="h3"
      meta={personen.length}
      koerperPolster
      style={{ background: droppableId && drop.isOver ? token.colorPrimaryBg : undefined }}
    >
      <div ref={droppableId ? drop.setNodeRef : undefined} style={{ minHeight: 48 }}>
        {personen.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <PersonenkarteDrag
              person={p}
              disabled={schreibgeschuetzt || belegungLaeuft}
              onOeffnen={onOeffnen}
            />
            {onVerbleib && (
              <Tooltip title="Verbleib / Entlassung erfassen">
                {/* Geschwisterknoten der Drag-Karte, nicht ihr Kind: so hängt der Auslöser in
                    keinem klickbaren Vorfahren und braucht keinen
                    `stopPropagation`-/`onPointerDown`-Riegel. Ein antd-`Button` ohne `size` erbt
                    `controlHeight`. Der Name trägt die Zeilenkennung; das Icon steckt in einer
                    `aria-hidden`-Hülle, weil antd-Icons ein eigenes englisches `aria-label`
                    mitbringen. */}
                <Button
                  type="text"
                  aria-label={`Verbleib / Entlassung erfassen — ${personLabel(p)}`}
                  icon={
                    <span aria-hidden="true">
                      <IconAuto />
                    </span>
                  }
                  onClick={() => onVerbleib(p)}
                />
              </Tooltip>
            )}
          </div>
        ))}
        {personen.length === 0 && <Typography.Text type="secondary">{leerText}</Typography.Text>}
      </div>
    </Paneel>
  );
}

/**
 * Rechte Spalte: aus dieser UHS heraus auf Transport gebrachte Personen. Drop-Target: eine belegte
 * Person hierher ziehen öffnet den Transport-Abschluss-Screen.
 */
function TransportSpalte({
  personen,
  schreibgeschuetzt,
  belegungLaeuft,
  onOeffnen,
}: {
  personen: Person[];
  schreibgeschuetzt: boolean;
  belegungLaeuft: boolean;
  onOeffnen: (personId: number) => void;
}) {
  // Das Drop-Target ruht während einer Belegung — nicht wegen derselben Mutation (`kind:
  // 'transport'` führt auf `erfasseVerbleib`), sondern weil die Quelle dann ohnehin nicht ziehbar
  // ist und ein Ziel ohne Quelle eine Einladung ins Leere wäre.
  const gesperrt = schreibgeschuetzt || belegungLaeuft;
  const drop = useDroppable({
    id: 'drop-transport',
    data: { kind: 'transport' },
    disabled: gesperrt,
  });
  const { token } = theme.useToken();
  return (
    <Paneel
      titel="Auf Transport gebracht"
      ueberschrift="h3"
      meta={personen.length}
      koerperPolster
      style={{ background: !gesperrt && drop.isOver ? token.colorPrimaryBg : undefined }}
    >
      <div ref={gesperrt ? undefined : drop.setNodeRef} style={{ minHeight: 48 }}>
        {personen.map((p) => (
          <div key={p.id} style={{ marginBottom: 6 }}>
            {/* Ein echter Knopf statt eines klickbaren `Tag` (`<span onClick>` ohne Rolle und
                Tastaturweg). `type="link"` erbt die Steuerhöhe. */}
            <Button
              type="link"
              style={{ ...monoStil(12), paddingInline: 0 }}
              onClick={() => onOeffnen(p.id)}
            >
              {personLabel(p)}
            </Button>
            {p.aktueller_verbleib && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {p.aktueller_verbleib}
                </Typography.Text>
              </div>
            )}
          </div>
        ))}
        {personen.length === 0 && <Typography.Text type="secondary">keine</Typography.Text>}
      </div>
    </Paneel>
  );
}

/** Felder des Abschluss-Screens „Verbleib erfassen". */
type VerbleibWerte = { art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string };

/** Einziges Feld des Klick-Zuweisungswegs. */
type ZuweisenWerte = { personId: number };

export default function Grundriss({
  einsatzId,
  uhs,
  schreibgeschuetzt,
}: {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { rollen } = useRollen();
  // Zeiger-Sensor mit 5-px-Aktivierungsdistanz (sonst löst jeder Klick einen Drag aus),
  // KeyboardSensor für Tastatur und Tests. `ZugPointerSensor` statt `PointerSensor`: sonst ging
  // der erste Klick nach einem Drag unter Last verloren, etwa aufs Platzmenü (LFH-519).
  const sensors = useSensors(
    useSensor(ZugPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  // Ab `lg` nebeneinander, darunter drei Reiter (Details am Rahmen-`div` unten).
  const { abBreite } = useViewport();
  const breit = abBreite('lg');

  // Geplant → Plätze-Bearbeitung ist Primäraktion und standardmäßig an. Aktiv → Patienten zuweisen
  // steht vorn, Bearbeiten ist sekundär.
  const [platzBearbeitung, setPlatzBearbeitung] = useState(() => uhs.status === 'geplant');
  useEffect(() => {
    setPlatzBearbeitung(uhs.status === 'geplant');
  }, [uhs.status]);
  const platzEditAktiv = platzBearbeitung && !schreibgeschuetzt;

  // Die gezogene Person rendert im DragOverlay (Portal); Platz-Drags nutzen ihren Inline-Transform
  // innerhalb der Fläche.
  const [aktivePersonId, setAktivePersonId] = useState<number | null>(null);

  // Zielperson des „Verbleib erfassen"-Abschluss-Screens (null = geschlossen).
  const [transportPerson, setTransportPerson] = useState<Person | null>(null);
  const [transportForm] = Form.useForm<VerbleibWerte>();

  // Klick auf eine Patientenkarte öffnet den Detail-Drawer (nur ansehen).
  const [detailPersonId, setDetailPersonId] = useState<number | null>(null);

  // Zielplatz des Klick-Zuweisungswegs (null = geschlossen).
  const [zuweisenPlatz, setZuweisenPlatz] = useState<UhsPlatz | null>(null);
  const [zuweisenForm] = Form.useForm<ZuweisenWerte>();

  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const personen = personenQuery.data ?? [];
  const personenInUhs = personen.filter((p) => p.aktuelle_uhs_id === uhs.id);
  const wartebereichPersonen = personenInUhs.filter((p) => p.aktueller_platz_id == null);
  // „Noch nicht aufgenommen": in keiner UHS, nicht storniert, noch nicht final disponiert.
  // Transport/Entlassung/Verstorben leeren `aktuelle_uhs_id` (Auto-Austritt) — ohne den Filter
  // stünden sie hier und zugleich in der Transport-Spalte.
  const nichtAufgenommen = personen.filter(
    (p) => p.aktuelle_uhs_id == null && !p.storniert_at && !p.aktueller_verbleib,
  );
  function belegtAn(platzId: number): Person | undefined {
    return personenInUhs.find((p) => p.aktueller_platz_id === platzId);
  }
  // Kandidaten des Zuweisungsdialogs — dieselbe Menge, die der Drag-Weg erreicht. Der Wartebereich
  // steht vorn, weil er im Betrieb der häufigere Fall ist.
  const zuweisbarePersonen = [...wartebereichPersonen, ...nichtAufgenommen];

  // Rechte Spalte: Personen, die aus dieser UHS auf Transport gingen — Austritts-Historie
  // (`uhs.belegungen`) ∩ aktueller Verbleib „Transport".
  const ausgetretenIds = new Set(
    uhs.belegungen.filter((b) => b.art === 'austritt').map((b) => b.person_id),
  );
  const transportiert = personen
    .filter((p) => ausgetretenIds.has(p.id) && p.aktueller_verbleib?.startsWith('Transport'))
    .sort((a, b) => a.registrier_nr - b.registrier_nr);

  // Innenfläche so groß, dass alle Plätze hineinpassen — sie scrollt innerhalb der Mittelspalte.
  const maxX = Math.max(0, ...uhs.plaetze.map((p) => p.pos_x ?? 0));
  const maxY = Math.max(0, ...uhs.plaetze.map((p) => p.pos_y ?? 0));
  const flaecheBreite = Math.max(700, maxX + 160);
  const flaecheHoehe = Math.max(420, maxY + 140);

  function invalidate() {
    // Promise zurückgeben: React Query hält die Mutation so bis zum Ende aller Refetches `pending`,
    // sonst würden Folgeaktionen freigeschaltet, während ein später Refetch ein offenes Platzmenü
    // abräumt.
    return Promise.all([
      qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) }),
      qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) }),
      qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) }),
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) }),
    ]);
  }
  const fehler = useFehlerMeldung();

  const layoutMut = useMutation({
    mutationFn: ({ pid, pos_x, pos_y }: { pid: number; pos_x: number; pos_y: number }) =>
      aktualisierePlatz(einsatzId, uhs.id, pid, { pos_x, pos_y }),
    onMutate: async (v) => {
      const queryKey = einsatzKeys.uhsDetail(einsatzId, uhs.id);
      await qc.cancelQueries({ queryKey });
      const vorher = qc
        .getQueryData<UhsDetail>(queryKey)
        ?.plaetze.find((platz) => platz.id === v.pid);
      qc.setQueryData<UhsDetail>(queryKey, (alt) =>
        alt
          ? {
              ...alt,
              plaetze: alt.plaetze.map((platz) =>
                platz.id === v.pid ? { ...platz, pos_x: v.pos_x, pos_y: v.pos_y } : platz,
              ),
            }
          : alt,
      );
      return { vorher };
    },
    onSuccess: (serverStand) => {
      qc.setQueryData<UhsDetail>(einsatzKeys.uhsDetail(einsatzId, uhs.id), (alt) =>
        alt
          ? {
              ...alt,
              plaetze: alt.plaetze.map((platz) =>
                platz.id === serverStand.id ? serverStand : platz,
              ),
            }
          : alt,
      );
    },
    onError: (e, variablen, kontext) => {
      const vorher = kontext?.vorher;
      if (vorher) {
        qc.setQueryData<UhsDetail>(einsatzKeys.uhsDetail(einsatzId, uhs.id), (alt) => {
          if (!alt) return alt;
          const aktuell = alt.plaetze.find((platz) => platz.id === variablen.pid);
          // Ein neuerer Stand derselben Karte darf nicht vom alten Fehler zurückgerollt werden;
          // andere Plätze werden nie angefasst.
          if (!aktuell || aktuell.pos_x !== variablen.pos_x || aktuell.pos_y !== variablen.pos_y)
            return alt;
          return {
            ...alt,
            plaetze: alt.plaetze.map((platz) =>
              platz.id === variablen.pid
                ? { ...platz, pos_x: vorher.pos_x, pos_y: vorher.pos_y }
                : platz,
            ),
          };
        });
      }
      fehler(e);
    },
    onSettled: invalidate,
  });
  const belegMut = useMutation({
    mutationFn: ({ personId, platzId }: { personId: number; platzId: number | null }) => {
      const aktuell = personen.find((p) => p.id === personId);
      const art = aktuell?.aktuelle_uhs_id ? 'wechsel' : 'eintritt';
      return aenderePersonBelegung(einsatzId, personId, { art, uhs_id: uhs.id, platz_id: platzId });
    },
    onMutate: async (v) => {
      const queryKey = einsatzKeys.personen(einsatzId);
      await qc.cancelQueries({ queryKey });
      const vorher = qc
        .getQueryData<Person[]>(queryKey)
        ?.find((person) => person.id === v.personId);
      qc.setQueryData<Person[]>(queryKey, (alt) =>
        alt?.map((person) =>
          person.id === v.personId
            ? { ...person, aktuelle_uhs_id: uhs.id, aktueller_platz_id: v.platzId }
            : person,
        ),
      );
      return { vorher };
    },
    onSuccess: (serverStand) => {
      qc.setQueryData<Person[]>(einsatzKeys.personen(einsatzId), (alt) =>
        alt?.map((person) =>
          person.id === serverStand.person_id
            ? {
                ...person,
                aktuelle_uhs_id: serverStand.uhs_id,
                aktueller_platz_id: serverStand.platz_id,
              }
            : person,
        ),
      );
    },
    onError: (e, variablen, kontext) => {
      const vorher = kontext?.vorher;
      if (vorher) {
        qc.setQueryData<Person[]>(einsatzKeys.personen(einsatzId), (alt) =>
          alt?.map((person) => {
            if (person.id !== variablen.personId) return person;
            // Nur den eigenen optimistischen Stand rückgängig machen; hat ein neuerer Stand die
            // Person weiterbewegt, bleibt er.
            if (
              person.aktuelle_uhs_id !== uhs.id ||
              person.aktueller_platz_id !== variablen.platzId
            ) {
              return person;
            }
            return {
              ...person,
              aktuelle_uhs_id: vorher.aktuelle_uhs_id,
              aktueller_platz_id: vorher.aktueller_platz_id,
            };
          }),
        );
      }
      fehler(e);
    },
    onSettled: invalidate,
  });
  const austrittMut = useMutation({
    mutationFn: (personId: number) =>
      aenderePersonBelegung(einsatzId, personId, { art: 'austritt' }),
    onSuccess: () => invalidate(),
    onError: fehler,
  });
  // Verbleib erfassen (Transport / Entlassung / vor Ort / verstorben). Der Server trägt die Person
  // aus der UHS aus (Auto-Austritt); bei Transport wandert sie nach rechts.
  // `status=abtransportiert` nur bei Transport, sonst null — wie in der PersonenPage.
  const transportMut = useMutation({
    mutationFn: ({
      personId,
      art,
      ziel,
      transportmittel,
      notiz,
    }: VerbleibWerte & { personId: number }) =>
      erfasseVerbleib(einsatzId, personId, {
        art,
        ziel: ziel ?? null,
        transportmittel: transportmittel ?? null,
        status: art === 'transport' ? 'abtransportiert' : null,
        notiz: notiz ?? null,
      }),
    // Schließen und Leeren macht die Erfassungshülle.
    onSuccess: () => {
      message.success('Verbleib erfasst');
      invalidate();
    },
    onError: fehler,
  });
  const verfMut = useMutation({
    mutationFn: ({ platzId, verf }: { platzId: number; verf: Verfuegbarkeit }) =>
      setzePlatzVerfuegbarkeit(einsatzId, uhs.id, platzId, verf, null),
    onSuccess: () => invalidate(),
    onError: fehler,
  });
  const stornoMut = useMutation({
    mutationFn: (platzId: number) => stornierePlatz(einsatzId, uhs.id, platzId),
    onSuccess: () => {
      message.success('Platz gelöscht');
      invalidate();
    },
    onError: fehler,
  });

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { kind: string; personId?: number } | undefined;
    if (data?.kind === 'person' && data.personId != null) setAktivePersonId(data.personId);
  }

  // Overlay-State immer zuerst zurücksetzen: onDragEnd hat mehrere frühe `return`-Pfade, ein Reset
  // am Ende ließe einen Geister-Overlay stehen.
  function onDragCancel() {
    setAktivePersonId(null);
  }

  function onDragEnd(event: DragEndEvent) {
    setAktivePersonId(null);
    const { active, over, delta } = event;
    const data = active.data.current as
      { kind: string; personId?: number; platzId?: number } | undefined;
    if (!data) return;
    // Platz-Verschiebung braucht kein Drop-Target, das Delta reicht; auf >= 0 clampen.
    if (data.kind === 'platz' && data.platzId != null) {
      if (layoutMut.isPending) return;
      const platz = uhs.plaetze.find((p) => p.id === data.platzId);
      if (!platz) return;
      const nx = Math.max(0, (platz.pos_x ?? 10) + delta.x);
      const ny = Math.max(0, (platz.pos_y ?? 10) + delta.y);
      if (nx === (platz.pos_x ?? 10) && ny === (platz.pos_y ?? 10)) return;
      layoutMut.mutate({ pid: data.platzId, pos_x: nx, pos_y: ny });
      return;
    }
    // Person-Drop: braucht ein Drop-Target (Platz, Wartebereich oder Transport).
    if (data.kind === 'person' && data.personId != null) {
      if (belegMut.isPending) return;
      const target = over?.data.current as { kind: string; platzId?: number } | undefined;
      if (!target) return;
      if (target.kind === 'inbox') belegMut.mutate({ personId: data.personId, platzId: null });
      else if (target.kind === 'platz' && target.platzId != null) {
        belegMut.mutate({ personId: data.personId, platzId: target.platzId });
      } else if (target.kind === 'transport') {
        // Transport ändert Patientendaten → Abschluss-Screen öffnen statt sofort buchen.
        const person = personen.find((p) => p.id === data.personId);
        if (person) setTransportPerson(person);
      }
    }
  }

  const aktivePerson =
    aktivePersonId != null ? personen.find((p) => p.id === aktivePersonId) : undefined;

  // Die drei Bereiche stehen einmal: zwei Zweige mit eigenen Kopien wären zwei Wahrheiten, und die
  // Droppable-IDs kämen doppelt vor, sobald jemand `forceRender` setzt.
  const wartebereich = (
    // Test-Marke am Scrollcontainer: hier scrollt der Finger (`overflow: auto`), daran hängt die
    // touchAction-Entscheidung.
    <div
      data-testid="warteliste-scroll"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 0,
        overflow: 'auto',
        height: '100%',
      }}
    >
      {/* `onVerbleib` an beiden Listen: `drop-transport` liegt unter `lg` im dritten Reiter.
          Eine Person unter „Noch nicht aufgenommen" verlässt die Liste, sobald sie einen
          Verbleib trägt. */}
      <PersonenSpalte
        titel="Noch nicht aufgenommen"
        personen={nichtAufgenommen}
        schreibgeschuetzt={schreibgeschuetzt}
        belegungLaeuft={belegMut.isPending}
        leerText="keine"
        onOeffnen={setDetailPersonId}
        onVerbleib={schreibgeschuetzt ? undefined : setTransportPerson}
      />
      <PersonenSpalte
        titel="Wartebereich (Eingang)"
        personen={wartebereichPersonen}
        schreibgeschuetzt={schreibgeschuetzt}
        belegungLaeuft={belegMut.isPending}
        droppableId="drop-inbox"
        leerText="leer"
        onOeffnen={setDetailPersonId}
        onVerbleib={schreibgeschuetzt ? undefined : setTransportPerson}
      />
    </div>
  );

  const flaeche = (
    <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          gap: 8,
        }}
      >
        <Augenbraue als="h3">Unfallhilfsstelle</Augenbraue>
        {!schreibgeschuetzt &&
          (uhs.status === 'geplant' ? (
            <NeuerPlatzKnopf einsatzId={einsatzId} uhsId={uhs.id} primaer onSuccess={invalidate} />
          ) : (
            <Space>
              <Button
                type={platzBearbeitung ? 'primary' : 'text'}
                onClick={() => setPlatzBearbeitung((v) => !v)}
              >
                {platzBearbeitung ? 'Bearbeiten beenden' : 'Plätze bearbeiten'}
              </Button>
              {platzEditAktiv && (
                <NeuerPlatzKnopf einsatzId={einsatzId} uhsId={uhs.id} onSuccess={invalidate} />
              )}
            </Space>
          ))}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          border: `1px dashed ${rollen.linieStark}`,
          background: rollen.grund,
          borderRadius: 0,
        }}
      >
        <div style={{ position: 'relative', width: flaecheBreite, height: flaecheHoehe }}>
          {uhs.plaetze.map((p) => {
            const belegt = belegtAn(p.id);
            return (
              <PlatzKarte
                key={p.id}
                platz={p}
                belegtVon={belegt}
                schreibgeschuetzt={schreibgeschuetzt}
                belegungLaeuft={belegMut.isPending}
                bearbeitbar={platzEditAktiv && !layoutMut.isPending}
                onVerfuegbarkeit={(v) => verfMut.mutate({ platzId: p.id, verf: v })}
                onAustritt={() => {
                  const b = belegtAn(p.id);
                  if (b) austrittMut.mutate(b.id);
                }}
                onTransport={() => {
                  const b = belegtAn(p.id);
                  if (b) setTransportPerson(b);
                }}
                onStorno={() => stornoMut.mutate(p.id)}
                onOeffnen={setDetailPersonId}
                onZuweisen={() => {
                  // Ohne Kandidaten gar nicht öffnen: der Dialog trüge einen Primär-Knopf, der
                  // nichts erfasst.
                  if (zuweisbarePersonen.length === 0) {
                    message.info(
                      'Niemand zuweisbar — im Wartebereich und unter „Noch nicht aufgenommen" steht derzeit niemand.',
                    );
                    return;
                  }
                  setZuweisenPlatz(p);
                }}
                onZurueckInWartebereich={
                  // Nur bei belegtem Platz und mit Schreibrecht. `belegMut` errechnet `art` selbst
                  // — für eine Person an dieser UHS `'wechsel'`. Nicht an `belegMut.isPending`
                  // hängen: ein fehlender Callback nähme den Eintrag aus dem Menü; gesperrt wird er
                  // über `belegungLaeuft` in der Karte.
                  (() => {
                    if (!belegt || schreibgeschuetzt) return undefined;
                    return () => belegMut.mutate({ personId: belegt.id, platzId: null });
                  })()
                }
              />
            );
          })}
          {uhs.plaetze.length === 0 && (
            <Typography.Text type="secondary" style={{ padding: 10, display: 'block' }}>
              {schreibgeschuetzt
                ? 'Keine Plätze angelegt.'
                : 'Keine Plätze. Lege Plätze über „Plätze anlegen" an.'}
            </Typography.Text>
          )}
        </div>
      </div>
    </div>
  );

  // Eigener Scroll-Container wie `wartebereich`: im Tabs-Zweig steht der Knoten nackt im
  // Reiterinhalt, eine lange Liste liefe sonst über den Reiter hinaus.
  const transport = (
    <div style={{ height: '100%', minHeight: 0, overflow: 'auto' }}>
      <TransportSpalte
        personen={transportiert}
        schreibgeschuetzt={schreibgeschuetzt}
        belegungLaeuft={belegMut.isPending}
        onOeffnen={setDetailPersonId}
      />
    </div>
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {breit ? (
        <div
          data-testid="grundriss-rahmen"
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 12,
            height: '100%',
            minHeight: 0,
            alignItems: 'stretch',
          }}
        >
          {/* Links: Eingang / Wartebereich */}
          <div style={{ width: 240, flexShrink: 0, minHeight: 0 }}>{wartebereich}</div>
          {/* Mitte: Unfallhilfsstelle */}
          {flaeche}
          {/* Rechts: Auf Transport gebracht */}
          <div style={{ width: 240, flexShrink: 0, minHeight: 0 }}>{transport}</div>
        </div>
      ) : (
        /**
         * Unter `lg` gestapelt: zwei 240-px-Seitenspalten plus Abstände sind ein 504-px-Sockel vor
         * einer Fläche ab 700 px Innenbreite.
         *
         * Genau ein Zweig im Baum — ein verborgener zweiter trüge `drop-inbox` doppelt. Getragen
         * wird das von `destroyOnHidden`, nicht vom fehlenden `forceRender`: ohne die Prop bleibt
         * eine einmal besuchte Pane montiert (`removeOnLeave: false`, nur `display: none`).
         *
         * Folge: der Drag von der Warteliste auf einen Platz ist hier unmöglich (verschiedene
         * Reiter). Der Weg ist der Klickweg „Patient zuweisen", der Rückweg „Zurück in den
         * Wartebereich" — deshalb ist die Fläche der Default-Reiter.
         */
        <div
          data-testid="grundriss-rahmen"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            height: '100%',
            minHeight: 0,
          }}
        >
          <Tabs
            defaultActiveKey="flaeche"
            destroyOnHidden
            style={{ height: '100%' }}
            // Body und Pane reichen die Resthöhe weiter, sonst wächst die Fläche über den
            // begrenzten Grundriss hinaus.
            styles={{ body: { height: '100%' }, content: { height: '100%' } }}
            items={[
              { key: 'flaeche', label: 'Fläche', children: flaeche },
              { key: 'warte', label: 'Wartebereich', children: wartebereich },
              { key: 'transport', label: 'Transport', children: transport },
            ]}
          />
        </div>
      )}
      {/* Portal-Overlay: folgt dem Cursor auf Body-Ebene, beeinflusst keine Scroll-Region. */}
      <DragOverlay>
        {aktivePerson ? <Personenkarte person={aktivePerson} testId="drag-overlay" /> : null}
      </DragOverlay>

      {/* Abschluss-Screen „Verbleib erfassen" — Art vorbelegt mit Transport. Kein Serienmodus:
          ein Verbleib je Patient.

          „Ziel" steht vor „Art", weil die Hülle das erste Feld fokussiert und „Art" schon
          vorbelegt ist. Wer umsortiert, verschiebt den Fokus. */}
      <ErfassungsModal<VerbleibWerte>
        offen={transportPerson != null}
        titel={
          transportPerson
            ? `Verbleib erfassen — ${personLabel(transportPerson)}`
            : 'Verbleib erfassen'
        }
        form={transportForm}
        initialValues={{ art: 'transport' }}
        laeuft={transportMut.isPending}
        onErfassen={async (werte) => {
          // Der Dialog ist nur offen, solange eine Zielperson steht; die Prüfung engt den Typ ein.
          if (!transportPerson) return;
          await transportMut.mutateAsync({ personId: transportPerson.id, ...werte });
        }}
        onFertig={() => setTransportPerson(null)}
        onAbbrechen={() => setTransportPerson(null)}
      >
        <Form.Item label="Ziel (z. B. Krankenhaus, Freitext)" name="ziel">
          <Input />
        </Form.Item>
        <Form.Item label="Art" name="art" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'transport', label: 'Transport' },
              // Beendet den UHS-Aufenthalt wie Transport und Entlassung.
              { value: 'notunterkunft', label: 'Notunterkunft' },
              { value: 'entlassung', label: 'Entlassung vor Ort' },
              { value: 'vor_ort', label: 'verbleibt vor Ort' },
              { value: 'verstorben', label: 'Verbleib des Leichnams' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Transportmittel (RTW/KTW …)" name="transportmittel">
          <Input />
        </Form.Item>
        <Form.Item label="Notiz" name="notiz">
          <Input.TextArea rows={2} />
        </Form.Item>
      </ErfassungsModal>

      {/* Klick-Zuweisungsweg, der Ersatz für das Ziehen auf den Platz. Ein Feld, der Platz steht
          im Titel. Kein Serienmodus: der Zielplatz ist je Vorgang ein anderer. */}
      <ErfassungsModal<ZuweisenWerte>
        offen={zuweisenPlatz != null}
        titel={
          zuweisenPlatz ? `Patient zuweisen — ${zuweisenPlatz.bezeichnung}` : 'Patient zuweisen'
        }
        form={zuweisenForm}
        laeuft={belegMut.isPending}
        onErfassen={async (werte) => {
          // `mutateAsync`: ein abgelehnter Serverruf lässt die Auswahl stehen.
          if (!zuweisenPlatz || werte.personId == null) return;
          await belegMut.mutateAsync({ personId: werte.personId, platzId: zuweisenPlatz.id });
        }}
        onFertig={() => setZuweisenPlatz(null)}
        onAbbrechen={() => setZuweisenPlatz(null)}
      >
        <Form.Item label="Patient" name="personId" rules={[{ required: true }]}>
          <Select<number>
            placeholder="Patient auswählen…"
            options={zuweisbarePersonen.map((p) => ({ value: p.id, label: personLabel(p) }))}
          />
        </Form.Item>
      </ErfassungsModal>

      <PersonDetailDrawer
        einsatzId={einsatzId}
        personId={detailPersonId}
        onClose={() => setDetailPersonId(null)}
      />
    </DndContext>
  );
}

const PLATZ_TYPEN: { value: PlatzTyp; label: string }[] = [
  { value: 'wartebereich', label: 'Wartebereich' },
  { value: 'behandlungsplatz', label: 'Behandlungsplatz' },
  { value: 'bett', label: 'Bett' },
  { value: 'intensivplatz', label: 'Intensivplatz' },
  { value: 'trage', label: 'Trage' },
  { value: 'transport_bereitstellung', label: 'Transport-Bereitstellung' },
  { value: 'sonstige', label: 'Sonstige' },
];

// Plätze nach Typ + Menge anlegen — die Bezeichnungen („Bett 1", „Bett 2", …) vergibt der Server.
function NeuerPlatzKnopf({
  einsatzId,
  uhsId,
  onSuccess,
  primaer,
}: {
  einsatzId: number;
  uhsId: number;
  onSuccess: () => void;
  primaer?: boolean;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [typ, setTyp] = useState<PlatzTyp>('bett');
  const [menge, setMenge] = useState(1);
  const mut = useMutation({
    mutationFn: () => legePlaetzeAn(einsatzId, uhsId, { typ, menge }),
    onSuccess: (plaetze) => {
      message.success(
        plaetze.length === 1 ? 'Platz angelegt' : `${plaetze.length} Plätze angelegt`,
      );
      setMenge(1);
      setOpen(false);
      onSuccess();
    },
    onError: (e: unknown) => message.error(fehlerText(e, 'Anlegen fehlgeschlagen')),
  });
  if (!open) {
    return (
      <Button type={primaer ? 'primary' : 'default'} onClick={() => setOpen(true)}>
        Plätze anlegen
      </Button>
    );
  }
  return (
    <Space align="center" wrap>
      <Select<PlatzTyp>
        value={typ}
        onChange={setTyp}
        options={PLATZ_TYPEN}
        style={{ width: 200 }}
        aria-label="Platz-Typ"
      />
      <InputNumber
        min={1}
        max={50}
        value={menge}
        onChange={(v) => setMenge(v ?? 1)}
        aria-label="Menge"
      />
      <Button type="primary" loading={mut.isPending} onClick={() => mut.mutate()}>
        Anlegen
      </Button>
      <Button onClick={() => setOpen(false)}>Abbrechen</Button>
    </Space>
  );
}
