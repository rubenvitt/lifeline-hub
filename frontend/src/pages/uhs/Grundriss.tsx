import { App, Button, Card, Dropdown, Form, Input, InputNumber, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { Select } from '../../components/Select';
import {
  CarOutlined, CheckCircleOutlined, DeleteOutlined, LockOutlined, LogoutOutlined,
  SyncOutlined, ToolOutlined, UserAddOutlined,
} from '@ant-design/icons';
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent, KeyboardSensor, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  aenderePersonBelegung, aktualisierePlatz, legePlaetzeAn, setzePlatzVerfuegbarkeit, stornierePlatz,
} from '../../api/einsatzUhs';
import { erfasseVerbleib, listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import type { Person, PlatzTyp, UhsDetail, UhsPlatz, VerbleibArt, Verfuegbarkeit } from '../../api/types';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import PersonDetailDrawer from '../../personen/PersonDetailDrawer';
import { ErfassungsModal } from '../../components/Erfassung';
import StatusTag from '../../components/StatusTag';
import { rollenFarbe, verfuegbarkeit as verfuegbarkeitVertrag } from '../../theme/statusFarben';

// Feste Karten-Höhe. Muss unter dem Raster-Zeilenabstand (raster_position SCHRITT_Y=120
// im Backend) bleiben, damit absolut platzierte Karten einander nicht überlappen, und
// groß genug für den Worst Case (2-zeiliger Titel + Tag + Belegung + Aktionszeile).
const PLATZ_KARTE_HOEHE = 116;

// Feste Karten-Breite — dieselbe Bindung wie die Höhe, nur an der anderen Achse:
// `raster_position` setzt SCHRITT_X = 160, die 20 px Luft je Seite sind der Spaltengraben.
const PLATZ_KARTE_BREITE = 140;
const PLATZ_KARTE_RAND = 2;
const PLATZ_KARTE_POLSTER = 6;

/** Innenbreite der Aktionszeile: 140 − 2×2 Rand − 2×6 Polsterung = 124 px. */
const AKTIONSZEILE_BREITE =
  PLATZ_KARTE_BREITE - 2 * PLATZ_KARTE_RAND - 2 * PLATZ_KARTE_POLSTER;

/** Voll ausgebaute Zeile: Transport, zurückweisen, „als frei", Platzaktionen. */
const AKTIONEN_MAX = 4;

/**
 * Abstand zwischen den Knöpfen der Aktionszeile (LFH-378 · B5l).
 *
 * Der `danger`-Knopf „zurückweisen" steht neben neutralen Aktionen; LFH-363 verlangt dort
 * mindestens `token.marginSM`. Der Wert wird aber GEDECKELT, und das ist gemessen, nicht
 * vorsichtshalber: antd gibt einem icon-only-Knopf `width: controlHeightSM` (24 / 48 / 72),
 * und als Flex-Items ohne `flex-shrink: 0` schrumpfen die Knöpfe auf diese 124 px. Ab
 * `komfortabel` brauchen vier Knöpfe allein 192 px — jede Lücke ginge dann direkt von der
 * Trefffläche ab, ein ungedeckeltes `marginSM` machte die Ziele also KLEINER. Gerechnet
 * wird mit der vollen Zeile: ein Abstand, der mit der Knopfzahl springt, wäre von Karte zu
 * Karte verschieden.
 *
 * Die Rechnung ist bewusst eine ABSCHÄTZUNG nach oben und keine Pixelbilanz: drei der vier
 * Knöpfe sind icon-only und damit quadratisch (`width: controlHeightSM`), der vierte ist der
 * Menü-Auslöser mit „…" als Inhalt — der misst `paddingInlineSM × 2 + Textbreite` und damit
 * etwas anderes. Ihn ebenfalls als Quadrat zu zählen überschätzt den Bedarf leicht; das ist
 * die richtige Richtung für einen Deckel, der nichts überlaufen lassen soll. Eine echte
 * Breitenmessung bräuchte Layout, und jsdom rechnet keins.
 *
 * Rein und exportiert aus demselben Grund wie `bedienzielStil` in `lagekarte/Sidebar.tsx`:
 * nur so ist die Zusicherung über mehrere Dichtestufen prüfbar, ohne zu rendern — jsdom
 * rechnet kein Layout, und `test/utils.tsx` montiert ein `ConfigProvider` ohne unser Theme.
 *
 * DASS die Zeile ab `komfortabel` überhaupt überläuft — vier Knöpfe à 48 px brauchen 192 px
 * in einer 124 px breiten Zeile, die Knöpfe schrumpfen auf grob 31 px und verfehlen damit den
 * Trefflächenboden aus Gate 3 —, ist ein EIGENER Befund: **LFH-379**. Weder LFH-367 noch
 * LFH-378 hatten ihn im Umfang, beide bewerten die Höhe der Zeile, nicht ihre Breite. Diese
 * Funktion verkleinert den Schaden (mehr Abstand machte die Ziele kleiner), sie behebt ihn
 * nicht. Wer LFH-379 umsetzt, zieht sie mit oder entfernt sie mit Begründung — ein Deckel,
 * der danach immer 0 liefert, wäre tote Logik.
 */
export function aktionsabstand(token: { marginSM: number; controlHeightSM: number }) {
  const knoepfe = AKTIONEN_MAX * token.controlHeightSM;
  const jeLuecke = Math.floor((AKTIONSZEILE_BREITE - knoepfe) / (AKTIONEN_MAX - 1));
  return Math.max(0, Math.min(token.marginSM, jeLuecke));
}

// BEFUND zum kleinen `size`-Prop (LFH-328/A1 Festlegung 4, Gate 4) — hier bleiben SECHS
// stehen, in zwei Gruppen, und die zweite ist kein Ermessen, sondern eine gemessene
// Kollision:
//
//   * Die zwei `Card` in `PersonenSpalte`/`TransportSpalte` sind ein reiner
//     Polsterungsfall und treffen keine Treffläche — bleiben.
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
// Prop-Literal und Token-Name stehen bewusst nicht ausgeschrieben: Gate 4 zählt beide
// repo-weit, und ein erklärender Kommentar darf das Gate, das er erklärt, nicht reissen.

function personLabel(person: Person): string {
  const nr = registrierAnzeige(person.registrier_nr);
  return person.name ? `${nr} · ${person.name}` : `${nr} · unbekannt`;
}

interface PersonenkartenProps { person: Person | undefined; kompakt?: boolean; }
function Personenkarte({ person, kompakt }: PersonenkartenProps) {
  if (!person) return null;
  // `kompakt` (auf der Platz-Karte): Label einzeilig mit Ellipsis kappen, damit die
  // absolut positionierte, belegte Karte unabhängig von der Namenslänge eine stabile
  // Höhe behält und nicht in die darunterliegende Karte hineinwächst (Layout-Bruch).
  const style: React.CSSProperties = kompakt
    ? { margin: 2, maxWidth: 124, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
    : { margin: 2 };
  return <Tag color="default" style={style} title={kompakt ? personLabel(person) : undefined}>{personLabel(person)}</Tag>;
}

function PersonenkarteDrag({ person, disabled, kompakt, onOeffnen }: { person: Person; disabled: boolean; kompakt?: boolean; onOeffnen?: (personId: number) => void }) {
  // Kein Inline-`transform`: die gezogene Karte rendert als DragOverlay (Portal, s. u.).
  // Würde der Originalknoten hier transformiert, vergrößerte er die scroll-bare Region
  // seiner overflow:auto-Spalte → wachsende Scrollbar (Regression LFH-58-Folgebug).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `person-${person.id}`, data: { kind: 'person', personId: person.id }, disabled,
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
  bearbeitbar: boolean;
  onVerfuegbarkeit: (v: Verfuegbarkeit) => void;
  onAustritt: () => void;
  onTransport: () => void;
  onStorno: () => void;
  onOeffnen: (personId: number) => void;
  onZuweisen: () => void;
}

function PlatzKarte({ platz, belegtVon, schreibgeschuetzt, bearbeitbar, onVerfuegbarkeit, onAustritt, onTransport, onStorno, onOeffnen, onZuweisen }: PlatzKarteProps) {
  // Platz-Karte ist Drop-Target (Personen zuweisen) und — nur im Bearbeiten-Modus —
  // Drag-Source (Layout verschieben). Mit @dnd-kit beides am selben Knoten.
  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: `platz-${platz.id}`, data: { kind: 'platz', platzId: platz.id }, disabled: !bearbeitbar,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-platz-${platz.id}`, data: { kind: 'platz', platzId: platz.id, uhsId: platz.uhs_id },
  });
  const { token } = theme.useToken();
  const setRef = (n: HTMLDivElement | null) => { setDragRef(n); setDropRef(n); };
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
    cursor: bearbeitbar ? 'grab' : zuweisbar ? 'pointer' : 'default',
    // Rand und Polsterung aus den Konstanten, nicht als Literale: `AKTIONSZEILE_BREITE`
    // rechnet mit genau diesen Werten, und eine Kopie hier liesse den Deckel still falsch
    // rechnen, sobald jemand nur eine der beiden Stellen ändert.
    border: `${PLATZ_KARTE_RAND}px solid ${rollenFarbe(verfuegbarkeitVertrag[platz.verfuegbarkeit].rolle, token)}`,
    // Belegte Plätze: Hintergrund + „belegt"-Tag. „frei" und „belegt" schließen sich aus
    // (s. u. tag-Logik); andere Verfügbarkeiten (defekt/gesperrt/…) bleiben daneben sichtbar.
    // Theme-Tokens statt fixer Hex-Werte, damit die Karten im Dark Mode mitziehen.
    background: isOver ? token.colorPrimaryBg : belegtVon ? token.colorInfoBg : token.colorBgContainer,
    padding: PLATZ_KARTE_POLSTER,
    borderRadius: 4,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  // Verfügbarkeits-Optionen immer; „Platz löschen" ist eine Layout-/Setup-Aktion und
  // bleibt dem Bearbeiten-Modus vorbehalten. Das Menü selbst ist jedoch auch im
  // Nicht-Edit-Modus verfügbar (Verfügbarkeit ändern gehört zum laufenden Betrieb).
  const verfItems = [
    { key: 'frei', label: 'als frei markieren', icon: <CheckCircleOutlined /> },
    { key: 'defekt', label: 'als defekt markieren', icon: <ToolOutlined /> },
    { key: 'aufbereitung', label: 'als in Aufbereitung markieren', icon: <SyncOutlined /> },
    { key: 'gesperrt', label: 'als gesperrt markieren', icon: <LockOutlined /> },
  ];
  // „Patient zuweisen" steht auch im Menü — der Wurzelklick ist die Berührungsfläche, das
  // Menü der Tastaturweg. Im Fükw (Tastatur + Maus, der PRIMÄRE Einsatzkontext) wäre ein
  // reiner Wurzelklick nicht erreichbar. Ein eigener Knopf auf der Karte scheidet aus: die
  // Aktionszeile ist an SCHRITT_Y gedeckelt (Rechnung im Dateikopf).
  const menu = {
    items: [
      ...(zuweisbar ? [{ key: 'zuweisen', label: 'Patient zuweisen', icon: <UserAddOutlined /> }, { type: 'divider' as const }] : []),
      ...verfItems,
      ...(bearbeitbar ? [{ type: 'divider' as const }, { key: 'storno', label: 'Platz löschen', icon: <DeleteOutlined />, danger: true }] : []),
    ],
    autoFocus: true,
    // Das Dropdown rendert im Portal, sein Klick steigt aber im KOMPONENTEN-Baum auf und
    // erreicht damit den Wurzel-onClick dieser Karte (der gemessene Fall aus
    // LFH-365/MetaChip). Der Riegel dagegen sitzt NICHT hier: ein
    // `domEvent.stopPropagation()` in diesem Callback kommt zu spät und hält die
    // Ausbreitung nachweislich nicht auf — mit ihm allein bleibt der Regressionstest rot.
    // Wirksam ist der `click`-Riegel an der Aktionszeile unten, in deren Teilbaum das
    // Dropdown hängt. Wer den Auslöser von dort wegbewegt, muss den Riegel mitnehmen.
    onClick: ({ key }: { key: string }) => {
      if (key === 'zuweisen') onZuweisen();
      else if (key === 'storno') onStorno();
      else onVerfuegbarkeit(key as Verfuegbarkeit);
    },
  };
  // „frei" und „belegt" widersprechen sich — bei belegtem freien Platz nur „belegt" zeigen.
  // Echte Sonderzustände (defekt/aufbereitung/gesperrt/reserviert) bleiben auch belegt sichtbar.
  const zeigeVerfTag = !(belegtVon && platz.verfuegbarkeit === 'frei');
  // dnd-kit-Drag-Props NUR im Bearbeiten-Modus spreizen. Sonst setzt useDraggable (disabled)
  // role="button" + aria-disabled="true" auf die Karte → der ganze Subtree (inkl. der
  // Aktions-Buttons) gilt als deaktiviert (Screenreader + Tests können nicht klicken).
  const dragProps = bearbeitbar ? { ...attributes, ...listeners } : {};
  return (
    <div
      ref={setRef}
      data-testid="platz-karte"
      style={style}
      {...dragProps}
      onClick={zuweisbar ? onZuweisen : undefined}
    >
      {/* Titel: max. 2 Zeilen, dann Ellipsis (voller Name im Tooltip). Feste maxHeight,
          damit ein Umbruch die Karte NICHT vergrößert. */}
      <Typography.Text
        strong
        title={platz.bezeichnung}
        style={{
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
          overflow: 'hidden', lineHeight: '15px', fontSize: 13, maxHeight: 30,
        }}
      >
        {platz.bezeichnung}
      </Typography.Text>
      {/* Status-Tags: eine Zeile, kein Umbruch (feste Höhe). */}
      <div style={{ height: 24, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        {zeigeVerfTag && <StatusTag darstellung={verfuegbarkeitVertrag[platz.verfuegbarkeit]} />}
        {belegtVon && <Tag color="blue">belegt</Tag>}
      </div>
      {/* Belegung: feste Höhe reserviert, auch wenn leer → Karte bleibt gleich groß.
          Belegte Person ist ziehbar (→ Wartebereich links oder Transport rechts); im
          Bearbeiten-Modus deaktiviert, damit sie nicht mit dem Platz-Drag kollidiert. */}
      <div style={{ height: 24, overflow: 'hidden' }}>
        {belegtVon && <PersonenkarteDrag person={belegtVon} disabled={schreibgeschuetzt || bearbeitbar} kompakt onOeffnen={onOeffnen} />}
      </div>
      {/* Aktionszeile UNTER der Belegung als direkte Icon-Buttons (kein Menü); feste Höhe.
          DER `click`-RIEGEL DER KARTE SITZT HIER — einmal am Container statt an jedem
          Knopf. Die Knöpfe stoppen nur `pointerdown` (gegen den Drag-Start), und das hält
          den nachfolgenden `click` nicht auf. Der Container fängt beides: die direkten
          Knöpfe UND das Dropdown-Menü, dessen Portal-Klick im Komponentenbaum hier
          durchläuft. Ohne diese Zeile öffnete jeder Aktionsklick zusätzlich den
          Zuweisungsdialog — beide Regressionstests werden ohne sie rot (gemessen). */}
      <div
        style={{ display: 'flex', gap: aktionsabstand(token), height: 24, alignItems: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        {belegtVon && !schreibgeschuetzt && (
          <>
            <Tooltip title="Verbleib / Entlassung erfassen">
              {/* stopPropagation: sonst startet eine kleine Mausbewegung beim Klick einen Drag. */}
              <Button
                size="small"
                aria-label="Verbleib / Entlassung erfassen"
                icon={<CarOutlined />}
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
            <Button size="small" type="text" aria-label="Platzaktionen" onPointerDown={(e) => e.stopPropagation()}>…</Button>
          </Dropdown>
        )}
      </div>
    </div>
  );
}

/** Schmale Personen-Liste als Spalten-Karte (links: Eingang/Wartebereich). */
function PersonenSpalte({
  titel, personen, schreibgeschuetzt, droppableId, leerText, onOeffnen,
}: {
  titel: string;
  personen: Person[];
  schreibgeschuetzt: boolean;
  droppableId?: string;
  leerText: string;
  onOeffnen: (personId: number) => void;
}) {
  // Optionales Drop-Target (Wartebereich nimmt Personen ohne Platz auf).
  const drop = useDroppable({ id: droppableId ?? `nodrop-${titel}`, data: { kind: 'inbox' }, disabled: !droppableId });
  const { token } = theme.useToken();
  return (
    <Card
      title={titel}
      size="small"
      styles={{ body: { padding: 8 } }}
      style={{ background: droppableId && drop.isOver ? token.colorPrimaryBg : undefined }}
    >
      <div ref={droppableId ? drop.setNodeRef : undefined} style={{ minHeight: 48 }}>
        {personen.map((p) => <PersonenkarteDrag key={p.id} person={p} disabled={schreibgeschuetzt} onOeffnen={onOeffnen} />)}
        {personen.length === 0 && <Typography.Text type="secondary">{leerText}</Typography.Text>}
      </div>
    </Card>
  );
}

/** Rechte Spalte: aus DIESER UHS heraus auf Transport gebrachte Personen.
 *  Drop-Target: eine belegte Person hierher ziehen öffnet den Transport-Abschluss-Screen. */
function TransportSpalte({ personen, schreibgeschuetzt, onOeffnen }: { personen: Person[]; schreibgeschuetzt: boolean; onOeffnen: (personId: number) => void }) {
  const drop = useDroppable({ id: 'drop-transport', data: { kind: 'transport' }, disabled: schreibgeschuetzt });
  const { token } = theme.useToken();
  return (
    <Card
      title="Auf Transport gebracht"
      size="small"
      styles={{ body: { padding: 8 } }}
      style={{ background: !schreibgeschuetzt && drop.isOver ? token.colorPrimaryBg : undefined }}
    >
      <div ref={schreibgeschuetzt ? undefined : drop.setNodeRef} style={{ minHeight: 48 }}>
      {personen.map((p) => (
        <div key={p.id} style={{ marginBottom: 6 }}>
          <Tag color="orange" style={{ margin: 0, cursor: 'pointer' }} onClick={() => onOeffnen(p.id)}>{personLabel(p)}</Tag>
          {p.aktueller_verbleib && (
            <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.aktueller_verbleib}</Typography.Text></div>
          )}
        </div>
      ))}
      {personen.length === 0 && <Typography.Text type="secondary">keine</Typography.Text>}
      </div>
    </Card>
  );
}

/** Felder des Abschluss-Screens „Verbleib erfassen". */
type VerbleibWerte = { art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string };

/** Einziges Feld des Klick-Zuweisungswegs (LFH-367/B5g). */
type ZuweisenWerte = { personId: number };

export default function Grundriss({
  einsatzId, uhs, schreibgeschuetzt,
}: { einsatzId: number; uhs: UhsDetail; schreibgeschuetzt: boolean }) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  // Sensors: PointerSensor mit 5px-Aktivierungsdistanz (sonst klickt jeder Click den Drag aus),
  // KeyboardSensor für Tests/Accessibility.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

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
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const layoutMut = useMutation({
    mutationFn: ({ pid, pos_x, pos_y }: { pid: number; pos_x: number; pos_y: number }) =>
      aktualisierePlatz(einsatzId, uhs.id, pid, { pos_x, pos_y }),
    onSuccess: () => invalidate(), onError: fehler,
  });
  const belegMut = useMutation({
    mutationFn: ({ personId, platzId }: { personId: number; platzId: number | null }) => {
      const aktuell = personen.find((p) => p.id === personId);
      const art = aktuell?.aktuelle_uhs_id ? 'wechsel' : 'eintritt';
      return aenderePersonBelegung(einsatzId, personId, { art, uhs_id: uhs.id, platz_id: platzId });
    },
    onSuccess: () => invalidate(), onError: fehler,
  });
  const austrittMut = useMutation({
    mutationFn: (personId: number) => aenderePersonBelegung(einsatzId, personId, { art: 'austritt' }),
    onSuccess: () => invalidate(), onError: fehler,
  });
  // Verbleib erfassen (Transport / Entlassung / vor Ort / verstorben — wie in der
  // Patienten-Ansicht). Der Server trägt die Person dabei aus der UHS aus (Auto-Austritt);
  // bei Transport wandert sie rechts in „Auf Transport gebracht". status=abtransportiert
  // nur bei Transport (sonst null) — gleiche Semantik wie PersonenPage.
  const transportMut = useMutation({
    mutationFn: ({ personId, art, ziel, transportmittel, notiz }: VerbleibWerte & { personId: number }) =>
      erfasseVerbleib(einsatzId, personId, {
        art, ziel: ziel ?? null, transportmittel: transportmittel ?? null,
        status: art === 'transport' ? 'abtransportiert' : null, notiz: notiz ?? null,
      }),
    // Schliessen und Leeren macht die Erfassungshülle (onFertig bzw. ihr eigener Reset).
    onSuccess: () => { message.success('Verbleib erfasst'); invalidate(); },
    onError: fehler,
  });
  const verfMut = useMutation({
    mutationFn: ({ platzId, verf }: { platzId: number; verf: Verfuegbarkeit }) =>
      setzePlatzVerfuegbarkeit(einsatzId, uhs.id, platzId, verf, null),
    onSuccess: () => invalidate(), onError: fehler,
  });
  const stornoMut = useMutation({
    mutationFn: (platzId: number) => stornierePlatz(einsatzId, uhs.id, platzId),
    onSuccess: () => { message.success('Platz gelöscht'); invalidate(); }, onError: fehler,
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
    const data = active.data.current as { kind: string; personId?: number; platzId?: number } | undefined;
    if (!data) return;
    // Platz-Verschiebung: braucht kein Drop-Target — Layout-Fläche ist keine Droppable.
    // delta reicht; auf >= 0 clampen, damit die Karte nicht off-screen landen kann.
    if (data.kind === 'platz' && data.platzId != null) {
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

  const aktivePerson = aktivePersonId != null ? personen.find((p) => p.id === aktivePersonId) : undefined;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div style={{ display: 'flex', gap: 12, height: '100%', minHeight: 0, alignItems: 'stretch' }}>
        {/* LINKS: Eingang / Wartebereich */}
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          <PersonenSpalte
            titel="Noch nicht aufgenommen"
            personen={nichtAufgenommen}
            schreibgeschuetzt={schreibgeschuetzt}
            leerText="keine"
            onOeffnen={setDetailPersonId}
          />
          <PersonenSpalte
            titel="Wartebereich (Eingang)"
            personen={wartebereichPersonen}
            schreibgeschuetzt={schreibgeschuetzt}
            droppableId="drop-inbox"
            leerText="leer"
            onOeffnen={setDetailPersonId}
          />
        </div>

        {/* MITTE: Unfallhilfsstelle */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
            <Typography.Text strong>Unfallhilfsstelle</Typography.Text>
            {!schreibgeschuetzt && (
              uhs.status === 'geplant'
                ? <NeuerPlatzKnopf einsatzId={einsatzId} uhsId={uhs.id} primaer onSuccess={invalidate} />
                : (
                  <Space>
                    <Button
                      type={platzBearbeitung ? 'primary' : 'text'}
                      onClick={() => setPlatzBearbeitung((v) => !v)}
                    >
                      {platzBearbeitung ? 'Bearbeiten beenden' : 'Plätze bearbeiten'}
                    </Button>
                    {platzEditAktiv && <NeuerPlatzKnopf einsatzId={einsatzId} uhsId={uhs.id} onSuccess={invalidate} />}
                  </Space>
                )
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: `1px dashed ${token.colorBorder}`, background: token.colorBgLayout, borderRadius: 4 }}>
            <div style={{ position: 'relative', width: flaecheBreite, height: flaecheHoehe }}>
              {uhs.plaetze.map((p) => (
                <PlatzKarte
                  key={p.id}
                  platz={p}
                  belegtVon={belegtAn(p.id)}
                  schreibgeschuetzt={schreibgeschuetzt}
                  bearbeitbar={platzEditAktiv}
                  onVerfuegbarkeit={(v) => verfMut.mutate({ platzId: p.id, verf: v })}
                  onAustritt={() => { const b = belegtAn(p.id); if (b) austrittMut.mutate(b.id); }}
                  onTransport={() => { const b = belegtAn(p.id); if (b) setTransportPerson(b); }}
                  onStorno={() => stornoMut.mutate(p.id)}
                  onOeffnen={setDetailPersonId}
                  onZuweisen={() => {
                    // Ohne Kandidaten gar nicht erst öffnen: der Dialog trüge einen
                    // Primär-Knopf, der nichts erfasst und nur schliesst — eine tote
                    // Hauptaktion. Die Hülle kennt keinen Weg, ihn zu unterdrücken,
                    // und sie dafür umzubauen träfe alle ihre Aufrufer.
                    if (zuweisbarePersonen.length === 0) {
                      message.info('Niemand zuweisbar — im Wartebereich und unter „Noch nicht aufgenommen" steht derzeit niemand.');
                      return;
                    }
                    setZuweisenPlatz(p);
                  }}
                />
              ))}
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

        {/* RECHTS: Auf Transport gebracht */}
        <div style={{ width: 240, flexShrink: 0, overflow: 'auto' }}>
          <TransportSpalte personen={transportiert} schreibgeschuetzt={schreibgeschuetzt} onOeffnen={setDetailPersonId} />
        </div>
      </div>
      {/* Portal-Overlay: folgt dem Cursor auf Body-Ebene, beeinflusst keine Scroll-Region. */}
      <DragOverlay>
        {aktivePerson ? <Personenkarte person={aktivePerson} /> : null}
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
        titel={transportPerson ? `Verbleib erfassen — ${personLabel(transportPerson)}` : 'Verbleib erfassen'}
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
        <Form.Item label="Ziel (z. B. Krankenhaus, Freitext)" name="ziel"><Input /></Form.Item>
        <Form.Item label="Art" name="art" rules={[{ required: true }]}>
          <Select options={[
            { value: 'transport', label: 'Transport' },
            { value: 'entlassung', label: 'Entlassung vor Ort' },
            { value: 'vor_ort', label: 'verbleibt vor Ort' },
            { value: 'verstorben', label: 'Verbleib des Leichnams' },
          ]} />
        </Form.Item>
        <Form.Item label="Transportmittel (RTW/KTW …)" name="transportmittel"><Input /></Form.Item>
        <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
      </ErfassungsModal>

      {/* Klick-Zuweisungsweg (LFH-367/B5g): der Ersatz für das Ziehen auf den Platz.
          EIN Feld — das Feldbudget aus LFH-19 (Modal ≤ ~3) ist mit Abstand eingehalten;
          der Platz steht im Titel, nicht als zweites Feld. Kein Serienmodus: der Zielplatz
          ist je Vorgang ein anderer, ein „und nächste" hätte kein sinnvolles Nächstes. */}
      <ErfassungsModal<ZuweisenWerte>
        offen={zuweisenPlatz != null}
        titel={zuweisenPlatz ? `Patient zuweisen — ${zuweisenPlatz.bezeichnung}` : 'Patient zuweisen'}
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
      <PersonDetailDrawer einsatzId={einsatzId} personId={detailPersonId} onClose={() => setDetailPersonId(null)} />
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
function NeuerPlatzKnopf({ einsatzId, uhsId, onSuccess, primaer }: { einsatzId: number; uhsId: number; onSuccess: () => void; primaer?: boolean }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [typ, setTyp] = useState<PlatzTyp>('bett');
  const [menge, setMenge] = useState(1);
  const mut = useMutation({
    mutationFn: () => legePlaetzeAn(einsatzId, uhsId, { typ, menge }),
    onSuccess: (plaetze) => {
      message.success(plaetze.length === 1 ? 'Platz angelegt' : `${plaetze.length} Plätze angelegt`);
      setMenge(1); setOpen(false); onSuccess();
    },
    onError: (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });
  if (!open) {
    return <Button type={primaer ? 'primary' : 'default'} onClick={() => setOpen(true)}>Plätze anlegen</Button>;
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
      <Button type="primary" loading={mut.isPending} onClick={() => mut.mutate()}>Anlegen</Button>
      <Button onClick={() => setOpen(false)}>Abbrechen</Button>
    </Space>
  );
}
