import { App, Button, Card, Dropdown, Popconfirm, Space, Tag, Typography } from 'antd';
import { DndContext, useDraggable, useDroppable, type DragEndEvent, KeyboardSensor, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  aenderePersonBelegung, aktualisierePlatz, legePlatzAn, setzePlatzVerfuegbarkeit, stornierePlatz,
} from '../../api/einsatzUhs';
import { listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import type { Person, UhsDetail, UhsPlatz, Verfuegbarkeit } from '../../api/types';
import PersonenOhneUhsSidebar from './PersonenOhneUhsSidebar';
import { ApiError } from '../../api/client';

const VERF_FARBE: Record<Verfuegbarkeit, string> = {
  frei: '#52c41a',
  defekt: '#ff4d4f',
  aufbereitung: '#faad14',
  gesperrt: '#bfbfbf',
  reserviert: '#1677ff',
};

interface PersonenkartenProps { person: Person | undefined; }
function Personenkarte({ person }: PersonenkartenProps) {
  if (!person) return null;
  const label = person.name ? `${registrierAnzeige(person.registrier_nr)} · ${person.name}` : `${registrierAnzeige(person.registrier_nr)} · unbekannt`;
  return <Tag color="default" style={{ margin: 2 }}>{label}</Tag>;
}

interface PlatzKarteProps {
  platz: UhsPlatz;
  belegtVon: Person | undefined;
  schreibgeschuetzt: boolean;
  onVerfuegbarkeit: (v: Verfuegbarkeit) => void;
  onStorno: () => void;
}

function PlatzKarte({ platz, belegtVon, schreibgeschuetzt, onVerfuegbarkeit, onStorno }: PlatzKarteProps) {
  // Platz-Karte ist sowohl Drop-Target (Personen darauf droppen) als auch
  // Drag-Source (Layout-Verschiebung). Mit @dnd-kit beides am selben Knoten via useDraggable + useDroppable.
  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: `platz-${platz.id}`, data: { kind: 'platz', platzId: platz.id }, disabled: schreibgeschuetzt,
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
    border: `2px solid ${VERF_FARBE[platz.verfuegbarkeit]}`,
    background: isOver ? '#e6f4ff' : 'white',
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
      <div><Tag color={VERF_FARBE[platz.verfuegbarkeit]}>{platz.verfuegbarkeit}</Tag></div>
      <Personenkarte person={belegtVon} />
      {!schreibgeschuetzt && (
        <Dropdown menu={menu} trigger={['click']}>
          {/* stopPropagation: sonst startet eine kleine Mausbewegung beim Klick aufs "…" einen Drag. */}
          <Button size="small" type="text" onPointerDown={(e) => e.stopPropagation()}>…</Button>
        </Dropdown>
      )}
    </div>
  );
}

function InboxContainer({ personen, schreibgeschuetzt }: { personen: Person[]; schreibgeschuetzt: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-inbox', data: { kind: 'inbox' } });
  return (
    <Card
      title="Inbox (Eingang)"
      size="small"
      style={{ width: 220, minHeight: 400, background: isOver ? '#e6f4ff' : undefined }}
    >
      <div ref={setNodeRef} style={{ minHeight: 300 }}>
        {personen.map((p) => <PersonenkarteDrag key={p.id} person={p} disabled={schreibgeschuetzt} />)}
        {personen.length === 0 && <Typography.Text type="secondary">leer</Typography.Text>}
      </div>
    </Card>
  );
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

export default function Grundriss({
  einsatzId, uhs, schreibgeschuetzt,
}: { einsatzId: number; uhs: UhsDetail; schreibgeschuetzt: boolean }) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  // Sensors: PointerSensor mit 5px-Aktivierungsdistanz (sonst klickt jeder Click den Drag aus),
  // KeyboardSensor für Tests/Accessibility.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', einsatzId],
    queryFn: () => listePersonen(einsatzId),
  });
  const personen = personenQuery.data ?? [];
  const personenInUhs = personen.filter((p) => p.aktuelle_uhs_id === uhs.id);
  const inboxPersonen = personenInUhs.filter((p) => p.aktueller_platz_id == null);
  function belegtAn(platzId: number): Person | undefined {
    return personenInUhs.find((p) => p.aktueller_platz_id === platzId);
  }

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
    // Person-Drop: braucht ein Drop-Target (Platz oder Inbox).
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
      <Space align="start">
        <InboxContainer personen={inboxPersonen} schreibgeschuetzt={schreibgeschuetzt} />
        <div style={{ position: 'relative', width: 520, height: 400, border: '1px dashed #d9d9d9', background: '#fafafa' }}>
          {uhs.plaetze.map((p) => (
            <PlatzKarte
              key={p.id}
              platz={p}
              belegtVon={belegtAn(p.id)}
              schreibgeschuetzt={schreibgeschuetzt}
              onVerfuegbarkeit={(v) => verfMut.mutate({ platzId: p.id, verf: v })}
              onStorno={() => stornoMut.mutate(p.id)}
            />
          ))}
          {uhs.plaetze.length === 0 && (
            <Typography.Text type="secondary" style={{ padding: 10, display: 'block' }}>
              Keine Plätze. Lege Plätze über das „+"-Menü an.
            </Typography.Text>
          )}
        </div>
        <PersonenOhneUhsSidebar
          personen={personen.filter((p) => p.aktuelle_uhs_id == null && !p.storniert_at)}
          schreibgeschuetzt={schreibgeschuetzt}
        />
      </Space>
      {!schreibgeschuetzt && (
        <NeuerPlatzKnopf einsatzId={einsatzId} uhsId={uhs.id} onSuccess={invalidate} />
      )}
    </DndContext>
  );
}

function NeuerPlatzKnopf({ einsatzId, uhsId, onSuccess }: { einsatzId: number; uhsId: number; onSuccess: () => void }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [bez, setBez] = useState('');
  const mut = useMutation({
    mutationFn: () => legePlatzAn(einsatzId, uhsId, { typ: 'bett', bezeichnung: bez }),
    onSuccess: () => { message.success('Platz angelegt'); setBez(''); setOpen(false); onSuccess(); },
    onError: (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });
  return (
    <Popconfirm
      title="Neuen Platz anlegen"
      description={
        <input value={bez} onChange={(e) => setBez(e.target.value)}
               placeholder="Bezeichnung (z. B. Bett 3)" autoFocus />
      }
      open={open}
      onOpenChange={setOpen}
      onConfirm={() => mut.mutate()}
      okButtonProps={{ disabled: !bez.trim() }}
    >
      <Button style={{ marginTop: 8 }}>+ Platz</Button>
    </Popconfirm>
  );
}
