import { Button, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { EtbEintragAnzeige } from '../api/types';
import { TYP_FARBE, TYP_LABEL, istNachgetragen } from './typFarben';

interface Props {
  eintraege: EtbEintragAnzeige[];
  /** Wenn gesetzt, erscheint je Eintrag eine „Berichtigen"-Aktion. */
  onBerichtigen?: (eintrag: EtbEintragAnzeige) => void;
}

export default function EtbTabelle({ eintraege, onBerichtigen }: Props) {
  // Map id → lfd_nr, um Berichtigungs-Ziele auf ihre laufende Nummer aufzulösen.
  const lfdNrVonId = new Map(eintraege.map((e) => [e.id, e.lfd_nr]));

  // Map Original-id → lfd_nr der Berichtigung, für den Rückverweis am Originaleintrag.
  const berichtigtDurch = new Map<number, number>();
  for (const e of eintraege) {
    if (e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null) {
      berichtigtDurch.set(e.berichtigt_eintrag_id, e.lfd_nr);
    }
  }

  const spalten: ColumnsType<EtbEintragAnzeige> = [
    { title: 'Nr.', dataIndex: 'lfd_nr', width: 64 },
    {
      title: 'Ereigniszeit',
      key: 'ereigniszeit',
      width: 180,
      render: (_, e) => (
        <Space size={4}>
          <span>{e.ereigniszeit}</span>
          {istNachgetragen(e.ereigniszeit, e.received_at) && (
            <Tooltip title={`Nachgetragen — Server-Empfang: ${e.received_at}`}>
              <span aria-label="nachgetragen">⧖</span>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Typ',
      dataIndex: 'typ',
      width: 130,
      render: (_, e) => <Tag color={TYP_FARBE[e.typ]}>{TYP_LABEL[e.typ]}</Tag>,
    },
    {
      title: 'Von → An',
      key: 'vonan',
      width: 160,
      render: (_, e) => (e.von || e.an ? `${e.von ?? '—'} → ${e.an ?? '—'}` : '—'),
    },
    {
      title: 'Inhalt',
      dataIndex: 'inhalt',
      render: (_, e) => (
        <span>
          {e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null && (
            <Tag color="red">berichtigt #{lfdNrVonId.get(e.berichtigt_eintrag_id) ?? '?'}</Tag>
          )}
          {berichtigtDurch.has(e.id) && (
            <Tag color="gold">berichtigt durch #{berichtigtDurch.get(e.id)}</Tag>
          )}
          {e.inhalt}
        </span>
      ),
    },
    { title: 'Erfasser', dataIndex: 'erfasser_name', width: 120 },
  ];

  if (onBerichtigen) {
    spalten.push({
      title: '',
      key: 'aktion',
      width: 110,
      render: (_, e) =>
        e.typ === 'berichtigung' ? null : (
          <Button type="link" size="small" onClick={() => onBerichtigen(e)}>
            Berichtigen
          </Button>
        ),
    });
  }

  return (
    <Table
      rowKey="id"
      size="small"
      columns={spalten}
      dataSource={eintraege}
      pagination={false}
      rowClassName={(e) => (e.typ === 'berichtigung' ? 'etb-berichtigung' : '')}
    />
  );
}
