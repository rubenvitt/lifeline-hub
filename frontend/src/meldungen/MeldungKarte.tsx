import { Button, Card, Flex, Popconfirm, Space, Tag, Typography, theme } from 'antd';
import { Select } from '../components/Select';
import { ClockCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { auftraegePfad } from '../routing/deeplinks';
import type { Meldung, MeldungStatus } from '../api/types';
import { MELDUNG_STATUS, PrioBadge, QuittungIndikator, StatusBadge, formatZeit } from '../kommunikation';

const { Text } = Typography;

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

export interface MeldungKarteProps {
  meldung: Meldung;
  ansicht?: 'offen' | 'abgeschlossen';
  /** Einsatz-id für den Backlink auf den ausgelösten Auftrag (`/einsaetze/:id/auftraege`). */
  einsatzId: number;
  darfSchreiben?: boolean;
  mitglieder?: BearbeiterOption[];
  /** Deeplink-Hervorhebung (?meldung=, LFH-153): markierte Karte + scroll-adressierbar. */
  hervorgehoben?: boolean;
  onStatus?: (meldungId: number, status: MeldungStatus) => void;
  onZuweisen?: (meldungId: number, bearbeiterId: number | null) => void;
  onLagerelevant?: (meldungId: number) => void;
  onBestaetigen?: (meldungId: number) => void;
  /** Öffnet das Auftrags-Formular zur Meldung→Auftrag-Erteilung (LFH-113). */
  onAuftragErteilen?: (m: Meldung) => void;
}

/**
 * Bestätigungs-Achse (LFH-97) — die Kenntnisnahme-Achse der Sofortmeldung, ORTHOGONAL
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
    return <Tag color="red" style={{ margin: 0 }}>Bestätigung überfällig{m.eskaliert ? ' (eskaliert)' : ''}</Tag>;
  }
  return <Tag color="orange" style={{ margin: 0 }}>Bestätigung offen bis {formatZeit(m.bestaetigung_frist_at)}</Tag>;
}

/**
 * Meldungs-Karte (LFH-112): Karten-Look analog AuftragKarte. Alarm-Hervorhebung der
 * unbestätigten überfälligen/eskalierten Sofortmeldung ist dark-safe über Theme-Tokens
 * (colorErrorBg/colorError) statt hartkodiertem Rosa. Die Bestätigungs-Achse bleibt
 * orthogonal zum Triage-Status (LFH-97).
 */
export default function MeldungKarte({
  meldung: m, ansicht = 'offen', einsatzId, darfSchreiben, mitglieder, hervorgehoben,
  onStatus, onZuweisen, onLagerelevant, onBestaetigen, onAuftragErteilen,
}: MeldungKarteProps) {
  const { token } = theme.useToken();
  const status = MELDUNG_STATUS[m.status] ?? MELDUNG_STATUS.neu;
  // Unübersehbare Hervorhebung (AK1/AK3): unbestätigte überfällige/eskalierte Sofortmeldung.
  const alarmiert = !!(m.bestaetigung_pflicht && !m.ist_bestaetigt && (m.ist_ueberfaellig || m.eskaliert));

  // Bündelung in ein Dreipunkt-Menü: GEPRÜFT und VERWORFEN (LFH-364/B5d).
  //
  // Der Anlass ist echt — die sechs Aktionen unten schliessen sich NICHT aus. Eine neue,
  // bestätigungspflichtige, noch nicht lagerelevante Meldung ohne Auftrag zeigt alle
  // sechs gleichzeitig, und auf der Stufe `handschuh` (72 px) wächst die Karte damit um
  // mehrere Knopfzeilen. Dagegen stehen zwei gemessene Kosten:
  //
  //  1. `pages/MeldungenPage.test.tsx` greift diese Aktionen an ~10 Stellen als
  //     `getByRole('button', { name })` ab (Sichten, Erledigt, An Lage übergeben,
  //     Auftrag erteilen, Bestätigen). Ein Dropdown macht aus der Rolle `button` ein
  //     `menuitem` — gleicher Wortlaut rettet die Abfragen also nicht. LFH-364 nennt
  //     diese Datei nicht als Änderungsziel.
  //  2. Vier der sechs Aktionen hängen in einem `Popconfirm`. Im Menü braucht jede die
  //     `stopPropagation`-Konstruktion aus `chat/NachrichtenStrom.tsx` — vier
  //     Bestätigungsblasen in einem Menü sind eine eigene Interaktionsentscheidung,
  //     keine Nebenwirkung einer Dichte-Aufgabe.
  //
  // Das verbindliche Kriterium von B5 ist die TREFFFLÄCHE, und die trägt jetzt der
  // `ConfigProvider`. Die Kartenhöhe bei sechs offenen Aktionen bleibt offen und liegt
  // als LFH-372 (B5k) auf dem Board — dort samt dem Testumbau, den sie erzwingt.
  const aktionen: ReactNode[] = darfSchreiben
    ? [
        m.bestaetigung_pflicht && !m.ist_bestaetigt && onBestaetigen
          ? (
            <Popconfirm
              key="be"
              title="Sofortmeldung bestätigen (Kenntnis genommen)?"
              okText="Bestätigen"
              cancelText="Abbrechen"
              onConfirm={() => onBestaetigen(m.id)}
            >
              <Button danger>Bestätigen</Button>
            </Popconfirm>
          ) : null,
        m.status === 'neu' && onStatus
          ? (
            <Popconfirm
              key="si"
              title="Meldung als gesichtet markieren?"
              okText="Bestätigen"
              cancelText="Abbrechen"
              onConfirm={() => onStatus(m.id, 'gesichtet')}
            >
              <Button>Sichten</Button>
            </Popconfirm>
          ) : null,
        (m.status === 'neu' || m.status === 'gesichtet') && onStatus
          ? (
            <Popconfirm
              key="ib"
              title="Meldung auf „In Bearbeitung“ setzen?"
              okText="Bestätigen"
              cancelText="Abbrechen"
              onConfirm={() => onStatus(m.id, 'in_bearbeitung')}
            >
              <Button>In Bearbeitung</Button>
            </Popconfirm>
          ) : null,
        m.status !== 'erledigt' && onStatus
          ? (
            <Popconfirm
              key="er"
              title="Meldung auf „Erledigt“ setzen?"
              okText="Bestätigen"
              cancelText="Abbrechen"
              onConfirm={() => onStatus(m.id, 'erledigt')}
            >
              <Button type="primary" ghost>Erledigt</Button>
            </Popconfirm>
          ) : null,
        // An die Lage übergeben (LFH-95/113): öffnet ein Formular-Modal (optionale
        // Verortung) statt Popconfirm → eigener Button ohne Popconfirm.
        !m.lagerelevant && onLagerelevant
          ? <Button key="lr" onClick={() => onLagerelevant(m.id)}>An Lage übergeben</Button> : null,
        // Meldung→Auftrag (LFH-113): nur solange noch kein Auftrag erteilt. Öffnet ein
        // Formular-Modal (kein Popconfirm) → eigener Button.
        m.auftrag_id == null && onAuftragErteilen
          ? <Button key="ae" onClick={() => onAuftragErteilen(m)}>Auftrag erteilen</Button> : null,
      ].filter(Boolean)
    : [];

  return (
    <Card
      size="small"
      data-meldung-id={m.id}
      data-hervorgehoben={hervorgehoben ? 'true' : undefined}
      style={{
        marginBottom: 10,
        borderInlineStart: `3px solid ${alarmiert ? token.colorError : 'transparent'}`,
        background: alarmiert ? token.colorErrorBg : undefined,
        boxShadow: hervorgehoben ? `0 0 0 2px ${token.colorPrimary}` : undefined,
      }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
        <Space size={6} wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>#{m.lfd_nr}</Text>
          <PrioBadge prio={m.prioritaet} />
          <StatusBadge phase={status.phase} label={status.label} />
          {m.richtung === 'extern' && <Tag color="purple" style={{ margin: 0 }}>Extern</Tag>}
          {m.lagerelevant && <Tag color="gold" style={{ margin: 0 }}>Lagerelevant ✓</Tag>}
          {m.auftrag_id != null && (
            <Link to={auftraegePfad(einsatzId, { auftrag: m.auftrag_id })}>↗ Auftrag</Link>
          )}
        </Space>
        <Space size={10} wrap>
          {alarmiert && (
            <Text type="danger" strong style={{ fontSize: 12 }}>
              <ClockCircleOutlined /> Alarm
            </Text>
          )}
          {bestaetigungsAchse(m)}
        </Space>
      </Flex>

      <Space size={6} wrap style={{ marginBottom: 6 }}>
        <Text strong style={{ fontSize: 15, lineHeight: 1.4 }}>{m.absender}</Text>
        {m.empfaenger && <Text type="secondary" style={{ fontSize: 14 }}>→ {m.empfaenger}</Text>}
      </Space>

      <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {WEG_LABEL[m.meldeweg]} · {ART_LABEL[m.meldungsart]} · Ereignis: {formatZeit(m.ereigniszeit)}
        </Text>
        {ansicht === 'abgeschlossen' && m.erledigt_at && (
          <Text type="secondary" style={{ fontSize: 12 }}>Erledigt: {formatZeit(m.erledigt_at)}</Text>
        )}
        {darfSchreiben && onZuweisen ? (
          <Select<number | null>
            allowClear
            style={{ minWidth: 180 }}
            placeholder="Bearbeiter zuweisen"
            value={m.bearbeiter_id ?? undefined}
            onChange={(v) => onZuweisen(m.id, v ?? null)}
            options={(mitglieder ?? []).map((mi) => ({ value: mi.benutzer_id, label: mi.anzeigename }))}
            aria-label={`Bearbeiter für Meldung ${m.lfd_nr}`}
          />
        ) : (
          m.bearbeiter_name && <Tag style={{ margin: 0 }}>Bearbeiter: {m.bearbeiter_name}</Tag>
        )}
      </Flex>

      <Text style={{ fontSize: 13, display: 'block' }}>{m.inhalt}</Text>

      {aktionen.length > 0 && (
        <Flex justify="flex-end" gap={8} wrap style={{ marginTop: 8 }}>
          {aktionen}
        </Flex>
      )}
    </Card>
  );
}
