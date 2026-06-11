import { Empty, List, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Auftrag } from '../api/types';

const PRIO_TAG: Record<string, { color: string; label: string }> = {
  sofort: { color: 'red', label: 'Sofort' },
  dringend: { color: 'orange', label: 'Dringend' },
  normal: { color: 'default', label: 'Normal' },
};
const BEARB_TAG: Record<string, { color: string; label: string }> = {
  offen: { color: 'default', label: 'Offen' },
  in_arbeit: { color: 'processing', label: 'In Bearbeitung' },
  vollzogen: { color: 'success', label: 'Vollzogen' },
  abgenommen: { color: 'green', label: 'Abgenommen' },
};

export interface AuftragListeProps {
  auftraege: Auftrag[];
  darfSchreiben?: boolean;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
  onInArbeit?: (auftragId: number) => void;
  onVollzugMelden?: (auftragId: number) => void;
  onAbnehmen?: (auftragId: number) => void;
}

export default function AuftragListe({
  auftraege, darfSchreiben, onQuittieren, onInArbeit, onVollzugMelden, onAbnehmen,
}: AuftragListeProps) {
  if (auftraege.length === 0) return <Empty description="Keine Aufträge" />;
  return (
    <List
      dataSource={auftraege}
      renderItem={(a) => {
        const prio = PRIO_TAG[a.prioritaet] ?? PRIO_TAG.normal;
        const bearb = BEARB_TAG[a.bearbeitungsstatus] ?? BEARB_TAG.offen;
        const alleQuittiert = a.empfaenger_anzahl > 0 && a.quittiert_anzahl === a.empfaenger_anzahl;
        const aktionen: ReactNode[] = darfSchreiben
          ? [
              a.bearbeitungsstatus === 'offen' && onInArbeit
                ? <a key="ia" onClick={() => onInArbeit(a.id)}>In Bearbeitung</a> : null,
              (a.bearbeitungsstatus === 'offen' || a.bearbeitungsstatus === 'in_arbeit') && onVollzugMelden
                ? <a key="vm" onClick={() => onVollzugMelden(a.id)}>Vollzug melden</a> : null,
              a.bearbeitungsstatus === 'vollzogen' && onAbnehmen
                ? <a key="ab" onClick={() => onAbnehmen(a.id)}>Abnehmen</a> : null,
            ].filter(Boolean) as ReactNode[]
          : [];
        return (
          <List.Item
            style={a.ist_ueberfaellig ? { background: '#fff1f0', borderInlineStart: '3px solid #ff4d4f', paddingInlineStart: 8 } : undefined}
            actions={aktionen.length ? aktionen : undefined}
          >
            <List.Item.Meta
              title={
                <Space wrap>
                  <Tag color={prio.color}>{prio.label}</Tag>
                  <Typography.Text strong>{a.auftrag_text}</Typography.Text>
                  {a.ist_ueberfaellig && <Tag color="error">Überfällig</Tag>}
                </Space>
              }
              description={
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space wrap size={[8, 4]}>
                    <Tag color={bearb.color}>{bearb.label}</Tag>
                    <Tag color={alleQuittiert ? 'success' : 'warning'}>
                      Quittiert {a.quittiert_anzahl}/{a.empfaenger_anzahl}
                    </Tag>
                    {a.frist_at && <Typography.Text type="secondary">Frist: {a.frist_at} UTC</Typography.Text>}
                  </Space>
                  <div>
                    {a.empfaenger.map((emp) => (
                      <Tag key={emp.id} color={emp.quittiert_at ? 'success' : 'default'} style={{ marginBottom: 4 }}>
                        {emp.snap_anzeige}{emp.quittiert_at ? ' ✓' : ''}
                        {darfSchreiben && !emp.quittiert_at && onQuittieren && (
                          <Typography.Link style={{ marginInlineStart: 6 }} onClick={() => onQuittieren(a.id, emp.id)}>
                            quittieren
                          </Typography.Link>
                        )}
                      </Tag>
                    ))}
                  </div>
                  {a.vollzugsmeldung && (
                    <Typography.Text type="secondary">Vollzug: {a.vollzugsmeldung}</Typography.Text>
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
