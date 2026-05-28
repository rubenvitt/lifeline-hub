import { Table, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import type { UhsBelegung, UhsDetail, BelegungsArt } from '../../api/types';

const ART_FARBE: Record<BelegungsArt, string> = {
  eintritt: 'green',
  wechsel: 'blue',
  austritt: 'orange',
};

const ART_LABEL: Record<BelegungsArt, string> = {
  eintritt: 'Eintritt',
  wechsel: 'Wechsel',
  austritt: 'Austritt',
};

interface Props {
  uhs: UhsDetail;
}

export default function BewegungenTab({ uhs }: Props) {
  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', uhs.einsatz_id],
    queryFn: () => listePersonen(uhs.einsatz_id),
  });

  const personen = personenQuery.data ?? [];
  const personenById = new Map(personen.map((p) => [p.id, p]));
  const plaetzeById = new Map(uhs.plaetze.map((pl) => [pl.id, pl]));

  const columns = [
    {
      title: 'Zeit',
      dataIndex: 'zeitpunkt_at',
      key: 'zeitpunkt_at',
      render: (v: string) => new Date(v).toLocaleString('de-DE'),
    },
    {
      title: 'Person',
      dataIndex: 'person_id',
      key: 'person_id',
      render: (personId: number) => {
        const person = personenById.get(personId);
        if (!person) return `#${personId}`;
        return person.name
          ? `${registrierAnzeige(person.registrier_nr)} · ${person.name}`
          : registrierAnzeige(person.registrier_nr);
      },
    },
    {
      title: 'Art',
      dataIndex: 'art',
      key: 'art',
      render: (art: BelegungsArt) => (
        <Tag color={ART_FARBE[art]}>{ART_LABEL[art]}</Tag>
      ),
    },
    {
      title: 'Platz',
      dataIndex: 'platz_id',
      key: 'platz_id',
      render: (platzId: number | null) => {
        if (platzId == null) return 'Inbox';
        const platz = plaetzeById.get(platzId);
        return platz ? platz.bezeichnung : 'Inbox';
      },
    },
    {
      title: 'Notiz',
      dataIndex: 'notiz',
      key: 'notiz',
      render: (v: string | null) => v ?? '—',
    },
  ];

  return (
    <Table<UhsBelegung>
      rowKey="id"
      dataSource={uhs.belegungen}
      columns={columns}
      size="small"
      pagination={false}
      locale={{ emptyText: 'Keine Bewegungen erfasst' }}
      loading={personenQuery.isLoading}
    />
  );
}
