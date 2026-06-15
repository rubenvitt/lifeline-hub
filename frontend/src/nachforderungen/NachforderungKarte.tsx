import { Button, Card, Flex, Popconfirm, Space, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import type { Nachforderung, NachforderungStatus } from '../api/types';
import { NACHFORDERUNG_STATUS, PrioBadge, StatusBadge, formatZeit } from '../kommunikation';

const { Text } = Typography;

/** Adressat-Kategorie → Anzeigelabel (modul-spezifisch, bleibt lokal). */
const ADRESSAT_LABEL: Record<string, string> = {
  leitstelle: 'Leitstelle', nachbar_ea: 'Nachbar-EA', uebergeordnet: 'Übergeordnete Führung', andere_bos: 'Andere BOS',
};
/** Nächster linearer Status (für die Weiterschalten-Aktion). */
const NAECHSTER: Partial<Record<NachforderungStatus, NachforderungStatus>> = {
  angefordert: 'zugesagt', zugesagt: 'unterwegs', unterwegs: 'eingetroffen',
};

export interface NachforderungKarteProps {
  nachforderung: Nachforderung;
  /** Steuert die Übergangs-Zeitstempel/Grund-Zeilen in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  darfSchreiben?: boolean;
  onStatus?: (id: number, status: NachforderungStatus) => void;
  onAblehnen?: (id: number) => void;
}

/**
 * Nachforderungs-Karte (LFH-112): Karten-Look analog AuftragKarte. Kopf mit Prio + Status,
 * Titel „Anzahl× Art → Adressat", Bezeichnung/Begründung, Übergangs-Timeline. Die
 * Ausnahme-Phase „abgelehnt" wird dark-safe über Theme-Tokens (colorError/colorErrorBg)
 * akzentuiert statt mit hartkodiertem Rot.
 */
export default function NachforderungKarte({
  nachforderung: n, ansicht = 'offen', darfSchreiben, onStatus, onAblehnen,
}: NachforderungKarteProps) {
  const { token } = theme.useToken();
  const status = NACHFORDERUNG_STATUS[n.status] ?? NACHFORDERUNG_STATUS.angefordert;
  const next = NAECHSTER[n.status];
  const istAbg = ansicht === 'abgeschlossen';
  const abgelehnt = n.status === 'abgelehnt';
  const menge = n.anzahl != null ? `${n.anzahl}× ` : '';
  const adressat = `${ADRESSAT_LABEL[n.adressat_kategorie] ?? n.adressat_kategorie}${n.adressat_bezeichnung ? ` (${n.adressat_bezeichnung})` : ''}`;

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
              <Button size="small">→ {NACHFORDERUNG_STATUS[next].label}</Button>
            </Popconfirm>
          ) : null,
        // „Ablehnen" öffnet das Modal (= eigene Bestätigung mit Grund) → kein Popconfirm.
        onAblehnen
          ? <Button key="ab" size="small" danger onClick={() => onAblehnen(n.id)}>Ablehnen</Button> : null,
      ].filter(Boolean)
    : [];

  return (
    <Card
      size="small"
      style={{
        marginBottom: 10,
        borderInlineStart: `3px solid ${abgelehnt ? token.colorError : 'transparent'}`,
        background: abgelehnt ? token.colorErrorBg : undefined,
      }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
        <Space size={6} wrap>
          <PrioBadge prio={n.prioritaet} />
          <StatusBadge phase={status.phase} label={status.label} />
        </Space>
      </Flex>

      <Text strong style={{ fontSize: 15, lineHeight: 1.4, display: 'block', marginBottom: 4 }}>
        {menge}{n.art} <Text type="secondary" style={{ fontWeight: 400 }}>→ {adressat}</Text>
      </Text>

      <Space direction="vertical" size={2} style={{ width: '100%', marginBottom: 8 }}>
        <Text>{n.bezeichnung}</Text>
        {n.begruendung && <Text type="secondary">{n.begruendung}</Text>}
        <Text type="secondary" style={{ fontSize: 13 }}>
          Angefordert: {formatZeit(n.angefordert_at)}
          {n.erstellt_von_name ? ` · ${n.erstellt_von_name}` : ''}
        </Text>
        {/* Übergangs-Zeitstempel: in der Abgeschlossen-Ansicht vollständig,
            in der Offen-Ansicht ab „unterwegs" (Zwischenstände sichtbar machen). */}
        {(istAbg || n.status === 'unterwegs') && (
          <Space direction="vertical" size={0}>
            {n.zugesagt_at && <Text type="secondary" style={{ fontSize: 13 }}>Zugesagt: {formatZeit(n.zugesagt_at)}</Text>}
            {n.unterwegs_at && <Text type="secondary" style={{ fontSize: 13 }}>Unterwegs: {formatZeit(n.unterwegs_at)}</Text>}
            {n.eingetroffen_at && <Text type="secondary" style={{ fontSize: 13 }}>Eingetroffen: {formatZeit(n.eingetroffen_at)}</Text>}
          </Space>
        )}
        {abgelehnt && (
          <Text type="danger">
            Abgelehnt{n.abgelehnt_at ? ` (${formatZeit(n.abgelehnt_at)})` : ''}
            {n.abgelehnt_grund ? `: ${n.abgelehnt_grund}` : ''}
          </Text>
        )}
      </Space>

      {aktionen.length > 0 && (
        <Flex justify="flex-end" gap={8} wrap style={{ marginTop: 8 }}>
          {aktionen}
        </Flex>
      )}
    </Card>
  );
}
