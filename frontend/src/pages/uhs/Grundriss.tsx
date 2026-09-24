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
  CarOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  LockOutlined,
  LogoutOutlined,
  RollbackOutlined,
  SyncOutlined,
  ToolOutlined,
  UserAddOutlined,
  UserOutlined,
} from '@ant-design/icons';
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
  PointerSensor,
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
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import PersonDetailDrawer from '../../personen/PersonDetailDrawer';
import { ErfassungsModal } from '../../components/Erfassung';
import StatusTag from '../../components/StatusTag';
import { Augenbraue, Paneel, StatusChip, monoStil, useRollen } from '../../components/instrument';
import { rollenFarbe, verfuegbarkeit as verfuegbarkeitVertrag } from '../../theme/statusFarben';
import { useViewport } from '../../components/useViewport';

// Feste Karten-Höhe. Muss unter dem Raster-Zeilenabstand (raster_position SCHRITT_Y=120
// im Backend) bleiben, damit absolut platzierte Karten einander nicht überlappen, und
// groß genug für den Worst Case (2-zeiliger Titel + Tag + Belegung + Aktionszeile).
export const PLATZ_KARTE_HOEHE = 116;

// Feste Karten-Breite — dieselbe Bindung wie die Höhe, nur an der anderen Achse:
// `raster_position` setzt SCHRITT_X = 160, die 20 px Luft je Seite sind der Spaltengraben.
export const PLATZ_KARTE_BREITE = 140;
const PLATZ_KARTE_RAND = 2;
const PLATZ_KARTE_POLSTER = 6;

/** Innenbreite der Aktionszeile: 140 − 2×2 Rand − 2×6 Polsterung = 124 px. */
const AKTIONSZEILE_BREITE = PLATZ_KARTE_BREITE - 2 * PLATZ_KARTE_RAND - 2 * PLATZ_KARTE_POLSTER;

/** Höhe des Aktionsstreifens im 100-px-Innenraum (Rechnung im Dateikopf unten). */
const AKTIONSZEILE_HOEHE = 24;

/**
 * Überlaufregel des Kartenmenüs (LFH-359): umklappen UND ins Fenster schieben. antds Typ
 * `AdjustOverflow` kennt nur `adjustX`/`adjustY`, zur Laufzeit reicht `getOverflowOptions`
 * (`antd/es/_util/placements.js`) das Objekt aber per Spread an rc-trigger durch, und dort
 * wirkt `shiftY` (im Browser belegt: ohne `shiftY` ist der e2e-Test „alle Menüeinträge
 * liegen im Fenster" rot). Als Konstante statt Literal, weil die Excess-Property-Prüfung
 * sonst an genau dieser Lücke im Typ anschlägt.
 */
const MENUE_UEBERLAUF: { adjustY: 1; shiftY: true } = { adjustY: 1, shiftY: true };

/** Voll ausgebaute Zeile: Transport, zurückweisen, „als frei", Platzaktionen. */
const AKTIONEN_MAX = 4;

/**
 * Bedienform der Platzkarte (LFH-359 + LFH-379): Knopfzeile oder die ganze Karte als EIN Ziel.
 *
 * Die Karte hat feste 124 × 100 px Innenraum (Rechnung unten), die Aktionszeile davon einen
 * 24 px hohen Streifen. Eine Zeile gibt es nur, wenn BEIDES passt:
 *   * Höhe: die kleinen Knöpfe (`controlHeightSM`, 24 / 48 / 72) stehen im 24-px-Streifen.
 *   * Breite: vier icon-only-Knöpfe (antd gibt ihnen `width: controlHeightSM`) plus drei
 *     Lücken von VOLLEM `marginSM` passen in 124 px. Die Lücke geht ungedeckelt ein, weil
 *     „zurückweisen" als `danger`-Knopf mindestens `marginSM` Abstand zu seinen neutralen
 *     Nachbarn braucht (LFH-363). Passt der nicht, gibt es keine Zeile.
 * Beides gilt nur in `kompakt` (4 × 24 + 3 × 7 = 117 ≤ 124). Dort sind 24 px auch der
 * Gate-3-Boden der Stufe (A1-Spec: „kompakt ≥ 24 px"). Ab `komfortabel` reißt schon die Höhe
 * — und die Breite: vier Knöpfe à 48 px brauchen 192 px, sie schrumpften vorher als
 * Flex-Items auf rund 31 px (LFH-379). Dort wird die ganze Karte (140 × 116 ≥ 72) das eine
 * Bedienziel und öffnet das Aktionsmenü. Zwei 72-px-Ziele passen in keiner Achse (2 × 72 >
 * 116, 2 × 72 > 140), die Kartenform ist also nicht Geschmack, sondern die einzige Form.
 *
 * Ersetzt `aktionsabstand()` aus LFH-378, das `marginSM` als OBERGRENZE nahm (7 / 0 / 0):
 * es begrenzte den Schaden einer Zeile, die in den Berührungsstufen zu breit war. Diese
 * Zeile gibt es nicht mehr, ein Deckel daneben wäre tote Logik.
 *
 * Rein und exportiert wie `bedienzielStil`: jsdom rechnet kein Layout, und `test/utils.tsx`
 * montiert ein `ConfigProvider` ohne unser Theme. Nur so ist die Entscheidung über alle
 * Stufen prüfbar. Die Komponente liest aufgelöste Tokens, kein Dichte-Etikett: die Form
 * folgt aus dem, was gerendert würde.
 *
 * TESTFALLE (gemessen): ohne App-Theme — das nackte `ConfigProvider` aus `test/utils.tsx` —
 * ist antds `marginSM` 12, also 4 × 24 + 3 × 12 = 132 > 124 und damit die KARTENFORM. Wer in
 * Vitest die Knopfzeile erwartet, rendert im App-Theme `kompakt`
 * (`antdToken(farbenDunkel, 'kompakt')`, Muster in `Grundriss.test.tsx`).
 */
export type PlatzBedienform = { form: 'zeile'; abstand: number } | { form: 'karte' };
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
 * Lage einer Platzkarte, aus der ihr Menü folgt (LFH-359). Setzt Schreibrecht voraus: ohne
 * gibt es in keiner Form ein Menü (die Zeile rendert es nicht, die Karte öffnet dann direkt
 * die Person oder ist gar kein Ziel).
 */
