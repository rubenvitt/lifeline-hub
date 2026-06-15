import { Button, Collapse, Descriptions, Empty, List, Popconfirm, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Auftrag } from '../api/types';
import { AUFTRAG_STATUS, PHASE_META, PrioBadge, StatusBadge, formatZeit } from '../kommunikation';

/** Befehlsschema-Felder für die Read-back-Detailansicht (Reihenfolge = Anzeige). */
const SCHEMA_FELDER: { key: keyof Auftrag; label: string; zeit?: boolean }[] = [
  { key: 'absicht', label: 'Absicht/Ziel' },
  { key: 'lage', label: 'Lage' },
  { key: 'ort', label: 'Ort' },
  { key: 'zeit', label: 'Zeit' },
  { key: 'mittel', label: 'Mittel' },
  { key: 'verbindung', label: 'Verbindung/Meldewege' },
  { key: 'sicherheit', label: 'Sicherheit/Besonderes' },
  { key: 'erteilt_at', label: 'Erteilt am', zeit: true },
];

/** Liefert die gesetzten (nicht-null/nicht-leer) Schemafelder eines Auftrags.
 *  erteilt_at ist ein UTC-Zeitstempel → lokal über formatZeit. */
function gefuellteFelder(a: Auftrag): { label: string; wert: string }[] {
  return SCHEMA_FELDER
    .map(({ key, label, zeit }) => {
      const roh = (a[key] ?? '') as string;
      const wert = zeit && roh ? formatZeit(roh) : roh;
      return { label, wert };
    })
    .filter(({ wert }) => typeof wert === 'string' && wert.trim() !== '');
}

export interface AuftragListeProps {
  auftraege: Auftrag[];
  /** Steuert die Read-back-Spalten (Vollzug/Abnahme) in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  /** Für den Rückverweis auf den Quell-ETB-Eintrag (LFH-112). Ohne ihn kein Backlink. */
  einsatzId?: number;
  darfSchreiben?: boolean;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
  onInArbeit?: (auftragId: number) => void;
  onVollzugMelden?: (auftragId: number) => void;
  onAbnehmen?: (auftragId: number) => void;
}

export default function AuftragListe({
  auftraege, ansicht = 'offen', einsatzId, darfSchreiben, onQuittieren, onInArbeit, onVollzugMelden, onAbnehmen,
}: AuftragListeProps) {
  if (auftraege.length === 0) return <Empty description="Keine Aufträge" />;
  return (
    <List
      dataSource={auftraege}
      renderItem={(a) => {
        const status = AUFTRAG_STATUS[a.bearbeitungsstatus] ?? AUFTRAG_STATUS.offen;
        const alleQuittiert = a.empfaenger_anzahl > 0 && a.quittiert_anzahl === a.empfaenger_anzahl;
        const details = gefuellteFelder(a);
        const aktionen: ReactNode[] = darfSchreiben
          ? [
              a.bearbeitungsstatus === 'offen' && onInArbeit
                ? (
                  <Popconfirm
                    key="ia"
                    title="Auftrag auf „In Bearbeitung“ setzen?"
                    okText="Bestätigen"
                    cancelText="Abbrechen"
                    onConfirm={() => onInArbeit(a.id)}
                  >
                    <Button type="link" size="small" style={{ padding: 0 }}>In Bearbeitung</Button>
                  </Popconfirm>
                ) : null,
              // „Vollzug melden" öffnet das Modal (= eigene Bestätigung) → kein Popconfirm.
              (a.bearbeitungsstatus === 'offen' || a.bearbeitungsstatus === 'in_arbeit') && onVollzugMelden
                ? <Button key="vm" type="link" size="small" style={{ padding: 0 }} onClick={() => onVollzugMelden(a.id)}>Vollzug melden</Button> : null,
              a.bearbeitungsstatus === 'vollzogen' && onAbnehmen
                ? (
                  <Popconfirm
                    key="ab"
                    title="Auftrag abnehmen?"
                    okText="Bestätigen"
                    cancelText="Abbrechen"
                    onConfirm={() => onAbnehmen(a.id)}
                  >
                    <Button type="link" size="small" style={{ padding: 0 }}>Abnehmen</Button>
                  </Popconfirm>
                ) : null,
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
                  <PrioBadge prio={a.prioritaet} />
                  {a.richtung === 'extern' && <Tag color="purple">Extern</Tag>}
                  <Typography.Text strong>{a.auftrag_text}</Typography.Text>
                  {a.ist_ueberfaellig && <Tag color={PHASE_META.ausnahme.color}>Überfällig</Tag>}
                  {a.quell_etb_eintrag_id != null && einsatzId != null && (
                    <Link to={`/einsaetze/${einsatzId}/etb`}>↗ ETB-Eintrag</Link>
                  )}
                </Space>
              }
              description={
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space wrap size={[8, 4]}>
                    <StatusBadge phase={status.phase} label={status.label} />
                    <Tag color={alleQuittiert ? 'success' : 'default'}>
                      Quittiert {a.quittiert_anzahl}/{a.empfaenger_anzahl}
                    </Tag>
                    {a.frist_at && <Typography.Text type="secondary">Frist: {formatZeit(a.frist_at)}</Typography.Text>}
                  </Space>
                  <div>
                    {a.empfaenger.map((emp) => (
                      <Tag key={emp.id} color={emp.quittiert_at ? 'success' : 'default'} style={{ marginBottom: 4 }}>
                        {emp.snap_anzeige}{emp.quittiert_at ? ' ✓' : ''}
                        {darfSchreiben && !emp.quittiert_at && onQuittieren && (
                          <Popconfirm
                            title="Empfang/Kenntnis quittieren?"
                            okText="Bestätigen"
                            cancelText="Abbrechen"
                            onConfirm={() => onQuittieren(a.id, emp.id)}
                          >
                            <Typography.Link style={{ marginInlineStart: 6 }}>quittieren</Typography.Link>
                          </Popconfirm>
                        )}
                      </Tag>
                    ))}
                  </div>
                  {ansicht === 'abgeschlossen' && (
                    <Space direction="vertical" size={0}>
                      {a.vollzogen_at && (
                        <Typography.Text type="secondary">Vollzogen am: {formatZeit(a.vollzogen_at)}</Typography.Text>
                      )}
                      {a.abgenommen_at && (
                        <Typography.Text type="secondary">Abgenommen am: {formatZeit(a.abgenommen_at)}</Typography.Text>
                      )}
                      {a.vollzugsmeldung && (
                        <Typography.Text type="secondary">Vollzugsvermerk: {a.vollzugsmeldung}</Typography.Text>
                      )}
                    </Space>
                  )}
                  {ansicht !== 'abgeschlossen' && a.vollzugsmeldung && (
                    <Typography.Text type="secondary">Vollzug: {a.vollzugsmeldung}</Typography.Text>
                  )}
                  {details.length > 0 && (
                    <Collapse
                      ghost
                      size="small"
                      items={[{
                        key: 'details',
                        label: 'Befehlsdetails',
                        children: (
                          <Descriptions size="small" column={1} bordered>
                            {details.map(({ label, wert }) => (
                              <Descriptions.Item key={label} label={label}>{wert}</Descriptions.Item>
                            ))}
                          </Descriptions>
                        ),
                      }]}
                    />
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
