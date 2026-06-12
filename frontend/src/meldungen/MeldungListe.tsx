import { Empty, List, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Meldung, MeldungStatus } from '../api/types';

const PRIO_TAG: Record<string, { color: string; label: string }> = {
  sofort: { color: 'red', label: 'Sofort' },
  dringend: { color: 'orange', label: 'Dringend' },
  normal: { color: 'default', label: 'Normal' },
};
const STATUS_TAG: Record<string, { color: string; label: string }> = {
  neu: { color: 'blue', label: 'Neu' },
  gesichtet: { color: 'cyan', label: 'Gesichtet' },
  in_bearbeitung: { color: 'processing', label: 'In Bearbeitung' },
  erledigt: { color: 'success', label: 'Erledigt' },
};
const ART_LABEL: Record<string, string> = {
  lagemeldung: 'Lagemeldung', sofortmeldung: 'Sofortmeldung', rueckmeldung: 'Rückmeldung',
  vollzugsmeldung: 'Vollzugsmeldung', anfrage: 'Anfrage', sonstige: 'Sonstige',
};
const WEG_LABEL: Record<string, string> = {
  funk: 'Funk', telefon: 'Telefon', persoenlich: 'Persönlich', sonstige: 'Sonstige',
};

export interface MeldungListeProps {
  meldungen: Meldung[];
  darfSchreiben?: boolean;
  onStatus?: (meldungId: number, status: MeldungStatus) => void;
  onLagerelevant?: (meldungId: number) => void;
}

export default function MeldungListe({ meldungen, darfSchreiben, onStatus, onLagerelevant }: MeldungListeProps) {
  if (meldungen.length === 0) return <Empty description="Keine Meldungen" />;
  return (
    <List
      dataSource={meldungen}
      renderItem={(m) => {
        const prio = PRIO_TAG[m.prioritaet] ?? PRIO_TAG.normal;
        const status = STATUS_TAG[m.status] ?? STATUS_TAG.neu;
        const aktionen: ReactNode[] = darfSchreiben
          ? [
              m.status === 'neu' && onStatus
                ? <a key="si" onClick={() => onStatus(m.id, 'gesichtet')}>Sichten</a> : null,
              (m.status === 'neu' || m.status === 'gesichtet') && onStatus
                ? <a key="ib" onClick={() => onStatus(m.id, 'in_bearbeitung')}>In Bearbeitung</a> : null,
              m.status !== 'erledigt' && onStatus
                ? <a key="er" onClick={() => onStatus(m.id, 'erledigt')}>Erledigt</a> : null,
              !m.lagerelevant && onLagerelevant
                ? <a key="lr" onClick={() => onLagerelevant(m.id)}>An Lage übergeben</a> : null,
            ].filter(Boolean) as ReactNode[]
          : [];
        return (
          <List.Item actions={aktionen.length ? aktionen : undefined}>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Typography.Text type="secondary">#{m.lfd_nr}</Typography.Text>
                  <Tag color={prio.color}>{prio.label}</Tag>
                  <Typography.Text strong>{m.absender}</Typography.Text>
                  {m.empfaenger && <Typography.Text type="secondary">→ {m.empfaenger}</Typography.Text>}
                  {m.lagerelevant && <Tag color="gold">Lagerelevant ✓</Tag>}
                </Space>
              }
              description={
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space wrap size={[8, 4]}>
                    <Tag color={status.color}>{status.label}</Tag>
                    <Typography.Text type="secondary">{WEG_LABEL[m.meldeweg]} · {ART_LABEL[m.meldungsart]}</Typography.Text>
                    <Typography.Text type="secondary">Ereignis: {m.ereigniszeit} UTC</Typography.Text>
                    {m.bearbeiter_name && <Tag>Bearbeiter: {m.bearbeiter_name}</Tag>}
                  </Space>
                  <Typography.Text>{m.inhalt}</Typography.Text>
                </Space>
              }
            />
          </List.Item>
        );
      }}
    />
  );
}
