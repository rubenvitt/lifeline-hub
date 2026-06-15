import { Empty, List, Select, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Meldung, MeldungStatus } from '../api/types';

export interface BearbeiterOption {
  benutzer_id: number;
  anzeigename: string;
}

const PRIO_TAG: Record<string, { color: string; label: string }> = {
  sofort: { color: 'red', label: 'Sofort' },
  dringend: { color: 'orange', label: 'Dringend' },
  normal: { color: 'default', label: 'Normal' },
};
const RICHTUNG_TAG: Record<string, { color: string; label: string }> = {
  intern: { color: 'default', label: 'Intern' },
  extern: { color: 'purple', label: 'Extern' },
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
  mitglieder?: BearbeiterOption[];
  onStatus?: (meldungId: number, status: MeldungStatus) => void;
  onZuweisen?: (meldungId: number, bearbeiterId: number | null) => void;
  onLagerelevant?: (meldungId: number) => void;
  onBestaetigen?: (meldungId: number) => void;
}

/** Bestätigungs-Status-Tag (LFH-97): grün bestätigt, rot überfällig/eskaliert, orange offen. */
function bestaetigungsTag(m: Meldung): ReactNode {
  if (!m.bestaetigung_pflicht) return null;
  if (m.ist_bestaetigt) {
    const von = m.bestaetigt_von_name ? ` von ${m.bestaetigt_von_name}` : '';
    return <Tag color="green">Bestätigt ✓ {m.bestaetigt_at} UTC{von}</Tag>;
  }
  if (m.ist_ueberfaellig || m.eskaliert) {
    return <Tag color="red">Bestätigung überfällig{m.eskaliert ? ' (eskaliert)' : ''}</Tag>;
  }
  return <Tag color="orange">Bestätigung offen bis {m.bestaetigung_frist_at} UTC</Tag>;
}

export default function MeldungListe({
  meldungen, darfSchreiben, mitglieder, onStatus, onZuweisen, onLagerelevant, onBestaetigen,
}: MeldungListeProps) {
  if (meldungen.length === 0) return <Empty description="Keine Meldungen" />;
  return (
    <List
      dataSource={meldungen}
      renderItem={(m) => {
        const prio = PRIO_TAG[m.prioritaet] ?? PRIO_TAG.normal;
        const status = STATUS_TAG[m.status] ?? STATUS_TAG.neu;
        // Unübersehbare Hervorhebung (AK1/AK3): unbestätigte überfällige/eskalierte Sofortmeldung.
        const alarmiert = m.bestaetigung_pflicht && !m.ist_bestaetigt && (m.ist_ueberfaellig || m.eskaliert);
        const rowStyle = alarmiert
          ? { background: 'rgba(255,77,79,0.12)', borderLeft: '3px solid #ff4d4f', paddingLeft: 8 }
          : undefined;
        const aktionen: ReactNode[] = darfSchreiben
          ? [
              m.bestaetigung_pflicht && !m.ist_bestaetigt && onBestaetigen
                ? <a key="be" onClick={() => onBestaetigen(m.id)}>Bestätigen</a> : null,
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
          <List.Item actions={aktionen.length ? aktionen : undefined} style={rowStyle}>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Typography.Text type="secondary">#{m.lfd_nr}</Typography.Text>
                  <Tag color={prio.color}>{prio.label}</Tag>
                  {m.richtung === 'extern' && <Tag color={RICHTUNG_TAG.extern.color}>{RICHTUNG_TAG.extern.label}</Tag>}
                  <Typography.Text strong>{m.absender}</Typography.Text>
                  {m.empfaenger && <Typography.Text type="secondary">→ {m.empfaenger}</Typography.Text>}
                  {m.lagerelevant && <Tag color="gold">Lagerelevant ✓</Tag>}
                  {bestaetigungsTag(m)}
                </Space>
              }
              description={
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space wrap size={[8, 4]}>
                    <Tag color={status.color}>{status.label}</Tag>
                    <Typography.Text type="secondary">{WEG_LABEL[m.meldeweg]} · {ART_LABEL[m.meldungsart]}</Typography.Text>
                    <Typography.Text type="secondary">Ereignis: {m.ereigniszeit} UTC</Typography.Text>
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
