import { Card, Tag, Typography } from 'antd';
import { useDraggable } from '@dnd-kit/core';
import type { Person } from '../../api/types';
import { registrierAnzeige } from '../../api/einsatzPerson';

function DragPerson({ person, disabled }: { person: Person; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `person-${person.id}`, data: { kind: 'person', personId: person.id }, disabled,
  });
  const label = person.name
    ? `${registrierAnzeige(person.registrier_nr)} · ${person.name}`
    : `${registrierAnzeige(person.registrier_nr)} · unbekannt`;
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
         style={{ cursor: disabled ? 'default' : 'grab', marginBottom: 4,
                  transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}>
      <Tag>{label}</Tag>
    </div>
  );
}

export default function PersonenOhneUhsSidebar({
  personen, schreibgeschuetzt,
}: { personen: Person[]; schreibgeschuetzt: boolean }) {
  return (
    <Card title="Personen ohne UHS" size="small" style={{ width: 220, minHeight: 400 }}>
      {personen.map((p) => <DragPerson key={p.id} person={p} disabled={schreibgeschuetzt} />)}
      {personen.length === 0 && <Typography.Text type="secondary">keine</Typography.Text>}
    </Card>
  );
}
