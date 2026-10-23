import { IconUhr } from '../icons';
import { Button, Flex, Modal, Popconfirm, Space, Typography } from 'antd';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { Select } from '../components/Select';
import { memo, useState, type ReactNode } from 'react';
import { auftraegePfad } from '../routing/deeplinks';
import type { Meldung, MeldungKorrekturPatch, MeldungStatus } from '../api/types';
import {
  MELDUNG_HANDLUNG,
  MELDUNG_STATUS,
  PrioBadge,
  QuittungIndikator,
  StatusBadge,
} from '../kommunikation';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import KommKarte from '../kommunikation/KommKarte';
import { StatusChip, monoStil, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { MELDUNGSART_LABEL, istAlarmiert } from './meldungKennzahlen';
import { useGeraetDarf } from '../geraet/geraetSicht';
import BerichtigtMarke from './BerichtigtMarke';
import { KennungsLink } from '../components/kennungsLink';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import MeldungKorrektur, { type FunktionsAuswahl, type VonGruppe } from './MeldungKorrektur';

const { Text } = Typography;

/** Eine Aktion hinter den sichtbaren Knöpfen; `gesperrt` zeigt sie mit Grund statt bedienbar. */
interface WeitereAktion {
  key: string;
  label: string;
  onClick: () => void;
  gesperrt?: true;
}

interface BearbeiterOption {
  benutzer_id: number;
  anzeigename: string;
}

// Modul-spezifische Labels.
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
  /**
   * Korrektur an der Karte (LLH-1066): „Bearbeiten“ öffnet Art, Priorität, Richtung, Von und
   * Empfänger an Ort und Stelle. **Muss bei Ablehnung ablehnen** (`mutateAsync`), dann bleibt die
   * Bearbeitung offen und der Grund steht an der Karte (`fehlerGrund`).
   */
  onKorrigieren?: (meldungId: number, aenderung: MeldungKorrekturPatch) => Promise<unknown>;
  /** Auswahl des Von-Bezugs für „Bearbeiten“; stabil übergeben, die Karte ist `memo`. */
  vonOptionen?: VonGruppe[];
  /** Auswahl der Empfängerfunktion für „Bearbeiten“ (LLH-1381); stabil übergeben. */
  funktionsOptionen?: FunktionsAuswahl;
  /** „Aus der Lage nehmen“ an einer übernommenen Meldung, die keine Lagemeldung ist (LLH-1066). */
  onAusDerLage?: (meldungId: number) => void;
  /**
   * Aufträge ohne Freigabe (LFH-1051, Spec `modul-freigabe`): „Auftrag erteilen“ steht gesperrt
   * mit Grund, wie „Zu Auftrag“ im Chat.
   */
  auftragGesperrt?: boolean;
  /**
   * Grund der zuletzt abgelehnten Karten-Aktion (Status, Bearbeiter, Bestätigen, Korrektur), aus
   * `components/useZeilenFehler.ts`. Ein stabiles Objekt je Grund, die Karte bleibt `memo`.
   */
  fehlerGrund?: ZeilenGrund | null;
  /**
   * Offene Übernahme der Einheit dieser Meldung (LLH-1075, design.md D14): „Übernehmen“ und
   * „Abweisen“ oder, ohne Einheitenrecht, der Sprung zur Einheit. `null` an jeder anderen Karte.
   */
  uebernahme?: ReactNode;
}

/**
 * Bestätigungs-Achse der Sofortmeldung, ORTHOGONAL zum Triage-Status. Bestätigt →
 * QuittungIndikator; unbestätigt mit Frist/Eskalation → eigener Chip mit Frist. Die Uhr steht im
 * Chip „Bestätigung überfällig“, nicht als eigenes „Alarm“ daneben (LFH-959): ein Wort, wie
 * Kennzahlenband, Modulzähler und Lage-Dashboard.
 */
