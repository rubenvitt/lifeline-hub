import { App, Button, Card, Dropdown, InputNumber, Select, Space, Tag, Typography } from 'antd';
import { DndContext, useDraggable, useDroppable, type DragEndEvent, KeyboardSensor, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  aenderePersonBelegung, aktualisierePlatz, legePlaetzeAn, setzePlatzVerfuegbarkeit, stornierePlatz,
} from '../../api/einsatzUhs';
import { listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import type { Person, PlatzTyp, UhsDetail, UhsPlatz, Verfuegbarkeit } from '../../api/types';
import { ApiError } from '../../api/client';

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

interface PersonenkartenProps { person: Person | undefined; }
function Personenkarte({ person }: PersonenkartenProps) {
  if (!person) return null;
  return <Tag color="default" style={{ margin: 2 }}>{personLabel(person)}</Tag>;
}

function PersonenkarteDrag({ person, disabled }: { person: Person; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `person-${person.id}`, data: { kind: 'person', personId: person.id }, disabled,
  });
  const style: React.CSSProperties = {
    cursor: disabled ? 'default' : 'grab',
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={style}>
      <Personenkarte person={person} />
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
  onStorno: () => void;
}

function PlatzKarte({ platz, belegtVon, schreibgeschuetzt, bearbeitbar, onVerfuegbarkeit, onAustritt, onStorno }: PlatzKarteProps) {
  // Platz-Karte ist Drop-Target (Personen zuweisen) und — nur im Bearbeiten-Modus —
  // Drag-Source (Layout verschieben). Mit @dnd-kit beides am selben Knoten.
  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: `platz-${platz.id}`, data: { kind: 'platz', platzId: platz.id }, disabled: !bearbeitbar,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-platz-${platz.id}`, data: { kind: 'platz', platzId: platz.id, uhsId: platz.uhs_id },
  });
  const setRef = (n: HTMLDivElement | null) => { setDragRef(n); setDropRef(n); };
  const style: React.CSSProperties = {
    position: 'absolute',
    left: platz.pos_x ?? 10,
    top: platz.pos_y ?? 10,
    width: 140,
    cursor: bearbeitbar ? 'grab' : 'default',
    border: `2px solid ${VERF_FARBE[platz.verfuegbarkeit]}`,
    // Belegung ist orthogonal zur Verfügbarkeit (Spec): Verfügbarkeits-Rahmen bleibt,
    // belegte Plätze werden zusätzlich durch Hintergrund + „belegt"-Tag kenntlich gemacht.
    background: isOver ? '#e6f4ff' : belegtVon ? '#f0f5ff' : 'white',
    padding: 6,
    borderRadius: 4,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  const menu = {
    items: [
      { key: 'frei', label: 'als frei markieren' },
      { key: 'defekt', label: 'als defekt markieren' },
      { key: 'aufbereitung', label: 'als in Aufbereitung markieren' },
      { key: 'gesperrt', label: 'als gesperrt markieren' },
      { type: 'divider' as const },
      { key: 'storno', label: 'Platz löschen', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'storno') onStorno();
      else onVerfuegbarkeit(key as Verfuegbarkeit);
    },
  };
  return (
    <div ref={setRef} style={style} {...attributes} {...listeners}>
      <Typography.Text strong>{platz.bezeichnung}</Typography.Text>
      <div>
        <Tag color={VERF_FARBE[platz.verfuegbarkeit]}>{platz.verfuegbarkeit}</Tag>
        {belegtVon && <Tag color="blue">belegt</Tag>}
      </div>
      <Personenkarte person={belegtVon} />
      {belegtVon && !schreibgeschuetzt && (
        // Person aus dem Platz (und der UHS) zurückweisen = Austritt (Spec-BelegungsArt).
        <Button
          size="small"
          danger
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onAustritt}
        >
          zurückweisen
        </Button>
      )}
      {bearbeitbar && (
        <Dropdown menu={menu} trigger={['click']}>
          {/* stopPropagation: sonst startet eine kleine Mausbewegung beim Klick aufs "…" einen Drag. */}
          <Button size="small" type="text" onPointerDown={(e) => e.stopPropagation()}>…</Button>
        </Dropdown>
      )}
    </div>
  );
}

/** Schmale Personen-Liste als Spalten-Karte (links: Eingang/Wartebereich). */
function PersonenSpalte({
  titel, personen, schreibgeschuetzt, droppableId, leerText,
}: {
  titel: string;
  personen: Person[];
  schreibgeschuetzt: boolean;
  droppableId?: string;
  leerText: string;
}) {
  // Optionales Drop-Target (Wartebereich nimmt Personen ohne Platz auf).
  const drop = useDroppable({ id: droppableId ?? `nodrop-${titel}`, data: { kind: 'inbox' }, disabled: !droppableId });
  return (
    <Card
      title={titel}
      size="small"
      styles={{ body: { padding: 8 } }}
      style={{ background: droppableId && drop.isOver ? '#e6f4ff' : undefined }}
    >
      <div ref={droppableId ? drop.setNodeRef : undefined} style={{ minHeight: 48 }}>
        {personen.map((p) => <PersonenkarteDrag key={p.id} person={p} disabled={schreibgeschuetzt} />)}
        {personen.length === 0 && <Typography.Text type="secondary">{leerText}</Typography.Text>}
      </div>
    </Card>
  );
}

/** Rechte Spalte: aus DIESER UHS heraus auf Transport gebrachte Personen (read-only). */
function TransportSpalte({ personen }: { personen: Person[] }) {
  return (
    <Card title="Auf Transport gebracht" size="small" styles={{ body: { padding: 8 } }}>
      {personen.map((p) => (
        <div key={p.id} style={{ marginBottom: 6 }}>
          <Tag color="orange" style={{ margin: 0 }}>{personLabel(p)}</Tag>
          {p.aktueller_verbleib && (
            <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.aktueller_verbleib}</Typography.Text></div>
          )}
        </div>
      ))}
      {personen.length === 0 && <Typography.Text type="secondary">keine</Typography.Text>}
    </Card>
  );
}

export default function Grundriss({
  einsatzId, uhs, schreibgeschuetzt,
}: { einsatzId: number; uhs: UhsDetail; schreibgeschuetzt: boolean }) {
  const qc = useQueryClient();
  const { message } = App.useApp();
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

  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', einsatzId],
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
    qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-uhs-detail', einsatzId, uhs.id] });
    qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
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
  const verfMut = useMutation({
    mutationFn: ({ platzId, verf }: { platzId: number; verf: Verfuegbarkeit }) =>
      setzePlatzVerfuegbarkeit(einsatzId, uhs.id, platzId, verf, null),
    onSuccess: () => invalidate(), onError: fehler,
  });
  const stornoMut = useMutation({
    mutationFn: (platzId: number) => stornierePlatz(einsatzId, uhs.id, platzId),
    onSuccess: () => { message.success('Platz gelöscht'); invalidate(); }, onError: fehler,
  });

  function onDragEnd(event: DragEndEvent) {
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
    // Person-Drop: braucht ein Drop-Target (Platz oder Wartebereich).
    if (data.kind === 'person' && data.personId != null) {
      const target = over?.data.current as { kind: string; platzId?: number } | undefined;
      if (!target) return;
      if (target.kind === 'inbox') belegMut.mutate({ personId: data.personId, platzId: null });
      else if (target.kind === 'platz' && target.platzId != null) {
        belegMut.mutate({ personId: data.personId, platzId: target.platzId });
      }
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div style={{ display: 'flex', gap: 12, height: '100%', minHeight: 0, alignItems: 'stretch' }}>
        {/* LINKS: Eingang / Wartebereich */}
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          <PersonenSpalte
            titel="Noch nicht aufgenommen"
            personen={nichtAufgenommen}
            schreibgeschuetzt={schreibgeschuetzt}
            leerText="keine"
          />
          <PersonenSpalte
            titel="Wartebereich (Eingang)"
            personen={wartebereichPersonen}
            schreibgeschuetzt={schreibgeschuetzt}
            droppableId="drop-inbox"
            leerText="leer"
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
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px dashed #d9d9d9', background: '#fafafa', borderRadius: 4 }}>
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
                  onStorno={() => stornoMut.mutate(p.id)}
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
          <TransportSpalte personen={transportiert} />
        </div>
      </div>
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
