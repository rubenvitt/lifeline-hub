import { IkonePunkteSenkrecht, IkoneUhr } from '../ikonen';
import { Button, Dropdown, Flex, Modal, Popconfirm, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Select } from '../components/Select';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { auftraegePfad } from '../routing/deeplinks';
import type { Meldung, MeldungStatus } from '../api/types';
import { MELDUNG_STATUS, PrioBadge, QuittungIndikator, StatusBadge } from '../kommunikation';
import { formatZeit } from '../anzeige/format';
import KommKarte from '../kommunikation/KommKarte';
import { StatusChip, monoStil, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { istAlarmiert } from './meldungKennzahlen';

const { Text } = Typography;

interface BearbeiterOption {
  benutzer_id: number;
  anzeigename: string;
}

// Modul-spezifische Labels.
const ART_LABEL: Record<string, string> = {
  lagemeldung: 'Lagemeldung',
  sofortmeldung: 'Sofortmeldung',
  rueckmeldung: 'Rückmeldung',
  vollzugsmeldung: 'Vollzugsmeldung',
  anfrage: 'Anfrage',
  sonstige: 'Sonstige',
};
const WEG_LABEL: Record<string, string> = {
  funk: 'Funk',
  telefon: 'Telefon',
  persoenlich: 'Persönlich',
  sonstige: 'Sonstige',
};

interface MeldungKarteProps {
  meldung: Meldung;
  ansicht?: 'offen' | 'abgeschlossen';
  /** Einsatz-id für den Backlink auf den ausgelösten Auftrag (`/einsaetze/:id/auftraege`). */
  einsatzId: number;
  darfSchreiben?: boolean;
  mitglieder?: BearbeiterOption[];
  /** Deeplink-Hervorhebung (?meldung=): markierte Karte, scroll-adressierbar. */
  hervorgehoben?: boolean;
  onStatus?: (meldungId: number, status: MeldungStatus) => void;
  onZuweisen?: (meldungId: number, bearbeiterId: number | null) => void;
  onLagerelevant?: (meldungId: number) => void;
  onBestaetigen?: (meldungId: number) => void;
  /** Öffnet das Auftrags-Formular zur Meldung → Auftrag-Erteilung. */
  onAuftragErteilen?: (m: Meldung) => void;
}

/**
 * Bestätigungs-Achse der Sofortmeldung, ORTHOGONAL zum Triage-Status. Bestätigt →
 * QuittungIndikator; unbestätigt mit Frist/Eskalation → eigener Chip mit Frist.
 */
function bestaetigungsAchse(m: Meldung): ReactNode {
  if (!m.bestaetigung_pflicht) return null;
  if (m.ist_bestaetigt) {
    return <QuittungIndikator quittiert von={m.bestaetigt_von_name} am={m.bestaetigt_at} />;
  }
  if (m.ist_ueberfaellig || m.eskaliert) {
    return (
      <StatusChip ton="alarm" wort={`Bestätigung überfällig${m.eskaliert ? ' (eskaliert)' : ''}`} />
    );
  }
  return (
    <StatusChip
      ton="achtung"
      wort={`Bestätigung offen bis ${formatZeit(m.bestaetigung_frist_at)}`}
    />
  );
}

/** Meldungs-Karte. Die Bestätigungs-Achse bleibt orthogonal zum Triage-Status. */
export default function MeldungKarte({
  meldung: m,
  ansicht = 'offen',
  einsatzId,
  darfSchreiben,
  mitglieder,
  hervorgehoben,
  onStatus,
  onZuweisen,
  onLagerelevant,
  onBestaetigen,
  onAuftragErteilen,
}: MeldungKarteProps) {
  const { rollen } = useRollen();
  const status = MELDUNG_STATUS[m.status] ?? MELDUNG_STATUS.neu;
  // Hervorhebung einer unbestätigten überfälligen/eskalierten Sofortmeldung; dieselbe Regel
  // zählt das Kennzahlenband (`meldungKennzahlen.ts`).
  const alarmiert = istAlarmiert(m);
  // Eingangszustand: Akzent auf demselben linken Rand wie der Alarm; Gefahr schlägt
  // Eingangszustand. Das ETIKETT bleibt unberührt (`status.unbearbeitet` roh weitergereicht).
  const unbearbeitet = !!status.unbearbeitet && !alarmiert;

  // Aktionsbündelung: die sechs Aktionen schließen sich nicht aus. Sichtbar bleiben genau zwei:
  // „Bestätigen" (die dringlichste) und die EINE sinnvolle Vorwärtsbewegung des Triage-Status;
  // alles Weitere hängt am ⋮-Menü.
  //
  // Rückfragen nach Umkehrbarkeit:
  //  • „Sichten"/„In Bearbeitung" ohne — `setze_status` nimmt jeden Status zurück.
  //  • „Erledigt" mit — die Abgeschlossen-Ansicht trägt keine Aktion zurück. Als `<Modal>` mit
  //    eigenem State, kein `Popconfirm`, und derselbe Pfad, ob sichtbar oder im Menü.
  //  • „Bestätigen" behält seinen `Popconfirm` (sichtbarer Knopf, einmalig).
  const [erledigtOffen, setErledigtOffen] = useState(false);

  const kannBestaetigen = !!(
    darfSchreiben &&
    m.bestaetigung_pflicht &&
    !m.ist_bestaetigt &&
    onBestaetigen
  );
  // Je Status genau eine Vorwärtsbewegung; `erledigt` hat keine. Der `darfSchreiben`-Riegel steht
  // HIER: `MeldungenPage` übergibt `onStatus` auch Beobachtern, der Callback ist kein Rechtebeleg.
  const naechster: { ziel: MeldungStatus; label: string } | null = !(darfSchreiben && onStatus)
    ? null
    : m.status === 'neu'
      ? { ziel: 'gesichtet', label: 'Sichten' }
      : m.status === 'gesichtet'
        ? { ziel: 'in_bearbeitung', label: 'In Bearbeitung' }
        : m.status === 'in_bearbeitung'
          ? { ziel: 'erledigt', label: 'Erledigt' }
          : null;

  const weitere: { key: string; label: string; onClick: () => void }[] = darfSchreiben
    ? [
        // Was der Primär-Knopf gerade nicht zeigt, bleibt über das Menü erreichbar (z. B. der
        // Direktsprung auf „Erledigt" bei einer neuen Meldung).
        ...(m.status === 'neu' && onStatus
          ? [
              {
                key: 'ib',
                label: 'In Bearbeitung',
                onClick: () => onStatus(m.id, 'in_bearbeitung'),
              },
            ]
          : []),
        ...(m.status !== 'erledigt' && m.status !== 'in_bearbeitung' && onStatus
          ? [{ key: 'er', label: 'Erledigt', onClick: () => setErledigtOffen(true) }]
          : []),
        // Lage-Übergabe und Auftrag öffnen je ein Formular-Modal und tragen ihre Bestätigung selbst.
        ...(!m.lagerelevant && onLagerelevant
          ? [{ key: 'lr', label: 'An Lage übergeben', onClick: () => onLagerelevant(m.id) }]
          : []),
        ...(m.auftrag_id == null && onAuftragErteilen
          ? [{ key: 'ae', label: 'Auftrag erteilen', onClick: () => onAuftragErteilen(m) }]
          : []),
      ]
    : [];

  // Gebündelt wird ERST AB DREI Aktionen, gezählt NACH Sichtbarkeits- und Rechteprüfung —
  // darunter wäre ein Menü ein Umweg.
  const gesamt = (kannBestaetigen ? 1 : 0) + (naechster ? 1 : 0) + weitere.length;
  const buendeln = gesamt >= 3;
  const menuItems: MenuProps['items'] = buendeln ? weitere : [];

  return (
    // Die Ereigniszeit führt links in Mono, darunter die laufende Nummer; der Rand folgt dem
    // Kartenrand-Vertrag von `KommKarte`.
    <KommKarte
      data-meldung-id={m.id}
      alarm={alarmiert}
      unbearbeitet={unbearbeitet}
      hervorgehoben={hervorgehoben}
      zeit={m.ereigniszeit ? <ZeitAnzeige wert={m.ereigniszeit} format="uhrzeit" /> : '—'}
      nr={`#${m.lfd_nr}`}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
        <Space size={6} wrap>
          <PrioBadge prio={m.prioritaet} />
          <StatusBadge
            phase={status.phase}
            label={status.label}
            unbearbeitet={!!status.unbearbeitet}
          />
          {m.richtung === 'extern' && <StatusChip ton="neutral" wort="Extern" />}
          {m.lagerelevant && <StatusChip ton="bedien" wort="Lagerelevant ✓" />}
          {m.auftrag_id != null && (
            <Link to={auftraegePfad(einsatzId, { auftrag: m.auftrag_id })}>↗ Auftrag</Link>
          )}
        </Space>
        <Space size={10} wrap>
          {alarmiert && (
            <Text type="danger" strong style={{ fontSize: 12 }}>
              <span aria-hidden="true">
                <IkoneUhr />
              </span>{' '}
              Alarm
            </Text>
          )}
          {bestaetigungsAchse(m)}
        </Space>
      </Flex>

      {/* Absender und Empfänger sind Metadaten, nicht Inhalt — Metazeilen-Größe. */}
      <Space size={6} wrap style={{ marginBottom: 6 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {m.absender}
        </Text>
        {m.empfaenger && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            → {m.empfaenger}
          </Text>
        )}
      </Space>

      <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ ...monoStil(11), color: rollen.gedaempft }}>
          {WEG_LABEL[m.meldeweg]} · {ART_LABEL[m.meldungsart]} · Ereignis:{' '}
          {formatZeit(m.ereigniszeit)}
        </Text>
        {ansicht === 'abgeschlossen' && m.erledigt_at && (
          <Text type="secondary" style={{ ...monoStil(11), color: rollen.gedaempft }}>
            Erledigt: {formatZeit(m.erledigt_at)}
          </Text>
        )}
        {darfSchreiben && onZuweisen ? (
          <Select<number | null>
            allowClear
            style={{ minWidth: 180 }}
            placeholder="Bearbeiter zuweisen"
            value={m.bearbeiter_id ?? undefined}
            onChange={(v) => onZuweisen(m.id, v ?? null)}
            options={(mitglieder ?? []).map((mi) => ({
              value: mi.benutzer_id,
              label: mi.anzeigename,
            }))}
            aria-label={`Bearbeiter für Meldung ${m.lfd_nr}`}
          />
        ) : (
          m.bearbeiter_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Bearbeiter: {m.bearbeiter_name}
            </Text>
          )
        )}
      </Flex>

      {/* Der Wortlaut ist der Grund der Karte und trägt den größten Schriftgrad (wie `AuftragKarte`);
         Zeilenhöhe 1.5, weil er regelmäßig mehrzeilig ist. */}
      <Text style={{ fontSize: 15, lineHeight: 1.5, display: 'block' }}>{m.inhalt}</Text>

      {/* `<Space size="middle">`: „Bestätigen" ist `danger` und braucht Abstand zur Nachbaraktion
         (gepinnt in `components/aktionsabstand.guard.test.ts`). */}
      {gesamt > 0 && (
        <Space
          size="middle"
          wrap
          style={{ marginTop: 8, width: '100%', justifyContent: 'flex-end' }}
        >
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
          {naechster &&
            onStatus &&
            (naechster.ziel === 'erledigt' ? (
              <Button type="primary" ghost onClick={() => setErledigtOffen(true)}>
                {naechster.label}
              </Button>
            ) : (
              <Button onClick={() => onStatus(m.id, naechster.ziel)}>{naechster.label}</Button>
            ))}
          {buendeln
            ? menuItems.length > 0 && (
                <Dropdown trigger={['click']} menu={{ items: menuItems }}>
                  <Button
                    type="text"
                    aria-label={`Aktionen zu Meldung ${m.lfd_nr}`}
                    icon={<IkonePunkteSenkrecht />}
                  />
                </Dropdown>
              )
            : weitere.map((w) => (
                <Button key={w.key} onClick={w.onClick}>
                  {w.label}
                </Button>
              ))}
        </Space>
      )}
      <Modal
        open={erledigtOffen}
        title="Meldung auf „Erledigt“ setzen?"
        okText="Bestätigen"
        cancelText="Abbrechen"
        onOk={() => {
          setErledigtOffen(false);
          onStatus?.(m.id, 'erledigt');
        }}
        onCancel={() => setErledigtOffen(false)}
      />
    </KommKarte>
  );
}