export interface PlatzMenueLage {
  form: PlatzBedienform['form'];
  belegt: boolean;
  /** Unbelegt, mit Schreibrecht, nicht im Bearbeiten-Modus — die Bedingung des Wurzelklicks. */
  zuweisbar: boolean;
  /** Der Rückweg existiert (belegt, mit Schreibrecht; s. `onZurueckInWartebereich`). */
  wartebereich: boolean;
  bearbeitbar: boolean;
  /** Eine Belegung läuft (LFH-457): Bewegungen der Person SPERREN, nichts entfernen. */
  belegungLaeuft: boolean;
}

const VERFUEGBARKEIT_EINTRAEGE = [
  { key: 'frei', label: 'als frei markieren', icon: <CheckCircleOutlined /> },
  { key: 'defekt', label: 'als defekt markieren', icon: <ToolOutlined /> },
  { key: 'aufbereitung', label: 'als in Aufbereitung markieren', icon: <SyncOutlined /> },
  { key: 'gesperrt', label: 'als gesperrt markieren', icon: <LockOutlined /> },
];

/**
 * Einträge des Platzmenüs für beide Bedienformen (LFH-359) — EINE Ableitung, damit Rechte
 * und Sperren nicht in zwei Kopien auseinanderlaufen.
 *
 * Zeilenform: das „…"-Menü des Bestands, unverändert. Die Patientenaktionen und „als frei"
 * sind dort Knöpfe der Zeile. „Patient zuweisen" steht trotzdem im Menü: der Wurzelklick ist
 * die Berührungsfläche, das Menü der Tastaturweg (LFH-367/B5g).
 *
 * Kartenform: die Karte ist das einzige Ziel, also wandert alles hinein — Primäraktion oben
 * (unbelegt „Patient zuweisen", belegt „Verbleib / Entlassung erfassen"), dann „Person
 * öffnen" (die Personenmarke ist in dieser Form kein eigenes Ziel) und der Rückweg, dann die
 * Verfügbarkeiten, und die Gefahr hinter einem Trenner (LFH-365). „zurückweisen" war in der
 * Zeile ein `danger`-Knopf, der Abstand zu seinen Nachbarn brauchte (LFH-363) — als Eintrag
 * hinter dem Trenner hat er ihn per Bauform (AK 4 LFH-379).
 *
 * Die Icons sind Zierde neben dem Eintragstext, bringen aber ihr englisches `aria-label` in
 * den zugänglichen Namen mit (gemessen, CLAUDE.md). Tests greifen deshalb per Teilstring.
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
          icon: <UserAddOutlined />,
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
            icon: <CarOutlined />,
            disabled: belegungLaeuft,
          },
        ]
      : [];
  const person =
    karte && belegt ? [{ key: 'person', label: 'Person öffnen', icon: <UserOutlined /> }] : [];
  // Rückweg in den Wartebereich (LFH-341 · H40): der Drag auf `drop-inbox` ist unter `lg`
  // strukturell weg — das Droppable liegt in einem anderen Reiter, und die Tabs tragen
  // `destroyOnHidden`.
  const rueckweg = wartebereich
    ? [
        {
          key: 'wartebereich',
          label: 'Zurück in den Wartebereich',
          icon: <RollbackOutlined />,
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
            icon: <LogoutOutlined />,
            danger: true,
            disabled: belegungLaeuft,
          },
        ]
      : []),
    ...(bearbeitbar
      ? [{ key: 'storno', label: 'Platz löschen', icon: <DeleteOutlined />, danger: true }]
      : []),
  ];
  const kopf = [...zuweisen, ...verbleib, ...person, ...rueckweg];
  // Zeilenform: der Trenner steht nur hinter „zuweisen", der Rückweg geht bündig in die
  // Verfügbarkeiten über — der Bestand, den die Zeilen-Tests pinnen.
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

// BEFUND zum kleinen `size`-Prop (LFH-328/A1 Festlegung 4, Gate 4) — hier standen SECHS,
// in zwei Gruppen, und die zweite ist kein Ermessen, sondern eine gemessene
// Kollision:
//
//   * Die zwei `Card` in `PersonenSpalte`/`TransportSpalte` waren ein reiner
//     Polsterungsfall ohne Treffläche; seit dem Neuentwurf sind sie `Paneel`e ohne `size`.
//   * Die vier Aktions-Buttons in `PlatzKarte` (Transport, Zurückweisen, „als frei",
//     Platzaktionen) lassen sich NICHT auf die volle Zeilenhöhe der Dichte-Staffel heben,
//     ohne die Karte zu sprengen. Die Rechnung: Innenraum = 116 − 12 (padding) − 4 (border)
//     = 100 px, belegt von Titel 30 + Tags 24 + Belegung 24 + Aktionen 24 = 102 px. Ein
//     Button auf voller Zeilenhöhe (kompakt: 30 px statt 22,5 px in der kleinen Stufe)
//     braucht 108 px — und die Karte darf nicht wachsen, weil SCHRITT_Y = 120 im BACKEND
//     (`raster_position`) sitzt. Die Treffläche hier hängt also an einer Server-Konstante,
//     nicht an einem Frontend-Token; das gehört zur Dichte-Umschaltung (B5), nicht in A2.
//     Einen Wert danebenzusetzen wäre genau die Ad-hoc-Entscheidung, gegen die A2 antritt
//     (Spec §5 Befund 7).
//
// NACHTRAG LFH-367/B5g — die Ausnahme ist geprüft und BESTÄTIGT, nicht vertagt. Die
// Rechnung oben gilt in JEDER Dichtestufe: die kleine Steuerhöhe liegt seit LFH-361 auf
// 24 / 48 / 72, die volle auf 30 / 48 / 72 — der Innenraum von 100 px trägt in keiner
// Stufe eine Aktionszeile auf voller Höhe. Damit scheidet auch der naheliegende Ausweg
// aus, alles ins Menü zu räumen: dessen Auslöser ist selbst ein Knopf und bräuchte
// dieselbe Höhe. Deshalb hat B5g den Bedienweg geändert statt der Grösse — die ganze
// Karte nimmt jetzt per Klick einen Patienten an (140 × 116 px), und die Aktionszeile
// bleibt die Ausweichfläche für den Rest. Die vier Angaben stehen als benannte Ausnahme
// in der Schuldliste von `components/dichte.guard.test.ts`; sie fallen mit einer
// Änderung an `raster_position`, nicht mit einem Frontend-Umbau.
//
// NACHTRAG LFH-359 + LFH-379 (24.09.2026) — der letzte Satz oben ist überholt. Die Rechnung
// bleibt richtig, aber sie zwingt nicht zur Ausnahme, sondern zu einer ANDEREN FORM je
// Stufe (`platzBedienform`):
//   * `kompakt`: Knopfzeile wie bisher. Die kleinen Knöpfe messen dort 24 px, und das IST
//     der Gate-3-Boden der Stufe (A1-Spec: „kompakt ≥ 24 px"), keine Unterschreitung.
//   * `komfortabel` / `handschuh`: keine Knopfzeile. Die ganze Karte (140 × 116) ist das
//     einzige Ziel und öffnet das Aktionsmenü; dessen Einträge messen `controlHeight`. Das
//     Menü-Argument oben („dessen Auslöser ist selbst ein Knopf") trifft nur einen Knopf IN
//     der Karte — ist die Karte selbst der Auslöser, braucht es keine Zeile mehr.
// Die vier Angaben bleiben im Quelltext und damit in der Schuldliste, weil der Guard Quelltext
// zählt und keine Dichte kennt; gerendert werden sie nur in `kompakt`. Kartengröße,
// `raster_position` und gespeicherte Layouts sind unberührt.
//
// Prop-Literal und Token-Name stehen bewusst nicht ausgeschrieben: Gate 4 zählt beide
// repo-weit, und ein erklärender Kommentar darf das Gate, das er erklärt, nicht reissen.

function personLabel(person: Person): string {
  const nr = registrierAnzeige(person.registrier_nr);
  return person.name ? `${nr} · ${person.name}` : `${nr} · unbekannt`;
}

interface PersonenkartenProps {
  person: Person | undefined;
  kompakt?: boolean;
  /**
   * Test-Marke an der gerenderten Personenmarke. Nur das DragOverlay setzt sie (LFH-341 · C6): ohne
   * eine Marke am schwebenden Knoten ist „der Drag läuft WIRKLICH" im Playwright nicht
   * behauptbar, und der Scroll-Nachweis fällt auf den billigen Scrolltest zurück, den B5g
   * schon hat. An der Marke statt an einer zusätzlichen Hülle, damit der Overlay-Teilbaum
   * unverändert bleibt.
   */
  testId?: string;
}
function Personenkarte({ person, kompakt, testId }: PersonenkartenProps) {
  const { token, rollen } = useRollen();
  if (!person) return null;
  /*
   * Personenmarke im Neuentwurf (LFH-621) statt antd-`Tag`: Radius 0, Haarlinie, Grund
   * `flaeche2`, Registriernummer Mono. Die HÖHE ist die des alten Tags und bewusst
   * dichteunabhängig (Zeilenhöhe aus `fontSizeSM` × `lineHeightSM` wie in antds Tag-Stil,
   * plus 2 × 1 px Rahmen): die belegte Platzkarte hat 100 px Innenraum, und dieser Streifen
   * ist mit 24 px eingeplant — die Karte darf nicht wachsen, weil `SCHRITT_Y = 120` im
   * Backend sitzt (Rechnung im Kopf dieser Datei). Kein Bedienziel: Klick und Zug trägt die
   * umgebende Hülle (`PersonenkarteDrag`), nicht die Marke.
   *
   * `data-lfh="personenkarte"` ist die Marke der e2e-Specs; sie griffen vorher über
   * `.ant-tag` und hingen damit an der Bibliothek statt an der Aussage.
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
    // `kompakt` (auf der Platz-Karte): einzeilig mit Ellipsis kappen, damit die absolut
    // positionierte, belegte Karte unabhängig von der Namenslänge eine stabile Höhe behält
    // und nicht in die darunterliegende Karte hineinwächst (Layout-Bruch).
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
   * Die Marke liegt in einem Auslöser, der selbst das Ziel ist (Kartenform, LFH-359). dnd-kits
   * `useDraggable` setzt `role="button"` und `tabIndex` auch bei `disabled` — ohne diese
   * Rücknahme stünde ein fokussierbarer Knopf IM Knopf (axe `nested-interactive`), mit
   * Schreibrecht startete Enter/Leertaste darauf einen Tastatur-Zug der Person. Die
   * Zeiger-Listener bleiben: der Zug per Maus/Finger ist weiter ein Zusatzweg; den
   * Tastaturweg zurück trägt der Menüeintrag „Zurück in den Wartebereich".
   */
  keinZiel?: boolean;
}) {
  // Kein Inline-`transform`: die gezogene Karte rendert als DragOverlay (Portal, s. u.).
  // Würde der Originalknoten hier transformiert, vergrößerte er die scroll-bare Region
  // seiner overflow:auto-Spalte → wachsende Scrollbar (Regression LFH-58-Folgebug).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `person-${person.id}`,
    data: { kind: 'person', personId: person.id },
    disabled,
  });
  // Klick (ohne 5px-Bewegung → kein Drag, s. PointerSensor) öffnet den Detail-Drawer.
  // `onClick` koexistiert mit den Drag-Listenern: ein echter Drag unterdrückt den nativen
  // Click, ein reiner Klick lässt ihn durch.
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
   * Eine Belegungs-Mutation läuft gerade (LFH-457). BEWUSST getrennt von
   * `schreibgeschuetzt`: das ist ein DAUERHAFTER Rechtezustand und nimmt Bedienelemente
   * aus dem Baum; dieser hier ist TRANSIENT und darf das nicht. Bis LFH-457 fuhr
   * `belegMut.isPending` als `schreibgeschuetzt` hier herein — damit verschwanden während
   * jeder Belegung ALLE Menü-Auslöser der Fläche (im Browser gemessen 26 bis 397 ms), und
   * ein Portal-Overlay stirbt mit seinem Auslöser. Wer in diesem Fenster ein Platzmenü
   * öffnete, verlor es wieder. Gesperrt werden deshalb nur die Wege, die eine ZWEITE
   * Belegung anstoßen würden — nicht das Menü als Ganzes.
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
  // Platz-Karte ist Drop-Target (Personen zuweisen) und — nur im Bearbeiten-Modus —
  // Drag-Source (Layout verschieben). Mit @dnd-kit beides am selben Knoten.
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
  // Kontrolliert, weil drei Wege öffnen (Klick über den Auslöser, Enter/Leertaste über
  // `aufTaste`) und die Menüwahl selbst schließt. Nur in der Kartenform benutzt.
  // Gemerkt wird, in WELCHEM Belegungszustand das Menü geöffnet wurde: ändert ein
  // Live-Update die Belegung, bauten sich die Einträge unter dem Finger um (aus „Patient
  // zuweisen" würde „Verbleib …", hinten erschiene das `danger` „zurückweisen") — dieselbe
  // Lage, gegen die LFH-457 gebaut ist. Das Menü ist dann zu, abgeleitet statt per Effekt.
  // Der Kartenknopf trägt ein `aria-label`; seine Kinder sind damit präsentational, und ein
  // Screenreader hörte nur „Aktionen zu Bett 1" ohne Belegung und Verfügbarkeit. Die beiden
  // Zustandsstreifen hängen deshalb als Beschreibung daran.
  const beschreibungsId = useId();
  const belegungsSchluessel = belegtVon ? `belegt:${belegtVon.id}` : 'frei';
  const [offenBei, setOffenBei] = useState<string | null>(null);
  const menueOffen = offenBei === belegungsSchluessel;
  const setMenueOffen = (offen: boolean) => setOffenBei(offen ? belegungsSchluessel : null);
  // Läuft ein Zug (dnd-kit), gehört die Tastatur ihm: das Enter, das einen Tastatur-Zug
  // ablegt, beendet dnd-kit an `document` — Reacts Handler an der Karte läuft vorher und
  // öffnete sonst zusätzlich das Menü.
  const zugLaeuft = useDndContext().active !== null;
  const setRef = (n: HTMLDivElement | null) => {
    setDragRef(n);
    setDropRef(n);
  };
  // Klick-Ersatzweg für den Drag (LFH-367/B5g): die ganze Karte nimmt einen Patienten an
  // — 140 × 116 px statt einer Geste, die auf dem Führungs-Tablet nicht verlässlich
  // ausführbar war. Bedingungen, jede aus einem eigenen Grund:
  //   * `belegtVon` — nur UNBELEGTE Plätze nehmen auf. Ein belegter trägt bereits eigene
  //     Klickziele (Personenkarte, Transport, Zurückweisen); ein Wurzelklick daneben
  //     vergrösserte genau die Verwechslungsfläche, die dieser Umbau verkleinern soll.
  //   * `bearbeitbar` — dort ist die Karte Drag-Source fürs Layout; der Klick gehört
  //     der Geste, die in diesem Modus gemeint ist.
  // Die VERFÜGBARKEIT wird bewusst NICHT geprüft: das Drop-Target tut es auch nicht
  // (s. onDragEnd), und ein Ersatzweg, der strenger ist als die Geste, die er ersetzt,
  // ersetzt sie nicht.
  const zuweisbar = !schreibgeschuetzt && !bearbeitbar && !belegtVon;
  // Der Schutz, den `belegMut.isPending` vor LFH-457 trug — er bleibt, aber er SPERRT
  // statt zu entfernen: die beiden Menüeinträge, die eine zweite Bewegung derselben Person
  // anstoßen würden („Patient zuweisen" und „Zurück in den Wartebereich"), stehen weiter da
  // und sind deaktiviert. Ein Eintrag, der während einer laufenden Belegung aus dem offenen
  // Menü verschwände (und beim Ende wieder auftauchte), verschöbe die Liste unter dem
  // Cursor — bei `autoFocus: true` fiele der Tastaturfokus dabei auf `<body>`, also genau
  // der „ich verliere meinen Platz"-Fall, gegen den dieses Ticket geschrieben ist. Und
  // „still weggeschaltet" ist ohnehin nicht die Bauform dieses Repos (CLAUDE.md,
  // C10/M16 · C11/M45). Der WURZELKLICK dagegen hat keinen Sperrzustand, den man sehen
  // könnte; er ruht.
  const zuweisenGesperrt = belegungLaeuft;
  const style: React.CSSProperties = {
    position: 'absolute',
    left: platz.pos_x ?? 10,
    top: platz.pos_y ?? 10,
    width: PLATZ_KARTE_BREITE,
    // FESTE Höhe + overflow:hidden: die Kartengröße ist invariant gegen Belegung, Titel-
    // Umbruch und Tag-Anzahl (Titel/Tags/Person/Aktionen sind unten je auf feste Höhe
    // gedeckelt). Alle Karten eines Rasters sind damit exakt gleich groß und bleiben unter
    // dem Raster-Zeilenabstand (120px) → keine Überlappung mit der Karte darunter.
    height: PLATZ_KARTE_HOEHE,
    overflow: 'hidden',
    boxSizing: 'border-box',
    cursor: bearbeitbar ? 'grab' : zuweisbar || (karte && belegtVon) ? 'pointer' : 'default',
    // Rand und Polsterung aus den Konstanten, nicht als Literale: `AKTIONSZEILE_BREITE`
    // rechnet mit genau diesen Werten, und eine Kopie hier liesse den Deckel still falsch
    // rechnen, sobald jemand nur eine der beiden Stellen ändert.
    border: `${PLATZ_KARTE_RAND}px solid ${rollenFarbe(verfuegbarkeitVertrag[platz.verfuegbarkeit].rolle, token)}`,
    // Belegte Plätze: Hintergrund + „belegt"-Tag. „frei" und „belegt" schließen sich aus
    // (s. u. tag-Logik); andere Verfügbarkeiten (defekt/gesperrt/…) bleiben daneben sichtbar.
    // Theme-Tokens statt fixer Hex-Werte, damit die Karten im Dark Mode mitziehen.
    // Neuentwurf: Flächen aus den Rollen (`bedienFlaeche` für die aktive Belegung, `flaeche`
    // sonst), Radius 0. NUR Farbe und Form der Ecke — Höhe, Rand und Polsterung bleiben an
    // die Konstanten oben gebunden (SCHRITT_X/SCHRITT_Y, Dateikopf).
    background: isOver ? token.colorPrimaryBg : belegtVon ? rollen.bedienFlaeche : rollen.flaeche,
    padding: PLATZ_KARTE_POLSTER,
    borderRadius: 0,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  // Menüinhalt aus EINER Ableitung für beide Formen (LFH-359): Rechte und Sperren stehen
  // in `platzMenueEintraege`, nicht in einer zweiten Kopie hier. Verfügbarkeit ändern
  // gehört zum laufenden Betrieb und steht deshalb auch außerhalb des Bearbeiten-Modus
  // im Menü; „Platz löschen" bleibt dem Bearbeiten-Modus vorbehalten.
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
    // Zeilenform: Das Dropdown rendert im Portal, sein Klick steigt aber im
    // KOMPONENTEN-Baum auf und erreichte damit den Wurzel-onClick dieser Karte (der
    // gemessene Fall aus LFH-365/MetaChip). Der Riegel dagegen sitzt NICHT hier: ein
    // `domEvent.stopPropagation()` in diesem Callback kommt zu spät und hält die
    // Ausbreitung nachweislich nicht auf — mit ihm allein bleibt der Regressionstest rot.
    // Wirksam ist der `click`-Riegel an der Aktionszeile unten, in deren Teilbaum das
    // Dropdown hängt. Wer den Auslöser von dort wegbewegt, muss den Riegel mitnehmen.
    onClick: ({ key }: { key: string }) => {
      setMenueOffen(false);
      waehle(key);
    },
  };
  // „frei" und „belegt" widersprechen sich — bei belegtem freien Platz nur „belegt" zeigen.
  // Echte Sonderzustände (defekt/aufbereitung/gesperrt/reserviert) bleiben auch belegt sichtbar.
  const zeigeVerfTag = !(belegtVon && platz.verfuegbarkeit === 'frei');
  // dnd-kit-Drag-Props NUR im Bearbeiten-Modus spreizen. Sonst setzt useDraggable (disabled)
  // role="button" + aria-disabled="true" auf die Karte → der ganze Subtree (inkl. der
  // Aktions-Buttons) gilt als deaktiviert (Screenreader + Tests können nicht klicken).
  const dragProps = bearbeitbar ? { ...attributes, ...listeners } : {};

  // ── Kartenform (LFH-359): die ganze Karte ist das eine Ziel ─────────────────────
  // Ohne Schreibrecht gibt es kein Menü: belegt öffnet der Tipp direkt die Person (ein
  // Menü mit einem Eintrag wäre ein Umweg, LFH-365 „ohne übrige Aktion kein Auslöser"),
  // unbelegt ist die Karte gar kein Ziel.
  const kartenMenue = karte && !schreibgeschuetzt;
  const kartenPerson = karte && schreibgeschuetzt && belegtVon ? belegtVon : undefined;
  const kartenAktion = kartenMenue
    ? () => setMenueOffen(true)
    : kartenPerson
      ? () => onOeffnen(kartenPerson.id)
      : undefined;
  // Enter öffnet immer. Die Leertaste nur außerhalb des Bearbeiten-Modus: dort startet sie
  // über dnd-kits KeyboardSensor den Layout-Zug, und der muss per Tastatur erreichbar
  // bleiben. Enter startet diesen Zug ebenfalls — er wird deshalb NICHT an dnd-kit
  // durchgereicht, sonst liefen Menü und Zug gleichzeitig los.
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
        // Im Menü-Fall öffnet der Dropdown-Auslöser selbst; ein eigener onClick daneben
        // riefe dasselbe zweimal.
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
      {/* Titel: max. 2 Zeilen, dann Ellipsis (voller Name im Tooltip). Feste maxHeight,
          damit ein Umbruch die Karte NICHT vergrößert. */}
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
      {/* Belegung: feste Höhe reserviert, auch wenn leer → Karte bleibt gleich groß.
          Belegte Person ist ziehbar (→ Wartebereich links oder Transport rechts); im
          Bearbeiten-Modus deaktiviert, damit sie nicht mit dem Platz-Drag kollidiert.
          Der Drag ist seit LFH-341/H40 NICHT mehr der einzige Weg zurück in den
          Wartebereich — „Zurück in den Wartebereich" im Menü ruft dieselbe Mutation.
          Unter `lg` (Reiter-Weiche) ist der Drag für DIESE Richtung sogar gar keiner
          mehr: Quelle (Platz) und Ziel (`drop-inbox`) liegen dann in verschiedenen
          Reitern, das Droppable ist nicht im Baum.
          In der Kartenform ist die Marke KEIN eigenes Klickziel (LFH-359): 24 px hoch und
          verschachtelt im Auslöser wäre sie genau das Ziel, das die Berührungsstufen
          verbieten. Ihr Klick steigt zur Karte auf und öffnet das Menü mit „Person
          öffnen"; der Zug bleibt, dnd-kit unterdrückt nach 5 px Bewegung den Klick. */}
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
      {/* Aktionszeile UNTER der Belegung als direkte Icon-Buttons; feste Höhe. Nur in der
          Zeilenform (kompakt): in den Berührungsstufen passt sie weder in die Höhe noch in
          die Breite der Karte (`platzBedienform`), dort trägt das Kartenmenü ihre Aktionen.
          DER `click`-RIEGEL DER KARTE SITZT HIER — einmal am Container statt an jedem
          Knopf. Die Knöpfe stoppen nur `pointerdown` (gegen den Drag-Start), und das hält
          den nachfolgenden `click` nicht auf. Der Container fängt beides: die direkten
          Knöpfe UND das Dropdown-Menü, dessen Portal-Klick im Komponentenbaum hier
          durchläuft. Ohne diese Zeile öffnete jeder Aktionsklick zusätzlich den
          Zuweisungsdialog — beide Regressionstests werden ohne sie rot (gemessen). */}
      {bedienform.form === 'zeile' && (
        <div
          style={{ display: 'flex', gap: bedienform.abstand, height: 24, alignItems: 'center' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* GESPERRT, nicht entfernt, solange eine Belegung läuft (LFH-457): das optimistische
              Update setzt die Person sofort auf diese Karte, beide Knöpfe erschienen also
              mitten in der laufenden Mutation — und beide gehen auf DIESELBE Person und
              denselben Endpunkt. Vor der Prop-Trennung war das strukturell unmöglich, weil
              `belegMut.isPending` die ganze Karte als `schreibgeschuetzt` führte; diese Sperre
              ist der Rest jenes Schutzes, ohne sein Nebenwirkung (das Abhängen). */}
          {belegtVon && !schreibgeschuetzt && (
            <>
              <Tooltip title="Verbleib / Entlassung erfassen">
                {/* stopPropagation: sonst startet eine kleine Mausbewegung beim Klick einen Drag. */}
                <Button
                  size="small"
                  aria-label="Verbleib / Entlassung erfassen"
                  icon={<CarOutlined />}
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
                  icon={<LogoutOutlined />}
                  disabled={belegungLaeuft}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onAustritt}
                />
              </Tooltip>
            </>
          )}
          {/* Primäraktion direkt (kein Menü): ein nicht-freier Platz wird per Klick frei
              gemacht (z. B. Aufbereitung abgeschlossen). Auch im Nicht-Edit-Modus. */}
          {!schreibgeschuetzt && platz.verfuegbarkeit !== 'frei' && (
            <Tooltip title="als frei markieren">
              <Button
                size="small"
                aria-label="als frei markieren"
                icon={<CheckCircleOutlined />}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onVerfuegbarkeit('frei')}
              />
            </Tooltip>
          )}
          {/* Weitere Platz-Aktionen (Verfügbarkeit, im Edit auch Löschen) — auch Nicht-Edit. */}
          {!schreibgeschuetzt && (
            <Dropdown menu={menu} trigger={['click']}>
              {/* Zeilenkennung im Namen (LFH-378-Folgeauflösung): n Plätze lieferten mit
                  bloßem „Platzaktionen" n gleichnamige Knöpfe — CLAUDE.md verlangt den
                  Bezug auf den Datensatz, für Neues UND ohnehin Angefasstes. */}
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
  // Kartenform mit Menü: die Karte selbst ist der Auslöser. Die Einträge messen
  // `controlHeight` (antds `paddingBlock` im Dropdown leitet sich daraus ab), also 48 / 72.
  //
  // HÖHE, gemessen bei 1024 × 900 im Handschuh: ein belegter Platz trägt acht Einträge,
  // rund 600 px — mehr, als unter ODER über der Karte Platz hat. antds Vorgabe für
  // `bottomLeft` klappt nur um (`adjustY`); passt keine Seite, stand das Menü nach oben
  // aus dem Fenster, und gerade die Primäraktion oben war nicht erreichbar. `shiftY`
  // schiebt es stattdessen ins Fenster (es darf die Karte dabei überdecken), und die
  // Höhengrenze mit eigenem Scroll fängt Fenster ab, die selbst dafür zu niedrig sind.
  return (
    <Dropdown
      menu={{
        ...menu,
        style: { maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto' },
      }}
      autoAdjustOverflow={MENUE_UEBERLAUF}
      // Fokus beim Öffnen auf den ersten Eintrag (gemessen): `menu.autoFocus` allein ließ ihn
      // nach Enter auf der Karte stehen, erst das `autoFocus` am Dropdown setzt ihn ins Menü.
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
  /** Belegung läuft (LFH-457) — sperrt den Drag, ohne Bedienelemente abzuhängen. */
  belegungLaeuft: boolean;
  droppableId?: string;
  leerText: string;
  onOeffnen: (personId: number) => void;
  /**
   * Verbleib erfassen — der ZWEITE Bedienweg, den der Reiter-Umbruch sonst genommen hätte
   * (Abschluss-Review LFH-341 · C6). Gemessen: `onDragEnd` nimmt `kind === 'transport'`
   * von JEDER Person entgegen, also auch aus dem Wartebereich und aus „Noch nicht
   * aufgenommen"; das Droppable `drop-transport` liegt unter `lg` aber im Reiter
   * „Transport". Die direkten Knöpfe „Verbleib / Entlassung erfassen" und „zurückweisen"
   * sitzen ausschliesslich auf der PlatzKarte und nur bei BELEGTEM Platz, und
   * `PersonDetailDrawer` ist mutationsfrei — eine Person im Wartebereich, die
   * abtransportiert wird oder weggeht, hätte im Grundriss also keinen Verbleib mehr
   * bekommen können. Dieselbe Einsicht wie beim Rückweg-Menüeintrag oben; zwei Bewegungen
   * mit derselben Ursache verschieden zu behandeln wäre ein Unterschied ohne Bedeutung.
   *
   * NICHT gesetzt heisst „kein Schreibrecht" — der Auslöser wird dann GAR NICHT gerendert,
   * nicht deaktiviert. Die Prop-Anwesenheit blieb der Riegel, weil `schreibgeschuetzt`
   * daneben bis LFH-457 zusätzlich `belegMut.isPending` trug und der Auslöser damit
   * während jeder Belegung wegflackerte. Diese Vermischung ist aufgelöst (`belegungLaeuft`
   * ist jetzt eine eigene Prop) — der Riegel bleibt trotzdem hier, weil ein Verbleib ohne
   * Schreibrecht gar keine Aktion ist und ein gesperrter Knopf nur Platz kostete.
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
                {/* GESCHWISTERKNOTEN der Drag-Karte, nicht ihr Kind: so hängt der Auslöser
                    in keinem klickbaren Vorfahren und braucht weder `stopPropagation` noch
                    den `onPointerDown`-Riegel, den die vier Knöpfe INNERHALB der Platzkarte
                    schulden (dort ist die Karte selbst Drag-Source). Dieselbe Auflösung,
                    die `MetaChip` in LFH-367 genommen hat.
                    Ein echter antd-`Button` OHNE `size`: er erbt `controlHeight` vom
                    `ConfigProvider` und schuldet damit nicht die zwei Angaben, die
                    LFH-365 einem handgebauten Bedienziel auferlegt. Der zugängliche Name
                    trägt die Zeilenkennung — n Zeilen lieferten sonst n gleichnamige
                    Knöpfe. Die Ikone steckt in einer `aria-hidden`-Hülle: ein
                    `@ant-design/icons`-Knoten brächte sonst sein eigenes englisches
                    `aria-label` als zweites Vorleseziel in jede Zeile (CLAUDE.md,
                    Muster `kraefte/AmpelZelle.tsx`). */}
                <Button
                  type="text"
                  aria-label={`Verbleib / Entlassung erfassen — ${personLabel(p)}`}
                  icon={
                    <span aria-hidden="true">
                      <CarOutlined />
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

/** Rechte Spalte: aus DIESER UHS heraus auf Transport gebrachte Personen.
 *  Drop-Target: eine belegte Person hierher ziehen öffnet den Transport-Abschluss-Screen. */
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
  // Das Drop-Target ruht während einer laufenden Belegung. NICHT, weil es dieselbe Mutation
  // anstieße — `kind: 'transport'` führt in `onDragEnd` auf `setTransportPerson`, also auf
  // `erfasseVerbleib` und einen anderen Endpunkt. Sondern weil es derselbe GESTENWEG ist:
  // die Quelle (Personenkarte) ist während der Belegung ohnehin nicht ziehbar, und ein
  // aufnahmebereites Ziel ohne mögliche Quelle wäre eine Einladung ins Leere.
  // Bedienelemente hängt `belegungLaeuft` NICHT ab (LFH-457).
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
            {/* Ein echter Knopf statt eines klickbaren `Tag`: der war ein `<span onClick>` ohne
                Rolle und ohne Tastaturweg. `type="link"` erbt die Steuerhöhe der Staffel. */}
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

/** Einziges Feld des Klick-Zuweisungswegs (LFH-367/B5g). */
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
  // Sensors: PointerSensor mit 5px-Aktivierungsdistanz (sonst klickt jeder Click den Drag aus),
  // KeyboardSensor für Tests/Accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  // Breakpoint-Weiche (LFH-341 · H40): ab `lg` wie bisher nebeneinander, darunter drei
  // Reiter. Details am Rahmen-`div` im JSX unten.
  const { abBreite } = useViewport();
  const breit = abBreite('lg');

  // Bauphase (geplant) → Plätze-Bearbeitung ist Primäraktion und standardmäßig an.
  // Aktiv → Patienten zuweisen steht im Vordergrund, Bearbeiten ist sekundär (Toggle).
  const [platzBearbeitung, setPlatzBearbeitung] = useState(() => uhs.status === 'geplant');
  useEffect(() => {
    setPlatzBearbeitung(uhs.status === 'geplant');
  }, [uhs.status]);
  const platzEditAktiv = platzBearbeitung && !schreibgeschuetzt;

  // Aktiv gezogene Person → wird im DragOverlay (Portal) gerendert. Platz-Drags nutzen
  // weiterhin ihren Inline-Transform innerhalb der Fläche (kein Overlay nötig/gewollt).
  const [aktivePersonId, setAktivePersonId] = useState<number | null>(null);

  // Zielperson des „Verbleib erfassen"-Abschluss-Screens (null = geschlossen).
  const [transportPerson, setTransportPerson] = useState<Person | null>(null);
  const [transportForm] = Form.useForm<VerbleibWerte>();

  // Klick auf eine Patientenkarte öffnet den schlanken Detail-Drawer (nur ansehen).
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
  // „Noch nicht aufgenommen" = aufnehmbar in diese UHS: in keiner UHS, nicht storniert
  // und noch nicht final disponiert. Transport/Entlassung/Verstorben leeren `aktuelle_uhs_id`
  // (Auto-Austritt) — ohne diesen Filter erschienen sie hier UND rechts in der Transport-Spalte.
  const nichtAufgenommen = personen.filter(
    (p) => p.aktuelle_uhs_id == null && !p.storniert_at && !p.aktueller_verbleib,
  );
  function belegtAn(platzId: number): Person | undefined {
    return personenInUhs.find((p) => p.aktueller_platz_id === platzId);
  }
  // Kandidaten des Zuweisungsdialogs — dieselbe Menge, die der Drag-Weg erreicht: die
  // beiden linken Spalten. Der Wartebereich steht vorn, weil er im Betrieb der häufigere
  // Fall ist (bereits aufgenommen, wartet auf einen Platz).
  const zuweisbarePersonen = [...wartebereichPersonen, ...nichtAufgenommen];

  // Rechte Spalte: Personen, die aus DIESER UHS heraus auf Transport gingen. Quelle ist
  // die UHS-eigene Austritts-Historie (uhs.belegungen) ∩ aktueller Verbleib „Transport".
  const ausgetretenIds = new Set(
    uhs.belegungen.filter((b) => b.art === 'austritt').map((b) => b.person_id),
  );
  const transportiert = personen
    .filter((p) => ausgetretenIds.has(p.id) && p.aktueller_verbleib?.startsWith('Transport'))
    .sort((a, b) => a.registrier_nr - b.registrier_nr);

  // Innenfläche so groß wählen, dass alle Plätze hineinpassen — sie scrollt INNERHALB
  // der Mittelspalte, sprengt also nie die Seitenbreite.
  const maxX = Math.max(0, ...uhs.plaetze.map((p) => p.pos_x ?? 0));
  const maxY = Math.max(0, ...uhs.plaetze.map((p) => p.pos_y ?? 0));
  const flaecheBreite = Math.max(700, maxX + 160);
  const flaecheHoehe = Math.max(420, maxY + 140);

  function invalidate() {
    // Promise zurückgeben: React Query hält die Mutation so bis zum Abschluss aller
    // Refetches auf `pending`. Sonst werden Folgeaktionen bereits wieder freigeschaltet,
    // während ein später UHS-Refetch z. B. ein gerade geöffnetes Platzmenü abräumt.
    return Promise.all([
      qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) }),
      qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) }),
      qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) }),
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) }),
    ]);
  }
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

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
          // Ein inzwischen neuerer Stand derselben Karte darf nicht vom alten Fehler
          // zurueckgerollt werden. Andere Plaetze werden grundsaetzlich nie angefasst.
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
            // Nur den eigenen optimistischen Stand rueckgaengig machen. Hat ein neuerer
            // Server-/Live-Stand die Person bereits weiterbewegt, bleibt dieser erhalten.
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
  // Verbleib erfassen (Transport / Entlassung / vor Ort / verstorben — wie in der
  // Patienten-Ansicht). Der Server trägt die Person dabei aus der UHS aus (Auto-Austritt);
  // bei Transport wandert sie rechts in „Auf Transport gebracht". status=abtransportiert
  // nur bei Transport (sonst null) — gleiche Semantik wie PersonenPage.
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
    // Schliessen und Leeren macht die Erfassungshülle (onFertig bzw. ihr eigener Reset).
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

  // Overlay-State IMMER zuerst zurücksetzen — onDragEnd hat mehrere frühe `return`-Pfade
  // (kein Drop-Target, keine Verschiebung); ein Reset am Ende ließe sonst einen Geister-
  // Karten-Overlay stehen.
  function onDragCancel() {
    setAktivePersonId(null);
  }

  function onDragEnd(event: DragEndEvent) {
    setAktivePersonId(null);
    const { active, over, delta } = event;
    const data = active.data.current as
      { kind: string; personId?: number; platzId?: number } | undefined;
    if (!data) return;
    // Platz-Verschiebung: braucht kein Drop-Target — Layout-Fläche ist keine Droppable.
    // delta reicht; auf >= 0 clampen, damit die Karte nicht off-screen landen kann.
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
        // Transport ändert Patientendaten (Verbleib) → Abschluss-Screen öffnen statt sofort buchen.
        const person = personen.find((p) => p.id === data.personId);
        if (person) setTransportPerson(person);
      }
    }
  }

  const aktivePerson =
    aktivePersonId != null ? personen.find((p) => p.id === aktivePersonId) : undefined;

  // Die drei Bereiche stehen EINMAL. Zwei Zweige mit je eigener Kopie wären zwei
  // Wahrheiten über dieselbe Spalte — und die Droppable-IDs kämen doppelt vor, sobald
  // irgendwann jemand `forceRender` setzt (LFH-341 · H40).
  const wartebereich = (
    // Test-Marke am SCROLLCONTAINER, nicht an einer der beiden Karten darin: die
    // touchAction-Entscheidung aus LFH-367/B5g hängt genau an diesem Knoten — er trägt
    // `overflow: auto`, hier scrollt also der Finger (LFH-341 · C6).
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
      {/* `onVerbleib` an BEIDEN Listen, nicht nur am Wartebereich: die Lücke ist an beiden
          dieselbe (nachgemessen im Abschluss-Review) — `onDragEnd` nahm `kind: 'transport'`
          von jeder Person entgegen, und `drop-transport` liegt unter `lg` im dritten
          Reiter. Eine Person unter „Noch nicht aufgenommen" verlässt die Liste sauber,
          sobald sie einen Verbleib trägt (`!p.aktueller_verbleib` im Filter oben). */}
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
                  // Ohne Kandidaten gar nicht erst öffnen: der Dialog trüge einen
                  // Primär-Knopf, der nichts erfasst und nur schliesst — eine tote
                  // Hauptaktion. Die Hülle kennt keinen Weg, ihn zu unterdrücken,
                  // und sie dafür umzubauen träfe alle ihre Aufrufer.
                  if (zuweisbarePersonen.length === 0) {
                    message.info(
                      'Niemand zuweisbar — im Wartebereich und unter „Noch nicht aufgenommen" steht derzeit niemand.',
                    );
                    return;
                  }
                  setZuweisenPlatz(p);
                }}
                onZurueckInWartebereich={
                  // Nur bei belegtem Platz und nur mit Schreibrecht. `belegMut` errechnet
                  // `art` selbst — für eine Person, die bereits an dieser UHS liegt,
                  // ergibt das `'wechsel'`. Der Eintritt in den Wartebereich IST ein
                  // Wechsel, kein Austritt.
                  // NICHT an `belegMut.isPending` hängen (LFH-457): die Abwesenheit des
                  // Callbacks nimmt den Eintrag aus dem Menü, und das ist genau der
                  // Mechanismus, den dieses Ticket abgestellt hat. Gesperrt wird er über
                  // `belegungLaeuft` in der Karte — sichtbar, an seinem Platz.
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

  // Eigener Scroll-Container wie bei `wartebereich`: der Bereich trägt seine
  // Overflow-Eigenschaft SELBST, damit sie im Tabs-Zweig nicht fehlt (dort steht der
  // Knoten nackt im Reiterinhalt — ohne diesen Wrapper liefe eine lange Transport-Liste
  // auf schmalem Schirm über den Reiter hinaus).
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
          {/* LINKS: Eingang / Wartebereich */}
          <div style={{ width: 240, flexShrink: 0, minHeight: 0 }}>{wartebereich}</div>
          {/* MITTE: Unfallhilfsstelle */}
          {flaeche}
          {/* RECHTS: Auf Transport gebracht */}
          <div style={{ width: 240, flexShrink: 0, minHeight: 0 }}>{transport}</div>
        </div>
      ) : (
        /**
         * UNTER `lg` GESTAPELT (LFH-341 · H40). Die beiden Seitenspalten waren mit
         * `width: 240, flexShrink: 0` plus zweimal `gap: 12` ein 504-px-Sockel VOR einer
         * Fläche, deren Innenbreite bei `Math.max(700, …)` beginnt — bei 390 px sprengten
         * allein die Spalten den Schirm.
         *
         * GENAU EIN ZWEIG IM BAUM — dieselbe Entscheidung wie beim Navigations-Drawer aus
         * B1 und die erste Zusicherung von `Datensicht`. Ein verborgener zweiter machte die
         * Prüfung „unter lg nicht nebeneinander" bedeutungslos und trüge `drop-inbox`
         * doppelt.
         *
         * Getragen wird sie von `destroyOnHidden`, NICHT vom Fehlen eines `forceRender` —
         * das ist gemessen und korrigiert eine Behauptung, die dieser Bau vier Mal aufstellte:
         * antd reicht `destroyOnHidden ?? destroyInactiveTabPane` an `@rc-component/tabs`
         * durch (`antd/es/tabs/index.js:157`); sind beide `undefined`, ergibt das
         * `removeOnLeave: false`, und eine einmal BESUCHTE Pane bleibt dauerhaft montiert —
         * nur mit `display: none` und `aria-hidden`. Ohne die Prop hielte die Aussage also
         * exakt bis zum ersten Reiterwechsel.
         *
         * FOLGE, und sie ist gewollt: der Drag von der Warteliste auf einen Platz ist hier
         * strukturell unmöglich — Quelle und Ziel liegen in verschiedenen Reitern. Der Weg
         * auf schmalem Schirm ist der Klickweg aus LFH-367/B5g („Patient zuweisen" am
         * unbelegten Platz), der Rückweg ist „Zurück in den Wartebereich" im Platzaktionen-
         * Menü. Deshalb ist die Fläche der Default-Reiter.
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
            // Der Tabs-Holder bekommt die Resthöhe nach der Reiterleiste. Body
            // und Pane müssen sie weiterreichen, sonst wächst die Fläche nach
            // ihrem Inhalt über den begrenzten Grundriss hinaus (LFH-459).
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

      {/* Abschluss-Screen „Verbleib erfassen" — Art wählbar (Default Transport, vom
          Platz-Button und vom Drag auf „Auf Transport gebracht" vorbelegt).
          Kein Serienmodus: ein Verbleib wird je Patient genau einmal erfasst.

          FELDREIHENFOLGE IST ABSICHT: „Ziel" steht vor „Art", weil die Hülle beim Öffnen
          das erste bedienbare Feld fokussiert — und „Art" ist bereits mit Transport
          vorbelegt, also nichts, was der Erfassende zuerst tippt. Wer hier umsortiert,
          verschiebt damit den Fokus. */}
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
          // Der Dialog ist nur offen, solange eine Zielperson steht (`offen` oben);
          // die Prüfung engt bloss den Typ ein.
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
              // Beendet den UHS-Aufenthalt wie Transport und Entlassung (LFH-613).
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

      {/* Klick-Zuweisungsweg (LFH-367/B5g): der Ersatz für das Ziehen auf den Platz.
          EIN Feld — das Feldbudget aus LFH-19 (Modal ≤ ~3) ist mit Abstand eingehalten;
          der Platz steht im Titel, nicht als zweites Feld. Kein Serienmodus: der Zielplatz
          ist je Vorgang ein anderer, ein „und nächste" hätte kein sinnvolles Nächstes. */}
      <ErfassungsModal<ZuweisenWerte>
        offen={zuweisenPlatz != null}
        titel={
          zuweisenPlatz ? `Patient zuweisen — ${zuweisenPlatz.bezeichnung}` : 'Patient zuweisen'
        }
        form={zuweisenForm}
        laeuft={belegMut.isPending}
        onErfassen={async (werte) => {
          // `mutateAsync`, damit ein abgelehnter Serverruf die Auswahl stehen lässt
          // (LFH-332: die Hülle leert erst, wenn die Zusage hält).
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

      {/* Schlanker Detail-Drawer beim Klick auf eine Patientenkarte (nur ansehen). */}
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

// LFH-16: Plätze nach Typ + Menge anlegen — Bezeichnungen vergibt der Server
// automatisch fortlaufend („Bett 1", „Bett 2", …), keine manuelle Namensvergabe.
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
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
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
