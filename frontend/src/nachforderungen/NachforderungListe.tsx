import { Empty, List, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Nachforderung, NachforderungStatus } from '../api/types';

const PRIO_TAG: Record<string, { color: string; label: string }> = {
  sofort: { color: 'red', label: 'Sofort' },
  dringend: { color: 'orange', label: 'Dringend' },
  normal: { color: 'default', label: 'Normal' },
};
const STATUS_TAG: Record<string, { color: string; label: string }> = {
  angefordert: { color: 'default', label: 'Angefordert' },
  zugesagt: { color: 'processing', label: 'Zugesagt' },
  unterwegs: { color: 'blue', label: 'Unterwegs' },
  eingetroffen: { color: 'success', label: 'Eingetroffen' },
  abgelehnt: { color: 'red', label: 'Abgelehnt' },
};
const ADRESSAT_LABEL: Record<string, string> = {
  leitstelle: 'Leitstelle', nachbar_ea: 'Nachbar-EA', uebergeordnet: 'Übergeordnete Führung', andere_bos: 'Andere BOS',
};
/** Nächster linearer Status (für die Weiterschalten-Aktion). */
const NAECHSTER: Partial<Record<NachforderungStatus, NachforderungStatus>> = {
  angefordert: 'zugesagt', zugesagt: 'unterwegs', unterwegs: 'eingetroffen',
};

export interface NachforderungListeProps {
  nachforderungen: Nachforderung[];
  darfSchreiben?: boolean;
  onStatus?: (id: number, status: NachforderungStatus) => void;
  onAblehnen?: (id: number) => void;
}

export default function NachforderungListe({ nachforderungen, darfSchreiben, onStatus, onAblehnen }: NachforderungListeProps) {
  if (nachforderungen.length === 0) return <Empty description="Keine Nachforderungen" />;
  return (
    <List
      dataSource={nachforderungen}
      renderItem={(n) => {
        const prio = PRIO_TAG[n.prioritaet] ?? PRIO_TAG.normal;
        const status = STATUS_TAG[n.status] ?? STATUS_TAG.angefordert;
        const next = NAECHSTER[n.status];
        const aktionen: ReactNode[] = darfSchreiben && n.ist_offen
          ? [
              next && onStatus
                ? <a key="next" onClick={() => onStatus(n.id, next)}>→ {STATUS_TAG[next].label}</a> : null,
              onAblehnen
                ? <a key="ab" onClick={() => onAblehnen(n.id)}>Ablehnen</a> : null,
            ].filter(Boolean) as ReactNode[]
          : [];
        const menge = n.anzahl != null ? `${n.anzahl}× ` : '';
        return (
          <List.Item actions={aktionen.length ? aktionen : undefined}>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Tag color={prio.color}>{prio.label}</Tag>
                  <Tag color={status.color}>{status.label}</Tag>
                  <Typography.Text strong>{menge}{n.art}</Typography.Text>
                  <Typography.Text type="secondary">
                    → {ADRESSAT_LABEL[n.adressat_kategorie]}{n.adressat_bezeichnung ? ` (${n.adressat_bezeichnung})` : ''}
                  </Typography.Text>
                </Space>
              }
              description={
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Typography.Text>{n.bezeichnung}</Typography.Text>
                  {n.begruendung && <Typography.Text type="secondary">{n.begruendung}</Typography.Text>}
                  {n.status === 'abgelehnt' && n.abgelehnt_grund && (
                    <Typography.Text type="danger">Abgelehnt: {n.abgelehnt_grund}</Typography.Text>
                  )}
                </Space>
              }
            />
          </List.Item>
        );
      }}
    />
  );
}
