import { Table } from 'antd';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import { einsatzKeys } from '../../api/queryKeys';
import { personDetailPfad } from '../../routing/deeplinks';
import type { UhsBelegung, UhsDetail, BelegungsArt } from '../../api/types';
import StatusTag from '../../components/StatusTag';
import { belegungsArt } from '../../theme/statusFarben';

interface Props {
  uhs: UhsDetail;
}

export default function BewegungenTab({ uhs }: Props) {
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(uhs.einsatz_id),
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
      render: (v: string) => <ZeitAnzeige wert={v} format="dtgVoll" />,
    },
    {
      title: 'Person',
      dataIndex: 'person_id',
      key: 'person_id',
      render: (personId: number) => {
        const person = personenById.get(personId);
        // Aufgelöste Person → Deeplink auf die Detailseite (LFH-25). Unbekannte/nicht
        // geladene Person bleibt unverlinkter Fallback (#id, kein garantiertes Ziel).
        if (!person) return `#${personId}`;
        const label = person.name
          ? `${registrierAnzeige(person.registrier_nr)} · ${person.name}`
          : registrierAnzeige(person.registrier_nr);
        return <Link to={personDetailPfad(uhs.einsatz_id, personId)}>{label}</Link>;
      },
    },
    {
      title: 'Art',
      dataIndex: 'art',
      key: 'art',
      render: (art: BelegungsArt) => (
        <StatusTag darstellung={belegungsArt[art]} />
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
