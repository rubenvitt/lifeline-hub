import { Button, Empty, List, Popconfirm, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Nachforderung, NachforderungStatus } from '../api/types';
import { NACHFORDERUNG_STATUS, PrioBadge, StatusBadge, formatZeit } from '../kommunikation';

/** Adressat-Kategorie → Anzeigelabel (modul-spezifisch, bleibt lokal). */
const ADRESSAT_LABEL: Record<string, string> = {
  leitstelle: 'Leitstelle', nachbar_ea: 'Nachbar-EA', uebergeordnet: 'Übergeordnete Führung', andere_bos: 'Andere BOS',
};
/** Nächster linearer Status (für die Weiterschalten-Aktion). */
const NAECHSTER: Partial<Record<NachforderungStatus, NachforderungStatus>> = {
  angefordert: 'zugesagt', zugesagt: 'unterwegs', unterwegs: 'eingetroffen',
};

export interface NachforderungListeProps {
  nachforderungen: Nachforderung[];
  /** Steuert die Übergangs-Zeitstempel/Grund-Zeilen in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  darfSchreiben?: boolean;
  onStatus?: (id: number, status: NachforderungStatus) => void;
  onAblehnen?: (id: number) => void;
}

export default function NachforderungListe({
  nachforderungen, ansicht = 'offen', darfSchreiben, onStatus, onAblehnen,
}: NachforderungListeProps) {
  if (nachforderungen.length === 0) return <Empty description="Keine Nachforderungen" />;
  return (
    <List
      dataSource={nachforderungen}
      renderItem={(n) => {
        const status = NACHFORDERUNG_STATUS[n.status] ?? NACHFORDERUNG_STATUS.angefordert;
        const next = NAECHSTER[n.status];
        const istAbg = ansicht === 'abgeschlossen';
        const aktionen: ReactNode[] = darfSchreiben && n.ist_offen
          ? [
              next && onStatus
                ? (
                  <Popconfirm
                    key="next"
                    title={`Status auf „${NACHFORDERUNG_STATUS[next].label}“ setzen?`}
                    okText="Bestätigen"
                    cancelText="Abbrechen"
                    onConfirm={() => onStatus(n.id, next)}
                  >
                    <Button type="link" size="small" style={{ padding: 0 }}>→ {NACHFORDERUNG_STATUS[next].label}</Button>
                  </Popconfirm>
                ) : null,
              // „Ablehnen" öffnet das Modal (= eigene Bestätigung mit Grund) → kein Popconfirm.
              onAblehnen
                ? <Button key="ab" type="link" size="small" style={{ padding: 0 }} onClick={() => onAblehnen(n.id)}>Ablehnen</Button> : null,
            ].filter(Boolean) as ReactNode[]
          : [];
        const menge = n.anzahl != null ? `${n.anzahl}× ` : '';
        return (
          <List.Item actions={aktionen.length ? aktionen : undefined}>
            <List.Item.Meta
              title={
                <Space wrap>
                  <PrioBadge prio={n.prioritaet} />
                  <StatusBadge phase={status.phase} label={status.label} />
                  <Typography.Text strong>{menge}{n.art}</Typography.Text>
                  <Typography.Text type="secondary">
                    → {ADRESSAT_LABEL[n.adressat_kategorie] ?? n.adressat_kategorie}{n.adressat_bezeichnung ? ` (${n.adressat_bezeichnung})` : ''}
                  </Typography.Text>
                </Space>
              }
              description={
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Typography.Text>{n.bezeichnung}</Typography.Text>
                  {n.begruendung && <Typography.Text type="secondary">{n.begruendung}</Typography.Text>}
                  <Typography.Text type="secondary">
                    Angefordert: {formatZeit(n.angefordert_at)}
                    {n.erstellt_von_name ? ` · ${n.erstellt_von_name}` : ''}
                  </Typography.Text>
                  {/* Übergangs-Zeitstempel: in der Abgeschlossen-Ansicht vollständig,
                      in der Offen-Ansicht ab „unterwegs" (Zwischenstände sichtbar machen). */}
                  {(istAbg || n.status === 'unterwegs') && (
                    <Space direction="vertical" size={0}>
                      {n.zugesagt_at && (
                        <Typography.Text type="secondary">Zugesagt: {formatZeit(n.zugesagt_at)}</Typography.Text>
                      )}
                      {n.unterwegs_at && (
                        <Typography.Text type="secondary">Unterwegs: {formatZeit(n.unterwegs_at)}</Typography.Text>
                      )}
                      {n.eingetroffen_at && (
                        <Typography.Text type="secondary">Eingetroffen: {formatZeit(n.eingetroffen_at)}</Typography.Text>
                      )}
                    </Space>
                  )}
                  {n.status === 'abgelehnt' && (
                    <Typography.Text type="danger">
                      Abgelehnt{n.abgelehnt_at ? ` (${formatZeit(n.abgelehnt_at)})` : ''}
                      {n.abgelehnt_grund ? `: ${n.abgelehnt_grund}` : ''}
                    </Typography.Text>
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
