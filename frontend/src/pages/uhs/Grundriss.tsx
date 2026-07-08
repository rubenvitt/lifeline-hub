import { App, Button, Card, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Tag, Tooltip, Typography, theme } from 'antd';
import {
  CarOutlined, CheckCircleOutlined, DeleteOutlined, LockOutlined, LogoutOutlined,
  SyncOutlined, ToolOutlined,
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

// Feste Karten-Höhe. Muss unter dem Raster-Zeilenabstand (raster_position SCHRITT_Y=120
// im Backend) bleiben, damit absolut platzierte Karten einander nicht überlappen, und
// groß genug für den Worst Case (2-zeiliger Titel + Tag + Belegung + Aktionszeile).
const PLATZ_KARTE_HOEHE = 116;

const VERF_FARBE: Record<Verfuegbarkeit, string> = {
  frei: '#52c41a',
  defekt: '#ff4d4f',
  aufbereitung: '#faad14',
  gesperrt: '#bfbfbf',
  reserviert: '#1677ff',
};

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
}

function PlatzKarte({ platz, belegtVon, schreibgeschuetzt, bearbeitbar, onVerfuegbarkeit, onAustritt, onTransport, onStorno, onOeffnen }: PlatzKarteProps) {
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
  const style: React.CSSProperties = {
    position: 'absolute',
    left: platz.pos_x ?? 10,
    top: platz.pos_y ?? 10,
    width: 140,
    // FESTE Höhe + overflow:hidden: die Kartengröße ist invariant gegen Belegung, Titel-
    // Umbruch und Tag-Anzahl (Titel/Tags/Person/Aktionen sind unten je auf feste Höhe
    // gedeckelt). Alle Karten eines Rasters sind damit exakt gleich groß und bleiben unter
    // dem Raster-Zeilenabstand (120px) → keine Überlappung mit der Karte darunter.
    height: PLATZ_KARTE_HOEHE,
    overflow: 'hidden',
    boxSizing: 'border-box',
    cursor: bearbeitbar ? 'grab' : 'default',
    border: `2px solid ${VERF_FARBE[platz.verfuegbarkeit]}`,
    // Belegte Plätze: Hintergrund + „belegt"-Tag. „frei" und „belegt" schließen sich aus
    // (s. u. tag-Logik); andere Verfügbarkeiten (defekt/gesperrt/…) bleiben daneben sichtbar.
    // Theme-Tokens statt fixer Hex-Werte, damit die Karten im Dark Mode mitziehen.
    background: isOver ? token.colorPrimaryBg : belegtVon ? token.colorInfoBg : token.colorBgContainer,
    padding: 6,
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
  const menu = {
    items: bearbeitbar
      ? [...verfItems, { type: 'divider' as const }, { key: 'storno', label: 'Platz löschen', icon: <DeleteOutlined />, danger: true }]
      : verfItems,
    onClick: ({ key }: { key: string }) => {
      if (key === 'storno') onStorno();
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
    <div ref={setRef} data-testid="platz-karte" style={style} {...dragProps}>
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
        {zeigeVerfTag && <Tag color={VERF_FARBE[platz.verfuegbarkeit]}>{platz.verfuegbarkeit}</Tag>}
        {belegtVon && <Tag color="blue">belegt</Tag>}
      </div>
      {/* Belegung: feste Höhe reserviert, auch wenn leer → Karte bleibt gleich groß.
          Belegte Person ist ziehbar (→ Wartebereich links oder Transport rechts); im
          Bearbeiten-Modus deaktiviert, damit sie nicht mit dem Platz-Drag kollidiert. */}
      <div style={{ height: 24, overflow: 'hidden' }}>
        {belegtVon && <PersonenkarteDrag person={belegtVon} disabled={schreibgeschuetzt || bearbeitbar} kompakt onOeffnen={onOeffnen} />}
      </div>
      {/* Aktionszeile UNTER der Belegung als direkte Icon-Buttons (kein Menü); feste Höhe. */}
      <div style={{ display: 'flex', gap: 4, height: 24, alignItems: 'center' }}>
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
  const [transportForm] = Form.useForm<{ art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string }>();

  // Klick auf eine Patientenkarte öffnet den schlanken Detail-Drawer (nur ansehen).
  const [detailPersonId, setDetailPersonId] = useState<number | null>(null);

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
    mutationFn: ({ personId, art, ziel, transportmittel, notiz }: { personId: number; art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string }) =>
      erfasseVerbleib(einsatzId, personId, {
        art, ziel: ziel ?? null, transportmittel: transportmittel ?? null,
        status: art === 'transport' ? 'abtransportiert' : null, notiz: notiz ?? null,
      }),
    onSuccess: () => { message.success('Verbleib erfasst'); setTransportPerson(null); transportForm.resetFields(); invalidate(); },
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
                      size="small"
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
          Platz-Button und vom Drag auf „Auf Transport gebracht" vorbelegt). */}
      <Modal
        open={transportPerson != null}
        title={transportPerson ? `Verbleib erfassen — ${personLabel(transportPerson)}` : 'Verbleib erfassen'}
        okText="Erfassen"
        confirmLoading={transportMut.isPending}
        onOk={() => transportForm.submit()}
        onCancel={() => { setTransportPerson(null); transportForm.resetFields(); }}
        destroyOnHidden
      >
        <Form
          form={transportForm}
          layout="vertical"
          initialValues={{ art: 'transport' }}
          onFinish={(v) => { if (transportPerson) transportMut.mutate({ personId: transportPerson.id, ...v }); }}
        >
          <Form.Item label="Art" name="art" rules={[{ required: true }]}>
            <Select options={[
              { value: 'transport', label: 'Transport' },
              { value: 'entlassung', label: 'Entlassung vor Ort' },
              { value: 'vor_ort', label: 'verbleibt vor Ort' },
              { value: 'verstorben', label: 'Verbleib des Leichnams' },
            ]} />
          </Form.Item>
          <Form.Item label="Ziel (z. B. Krankenhaus, Freitext)" name="ziel"><Input /></Form.Item>
          <Form.Item label="Transportmittel (RTW/KTW …)" name="transportmittel"><Input /></Form.Item>
          <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

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
    return <Button size="small" type={primaer ? 'primary' : 'default'} onClick={() => setOpen(true)}>Plätze anlegen</Button>;
  }
  return (
    <Space align="center" wrap>
      <Select<PlatzTyp>
        value={typ}
        onChange={setTyp}
        options={PLATZ_TYPEN}
        style={{ width: 200 }}
        aria-label="Platz-Typ"
        size="small"
      />
      <InputNumber
        min={1}
        max={50}
        value={menge}
        onChange={(v) => setMenge(v ?? 1)}
        aria-label="Menge"
        size="small"
      />
      <Button size="small" type="primary" loading={mut.isPending} onClick={() => mut.mutate()}>Anlegen</Button>
      <Button size="small" onClick={() => setOpen(false)}>Abbrechen</Button>
    </Space>
  );
}
