import { Button, Card, Dropdown, Flex, Modal, Popconfirm, Space, Tag, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import { Select } from '../components/Select';
import { ClockCircleOutlined, MoreOutlined } from '@ant-design/icons';
import { useState, type ReactNode } from 'react';
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

  // Aktionsbündelung (LFH-372/B5k, Nachtrag zu LFH-364/B5d): die sechs Aktionen dieser
  // Karte schliessen sich NICHT aus — eine neue, bestätigungspflichtige, noch nicht
  // lagerelevante Meldung ohne Auftrag hatte sie alle gleichzeitig, auf `handschuh`
  // (72 px) also bis zu sechs Knopfzeilen. Sichtbar bleiben deshalb genau zwei:
  // „Bestätigen" (die dringlichste Aktion der Karte, Kenntnisnahme einer Sofortmeldung)
  // und die EINE sinnvolle Vorwärtsbewegung des Triage-Status. Alles Weitere hängt an
  // einem ⋮-Menü (Muster: `chat/NachrichtenStrom.tsx`, `pages/lagekarte/Sidebar.tsx`).
  //
  // Rückfragen (LFH-378: erst die Umkehrbarkeit, dann die Rückfrage):
  //  • „Sichten"/„In Bearbeitung" haben ihre verloren — `src/meldung/repo.rs:223` setzt
  //    jeden Status frei zurück, der Schritt ist folgenlos.
  //  • „Erledigt" behält eine: es räumt die Karte aus der Offen-Ansicht, und die
  //    Abgeschlossen-Ansicht trägt keine Aktion zurück. Sie ist ein `<Modal>` mit eigenem
  //    State und KEIN `Popconfirm` (LFH-366) — im Menü-Label überlebte der nur mit
  //    `stopPropagation` das Auto-Schliessen. Bewusst DERSELBE Pfad, egal ob „Erledigt"
  //    gerade sichtbar oder im Menü steht: zwei Bauformen für eine Aktion wären ein
  //    Unterschied ohne Bedeutung.
  //  • „Bestätigen" behält seinen `Popconfirm` — sichtbarer Knopf, keine Menü-Falle.
  const [erledigtOffen, setErledigtOffen] = useState(false);

  const kannBestaetigen = !!(darfSchreiben && m.bestaetigung_pflicht && !m.ist_bestaetigt && onBestaetigen);
  // Je Status genau eine Vorwärtsbewegung. `erledigt` hat keine.
  // Der `darfSchreiben`-Riegel steht HIER und nicht erst am Rendern: `MeldungenPage`
  // übergibt `onStatus` auch einem Beobachter, dessen Vorhandensein ist also kein
  // Rechtebeleg (gemessen — ohne den Riegel sah der Beobachter „Sichten").
  const naechster: { ziel: MeldungStatus; label: string } | null = !(darfSchreiben && onStatus)
    ? null
    : m.status === 'neu' ? { ziel: 'gesichtet', label: 'Sichten' }
      : m.status === 'gesichtet' ? { ziel: 'in_bearbeitung', label: 'In Bearbeitung' }
        : m.status === 'in_bearbeitung' ? { ziel: 'erledigt', label: 'Erledigt' }
          : null;

  const weitere: { key: string; label: string; onClick: () => void }[] = darfSchreiben
    ? [
        // Was der Primär-Knopf gerade NICHT zeigt, bleibt über das Menü erreichbar —
        // sonst verlöre eine neue Meldung den Direktsprung auf „Erledigt", den der
        // Bestand hatte (`m.status !== 'erledigt'`).
        ...(m.status === 'neu' && onStatus
          ? [{ key: 'ib', label: 'In Bearbeitung', onClick: () => onStatus(m.id, 'in_bearbeitung') }]
          : []),
        ...(m.status !== 'erledigt' && m.status !== 'in_bearbeitung' && onStatus
          ? [{ key: 'er', label: 'Erledigt', onClick: () => setErledigtOffen(true) }]
          : []),
        // An die Lage übergeben (LFH-95/113) und Meldung→Auftrag (LFH-113) öffnen jeweils
        // ein Formular-Modal — sie tragen ihre Bestätigung also selbst.
        ...(!m.lagerelevant && onLagerelevant
          ? [{ key: 'lr', label: 'An Lage übergeben', onClick: () => onLagerelevant(m.id) }]
          : []),
        ...(m.auftrag_id == null && onAuftragErteilen
          ? [{ key: 'ae', label: 'Auftrag erteilen', onClick: () => onAuftragErteilen(m) }]
          : []),
      ]
    : [];

  // Gebündelt wird ERST AB DREI Aktionen, und gezählt wird NACH der Sichtbarkeits- und
  // Rechteprüfung (LFH-366): fällt die Menge darunter, ist ein Menü keine Bündelung,
  // sondern ein Umweg. Der Fall ist echt und nicht konstruiert — eine erledigte Meldung
  // ohne Bestätigungspflicht hat weder eine Vorwärtsbewegung noch etwas zu bestätigen und
  // stünde sonst mit einem ⋮-Trigger da, hinter dem zwei Einträge und sonst nichts liegen.
  const gesamt = (kannBestaetigen ? 1 : 0) + (naechster ? 1 : 0) + weitere.length;
  const buendeln = gesamt >= 3;
  const menuItems: MenuProps['items'] = buendeln ? weitere : [];

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

      {/* `<Space size="middle">` statt `<Flex gap={8}>` (LFH-363): „Bestätigen" ist `danger`
          und steht neben mindestens einer weiteren Aktion — der Vorgabeabstand wäre
          `abstand.xs` = 3/5/7 px je Dichtestufe und damit im Handschuh-Betrieb keine
          Trennung. Gepinnt in `components/aktionsabstand.guard.test.ts`. */}
      {gesamt > 0 && (
        <Space size="middle" wrap style={{ marginTop: 8, width: '100%', justifyContent: 'flex-end' }}>
          {kannBestaetigen && (
            <Popconfirm
              title="Sofortmeldung bestätigen (Kenntnis genommen)?"
              okText="Bestätigen"
              cancelText="Abbrechen"
              onConfirm={() => onBestaetigen?.(m.id)}
            >
              <Button danger>Bestätigen</Button>
            </Popconfirm>
          )}
          {naechster && onStatus && (
            naechster.ziel === 'erledigt'
              ? <Button type="primary" ghost onClick={() => setErledigtOffen(true)}>{naechster.label}</Button>
              : <Button onClick={() => onStatus(m.id, naechster.ziel)}>{naechster.label}</Button>
          )}
          {buendeln ? (
            menuItems.length > 0 && (
              <Dropdown trigger={['click']} menu={{ items: menuItems }}>
                <Button type="text" aria-label={`Aktionen zu Meldung ${m.lfd_nr}`} icon={<MoreOutlined />} />
              </Dropdown>
            )
          ) : (
            weitere.map((w) => <Button key={w.key} onClick={w.onClick}>{w.label}</Button>)
          )}
        </Space>
      )}
      <Modal
        open={erledigtOffen}
        title="Meldung auf „Erledigt“ setzen?"
        okText="Bestätigen"
        cancelText="Abbrechen"
        onOk={() => { setErledigtOffen(false); onStatus?.(m.id, 'erledigt'); }}
        onCancel={() => setErledigtOffen(false)}
      />
    </Card>
  );
}
