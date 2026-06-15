import { Button, Empty, List, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Meldung, MeldungStatus } from '../api/types';
import { MELDUNG_STATUS, PrioBadge, QuittungIndikator, StatusBadge, formatZeit } from '../kommunikation';

export interface BearbeiterOption {
  benutzer_id: number;
  anzeigename: string;
}

// Modul-spezifische Labels (kein gemeinsames Primitiv) — bleiben lokal.
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
  mitglieder?: BearbeiterOption[];
  onStatus?: (meldungId: number, status: MeldungStatus) => void;
  onZuweisen?: (meldungId: number, bearbeiterId: number | null) => void;
  onLagerelevant?: (meldungId: number) => void;
  onBestaetigen?: (meldungId: number) => void;
}

/**
 * Bestätigungs-Tag (LFH-97) — die Kenntnisnahme-Achse der Sofortmeldung, ORTHOGONAL
 * zum Triage-Status. Bestätigt → gemeinsamer QuittungIndikator; unbestätigt mit
 * Frist/Eskalation → eigenes rotes/oranges Tag (Frist-Read-back, den der Indikator
 * nicht abbildet).
 */
function bestaetigungsAchse(m: Meldung): ReactNode {
  if (!m.bestaetigung_pflicht) return null;
  if (m.ist_bestaetigt) {
    return <QuittungIndikator quittiert von={m.bestaetigt_von_name} am={m.bestaetigt_at} />;
  }
  if (m.ist_ueberfaellig || m.eskaliert) {
    return <Tag color="red">Bestätigung überfällig{m.eskaliert ? ' (eskaliert)' : ''}</Tag>;
  }
  return <Tag color="orange">Bestätigung offen bis {formatZeit(m.bestaetigung_frist_at)}</Tag>;
}

/** Aktion als Link-Button mit Popconfirm (Konvention wie AuftragListe). */
function aktion(key: string, label: string, frage: string, onConfirm: () => void): ReactNode {
  return (
    <Popconfirm key={key} title={frage} okText="Bestätigen" cancelText="Abbrechen" onConfirm={onConfirm}>
      <Button type="link" size="small" style={{ padding: 0 }}>{label}</Button>
    </Popconfirm>
  );
}

export default function MeldungListe({
  meldungen, darfSchreiben, mitglieder, onStatus, onZuweisen, onLagerelevant, onBestaetigen,
}: MeldungListeProps) {
  if (meldungen.length === 0) return <Empty description="Keine Meldungen" />;
  return (
    <List
      dataSource={meldungen}
      renderItem={(m) => {
        const status = MELDUNG_STATUS[m.status] ?? MELDUNG_STATUS.neu;
        // Unübersehbare Hervorhebung (AK1/AK3): unbestätigte überfällige/eskalierte Sofortmeldung.
        const alarmiert = m.bestaetigung_pflicht && !m.ist_bestaetigt && (m.ist_ueberfaellig || m.eskaliert);
        const rowStyle = alarmiert
          ? { background: 'rgba(255,77,79,0.12)', borderInlineStart: '3px solid #ff4d4f', paddingInlineStart: 8 }
          : undefined;
        const aktionen: ReactNode[] = darfSchreiben
          ? [
              m.bestaetigung_pflicht && !m.ist_bestaetigt && onBestaetigen
                ? aktion('be', 'Bestätigen', 'Sofortmeldung bestätigen (Kenntnis genommen)?', () => onBestaetigen(m.id)) : null,
              m.status === 'neu' && onStatus
                ? aktion('si', 'Sichten', 'Meldung als gesichtet markieren?', () => onStatus(m.id, 'gesichtet')) : null,
              (m.status === 'neu' || m.status === 'gesichtet') && onStatus
                ? aktion('ib', 'In Bearbeitung', 'Meldung auf „In Bearbeitung“ setzen?', () => onStatus(m.id, 'in_bearbeitung')) : null,
              m.status !== 'erledigt' && onStatus
                ? aktion('er', 'Erledigt', 'Meldung auf „Erledigt“ setzen?', () => onStatus(m.id, 'erledigt')) : null,
              !m.lagerelevant && onLagerelevant
                ? aktion('lr', 'An Lage übergeben', 'Meldung an die Lage übergeben?', () => onLagerelevant(m.id)) : null,
            ].filter(Boolean) as ReactNode[]
          : [];
        return (
          <List.Item actions={aktionen.length ? aktionen : undefined} style={rowStyle}>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Typography.Text type="secondary">#{m.lfd_nr}</Typography.Text>
                  <PrioBadge prio={m.prioritaet} />
                  {m.richtung === 'extern' && <Tag color="purple">Extern</Tag>}
                  <Typography.Text strong>{m.absender}</Typography.Text>
                  {m.empfaenger && <Typography.Text type="secondary">→ {m.empfaenger}</Typography.Text>}
                  {m.lagerelevant && <Tag color="gold">Lagerelevant ✓</Tag>}
                  {bestaetigungsAchse(m)}
                </Space>
              }
              description={
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space wrap size={[8, 4]}>
                    <StatusBadge phase={status.phase} label={status.label} />
                    <Typography.Text type="secondary">{WEG_LABEL[m.meldeweg]} · {ART_LABEL[m.meldungsart]}</Typography.Text>
                    <Typography.Text type="secondary">Ereignis: {formatZeit(m.ereigniszeit)}</Typography.Text>
                    {m.erledigt_at && (
                      <Typography.Text type="secondary">Erledigt: {formatZeit(m.erledigt_at)}</Typography.Text>
                    )}
                    {darfSchreiben && onZuweisen ? (
                      <Select<number | null>
                        size="small"
                        allowClear
                        style={{ minWidth: 180 }}
                        placeholder="Bearbeiter zuweisen"
                        value={m.bearbeiter_id ?? undefined}
                        onChange={(v) => onZuweisen(m.id, v ?? null)}
                        options={(mitglieder ?? []).map((mi) => ({ value: mi.benutzer_id, label: mi.anzeigename }))}
                        optionFilterProp="label"
                        aria-label={`Bearbeiter für Meldung ${m.lfd_nr}`}
                      />
                    ) : (
                      m.bearbeiter_name && <Tag>Bearbeiter: {m.bearbeiter_name}</Tag>
                    )}
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