function bestaetigungsAchse(m: Meldung, formatZeit: (wire?: string | null) => string): ReactNode {
  if (!m.bestaetigung_pflicht) return null;
  if (m.ist_bestaetigt) {
    return <QuittungIndikator quittiert von={m.bestaetigt_von_name} am={m.bestaetigt_at} />;
  }
  if (m.ist_ueberfaellig || m.eskaliert) {
    return (
      <StatusChip
        ton="alarm"
        code={
          <span aria-hidden="true">
            <IconUhr />
          </span>
        }
        wort={`Bestätigung überfällig${m.eskaliert ? ' (eskaliert)' : ''}`}
      />
    );
  }
  return (
    <StatusChip
      ton="achtung"
      wort={`Bestätigung offen bis ${formatZeit(m.bestaetigung_frist_at)}`}
    />
  );
}

/**
 * Meldungs-Karte. Die Bestätigungs-Achse bleibt orthogonal zum Triage-Status.
 *
 * Per `memo` (LFH-940): bei unverändertem Bestand rendert keine Karte neu. Das trägt nur, wenn
 * die Seite stabile Rückrufe übergibt (`useCallback` in `MeldungenPage`).
 */
export default memo(MeldungKarte);

function MeldungKarte({
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
  onKorrigieren,
  vonOptionen,
  funktionsOptionen,
  onAusDerLage,
  auftragGesperrt = false,
  fehlerGrund,
  uebernahme = null,
}: MeldungKarteProps) {
  const { rollen, token } = useRollen();
  // Ein Gerät (UHS-Laptop) springt nicht in die Aufträge (LFH-892).
  const darf = useGeraetDarf();
  // Zeiten in der Anzeigezone, wie im Formular dazu (LFH-692).
  const { formatZeit } = useAnzeigeKonventionen();
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
  //  • „Sichten"/„Bearbeitung beginnen" ohne — `setze_status` nimmt jeden Status zurück.
  //  • „Als erledigt melden" mit — die Abgeschlossen-Ansicht trägt keine Aktion zurück. Als `<Modal>` mit
  //    eigenem State, kein `Popconfirm`, und derselbe Pfad, ob sichtbar oder im Menü.
  //  • „Bestätigen" behält seinen `Popconfirm` (sichtbarer Knopf, einmalig).
  const [erledigtOffen, setErledigtOffen] = useState(false);
  //  • „Aus der Lage nehmen" mit — Lage-Text und Verortung gehen dabei verloren (LLH-1066, D5).
  const [ausLageOffen, setAusLageOffen] = useState(false);
  // Korrektur an Ort und Stelle (Kartenmuster bis zum Baustein „Bearbeiten in der Ansicht“).
  const [bearbeiten, setBearbeiten] = useState(false);

  const kannBestaetigen = !!(
    darfSchreiben &&
    m.bestaetigung_pflicht &&
    !m.ist_bestaetigt &&
    onBestaetigen
  );
  // Je Status genau eine Vorwärtsbewegung; `erledigt` hat keine. Der Knopf nennt die Handlung aus
  // `MELDUNG_HANDLUNG`, nicht das Statuswort (LFH-959). Der `darfSchreiben`-Riegel steht
  // HIER: `MeldungenPage` übergibt `onStatus` auch Beobachtern, der Callback ist kein Rechtebeleg.
  const naechster: { ziel: MeldungStatus; label: string } | null = !(darfSchreiben && onStatus)
    ? null
    : m.status === 'neu'
      ? { ziel: 'gesichtet', label: MELDUNG_HANDLUNG.gesichtet }
      : m.status === 'gesichtet'
        ? { ziel: 'in_bearbeitung', label: MELDUNG_HANDLUNG.in_bearbeitung }
        : m.status === 'in_bearbeitung'
          ? { ziel: 'erledigt', label: MELDUNG_HANDLUNG.erledigt }
          : null;

  const weitere: WeitereAktion[] = darfSchreiben
    ? [
        // Was der Primär-Knopf gerade nicht zeigt, bleibt über das Menü erreichbar (z. B. der
        // Direktsprung auf „Als erledigt melden" bei einer neuen Meldung).
        ...(m.status === 'neu' && onStatus
          ? [
              {
                key: 'ib',
                label: MELDUNG_HANDLUNG.in_bearbeitung,
                onClick: () => onStatus(m.id, 'in_bearbeitung'),
              },
            ]
          : []),
        ...(m.status !== 'erledigt' && m.status !== 'in_bearbeitung' && onStatus
          ? [
              {
                key: 'er',
                label: MELDUNG_HANDLUNG.erledigt,
                onClick: () => setErledigtOffen(true),
              },
            ]
          : []),
        ...(onKorrigieren
          ? [{ key: 'bk', label: 'Bearbeiten', onClick: () => setBearbeiten(true) }]
          : []),
        // Übernahme in die Lage und Auftrag öffnen je ein Formular-Modal und tragen ihre Bestätigung
        // selbst. Ein Wort für den Vorgang: „In die Lage übernehmen“, Etikett „In der Lage ✓“
        // (LLH-1046, `frontend/AGENTS.md`, Begriffe).
        ...(!m.lagerelevant && onLagerelevant
          ? [{ key: 'lr', label: 'In die Lage übernehmen', onClick: () => onLagerelevant(m.id) }]
          : []),
        // Eine Lagemeldung steht immer in der Lage (LLH-1031); jede andere Art lässt sich wieder
        // herausnehmen.
        ...(m.lagerelevant && m.meldungsart !== 'lagemeldung' && onAusDerLage
          ? [{ key: 'al', label: 'Aus der Lage nehmen', onClick: () => setAusLageOffen(true) }]
          : []),
        // Ein aufgehobener Auftrag gilt nicht mehr: die Meldung lässt sich erneut überführen, der
        // Server stellt den Rückverweis dann auf den neuen Auftrag um (LLH-1177).
        ...((m.auftrag_id == null || m.is_auftrag_aufgehoben) && onAuftragErteilen
          ? [
              auftragGesperrt
                ? {
                    key: 'ae',
                    label: `Auftrag erteilen (${KEINE_BERECHTIGUNG})`,
                    onClick: () => {},
                    gesperrt: true as const,
                  }
                : { key: 'ae', label: 'Auftrag erteilen', onClick: () => onAuftragErteilen(m) },
            ]
          : []),
      ]
    : [];

  // Gebündelt wird ERST AB DREI Aktionen, gezählt NACH Sichtbarkeits- und Rechteprüfung —
  // darunter wäre ein Menü ein Umweg.
  const gesamt = (kannBestaetigen ? 1 : 0) + (naechster ? 1 : 0) + weitere.length;
  const buendeln = gesamt >= 3;
  const zuweisbar = !!(darfSchreiben && onZuweisen);

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
          {m.lagerelevant && <StatusChip ton="bedien" wort="In der Lage ✓" />}
          {m.auftrag_id != null &&
            darf('fremde-module') &&
            (m.is_auftrag_aufgehoben ? (
              <StatusChip ton="neutral" wort="Auftrag aufgehoben" />
            ) : (
              <KennungsLink to={auftraegePfad(einsatzId, { auftrag: m.auftrag_id })}>
                ↗ Auftrag
              </KennungsLink>
            ))}
          {/* Eine ETB-Berichtigung des Eintrags dieser Meldung (LLH-1382): der Wortlaut unten bleibt. */}
          <BerichtigtMarke
            einsatzId={einsatzId}
            berichtigungId={m.etb_berichtigung_id}
            berichtigungLfdNr={m.etb_berichtigung_lfd_nr}
          />
        </Space>
        <Space size={10} wrap>
          {bestaetigungsAchse(m, formatZeit)}
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

      {/* Der Wortlaut ist der Grund der Karte und trägt den größten Schriftgrad (wie `AuftragKarte`);
         Zeilenhöhe 1.5, weil er regelmäßig mehrzeilig ist. Er folgt direkt auf Absender und
         Empfänger, die Verwaltung steht danach (LFH-974): am Handy liegt er so im ersten Schirm. */}
      <Text style={{ fontSize: 15, lineHeight: 1.5, display: 'block' }}>{m.inhalt}</Text>

      <Flex align="center" gap={8} wrap style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ ...monoStil(11), color: rollen.gedaempft }}>
          {WEG_LABEL[m.meldeweg]} · {MELDUNGSART_LABEL[m.meldungsart]} · Ereignis:{' '}
          {formatZeit(m.ereigniszeit)}
        </Text>
        {ansicht === 'abgeschlossen' && m.erledigt_at && (
          <Text type="secondary" style={{ ...monoStil(11), color: rollen.gedaempft }}>
            Erledigt: {formatZeit(m.erledigt_at)}
          </Text>
        )}
        {m.bearbeiter_name && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Bearbeiter: {m.bearbeiter_name}
          </Text>
        )}
      </Flex>

      {uebernahme != null && <div style={{ marginTop: 8 }}>{uebernahme}</div>}
      {/* Grund einer abgelehnten Karten-Aktion über der Aktionszeile, bis zur nächsten Aktion an
         dieser Karte (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“). */}
      {fehlerGrund && (
        <div style={{ marginTop: 8 }}>
          <ZeilenFehler fehler={fehlerGrund.fehler} fallback={fehlerGrund.fallback} />
        </div>
      )}
      {/* Aktionszeile: die Zuweisung links (ein Griff, Triage-Tempo), die Knöpfe rechts. Unter `md`
         bricht die Auswahl in eine eigene Zeile. „Bestätigen" ist der Primärknopf, nicht `danger`
         (LFH-962): die Kenntnisnahme löscht nichts, und Rot bedient nichts. Der weite Abstand
         bleibt als Trennung der Handschuh-Ziele. */}
      {bearbeiten && onKorrigieren && (
        <MeldungKorrektur
          meldung={m}
          vonOptionen={vonOptionen}
          funktionsOptionen={funktionsOptionen}
          onSpeichern={(aenderung) => onKorrigieren(m.id, aenderung)}
          onFertig={() => setBearbeiten(false)}
        />
      )}
      {!bearbeiten && (zuweisbar || gesamt > 0) && (
        <Flex
          justify="space-between"
          align="center"
          // Zwischen Auswahl und Knöpfen derselbe Abstand wie zwischen den Knöpfen (Handschuh).
          gap={token.padding}
          wrap
          style={{ marginTop: 8 }}
        >
          {zuweisbar ? (
            <Select<number | null>
              allowClear
              style={{ minWidth: 180 }}
              placeholder="Bearbeiter zuweisen"
              value={m.bearbeiter_id ?? undefined}
              onChange={(v) => onZuweisen?.(m.id, v ?? null)}
              options={(mitglieder ?? []).map((mi) => ({
                value: mi.benutzer_id,
                label: mi.anzeigename,
              }))}
              aria-label={`Bearbeiter für Meldung ${m.lfd_nr}`}
            />
          ) : (
            <span />
          )}
          {gesamt > 0 && (
            <Space size="middle" wrap style={{ marginLeft: 'auto', justifyContent: 'flex-end' }}>
              {kannBestaetigen && (
                <Popconfirm
                  title="Sofortmeldung bestätigen?"
                  okText="Bestätigen"
                  cancelText="Abbrechen"
                  onConfirm={() => onBestaetigen?.(m.id)}
                >
                  <Button type="primary">Bestätigen</Button>
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
              {buendeln ? (
                // Die Zuordnung hängt am Menü: die Einträge tragen ihre Handlung, der Baustein
                // meldet nur den Schlüssel.
                <MenueAusloeser
                  eintraege={weitere}
                  zugaenglicherName={`Aktionen zu Meldung ${m.lfd_nr}`}
                  onWahl={(key) => weitere.find((w) => w.key === key)?.onClick()}
                />
              ) : (
                weitere.map((w) => (
                  <Button
                    key={w.key}
                    disabled={w.gesperrt}
                    title={w.gesperrt && KEINE_BERECHTIGUNG}
                    onClick={w.onClick}
                  >
                    {w.label}
                  </Button>
                ))
              )}
            </Space>
          )}
        </Flex>
      )}
      <Modal
        open={erledigtOffen}
        title="Meldung auf „Erledigt“ setzen?"
        okText={MELDUNG_HANDLUNG.erledigt}
        cancelText="Abbrechen"
        onOk={() => {
          setErledigtOffen(false);
          onStatus?.(m.id, 'erledigt');
        }}
        onCancel={() => setErledigtOffen(false)}
      />
      <Modal
        open={ausLageOffen}
        title={`Meldung #${m.lfd_nr} aus der Lage nehmen?`}
        okText="Aus der Lage nehmen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        onOk={() => {
          setAusLageOffen(false);
          onAusDerLage?.(m.id);
        }}
        onCancel={() => setAusLageOffen(false)}
      >
        Lage-Text und Verortung gehen verloren, der Wortlaut bleibt.
      </Modal>
    </KommKarte>
  );
}
