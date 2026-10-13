import { IconUhr } from '../icons';
import { Button, Descriptions, Flex, Popconfirm, Space, Typography } from 'antd';
import { useMemo, type ReactNode } from 'react';
import type { Auftrag, AuftragEmpfaenger } from '../api/types';
import { AUFTRAG_HANDLUNG, AUFTRAG_STATUS, PrioBadge, StatusBadge } from '../kommunikation';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { StatusChip, monoStil, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { etbPfad } from '../routing/deeplinks';
import { mitBesetzung } from '../fuehrung/funktionsOptionenKern';
import { KennungsLink } from '../components/kennungsLink';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import EmpfaengerQuittung, { Quittungsstand } from './EmpfaengerQuittung';
import { READ_LABEL, READ_ORDER } from './auftragsschemaKern';

/**
 * Die Teile eines Einzelauftrags (Change `oxgob5gk-auftraege-befehle-angleichen`, design.md D4).
 * Drei Zusammenstellungen nutzen sie, keine kopiert sie: `AuftragKarte` (Geräteansicht, Palette:
 * alles in der Karte), `AuftragListenKarte` (Liste ohne Handlung) und `AuftragDetail` (Detailpaneel).
 */

const { Text } = Typography;

/**
 * Befehlsschema-Felder für die Read-back-Detailansicht: Folge und Etiketten aus dem Kern, den das
 * Formular teilt (FwDV 100, LLH-1091), danach die Erteilzeit.
 */
const SCHEMA_FELDER: { key: keyof Auftrag; label: string; zeit?: boolean }[] = [
  ...READ_ORDER.map((key) => ({ key, label: READ_LABEL[key] })),
  { key: 'erteilt_at', label: 'Erteilt am', zeit: true },
];

/** Die gesetzten Schemafelder eines Auftrags; `erteilt_at` über `formatZeit` der Anzeigezone. */
export function gefuellteFelder(
  a: Auftrag,
  formatZeit: (wire?: string | null) => string,
): { label: string; wert: string }[] {
  return SCHEMA_FELDER.map(({ key, label, zeit }) => {
    const roh = (a[key] ?? '') as string;
    const wert = zeit && roh ? formatZeit(roh) : roh;
    return { label, wert };
  }).filter(({ wert }) => typeof wert === 'string' && wert.trim() !== '');
}

/** Kennung eines Auftrags („#4“), wie Karte, Detail und zugänglicher Name sie tragen. */
export function auftragKennung(a: Pick<Auftrag, 'lfd_nr'>): string | undefined {
  return a.lfd_nr != null ? `#${a.lfd_nr}` : undefined;
}

/**
 * Zeitspalte der `KommKarte`: Erteilungszeit in Mono mit sichtbarer Beschriftung. `erteilt_at`,
 * nicht `erstellt_at` (LFH-972): ein über Funk erteilter Auftrag wird oft erst später erfasst, und
 * der Überblick zeigt dieselbe Zeit. Die Beschriftung steht im Text, weil ein Tooltip auf Touch nie
 * erscheint.
 */
export function AuftragZeit({ auftrag: a }: { auftrag: Auftrag }) {
  const { rollen } = useRollen();
  return (
    <>
      <span style={{ display: 'block', ...monoStil(10), color: rollen.schwach }}>erteilt</span>
      <span>
        <ZeitAnzeige wert={a.erteilt_at} format="uhrzeit" />
      </span>
    </>
  );
}

/** Eingangszustand der Kante: der linke Rand ist vom Überfällig-Alarm belegt, Gefahr gewinnt. */
export function auftragKante(a: Auftrag): { alarm: boolean; unbearbeitet: boolean } {
  const status = AUFTRAG_STATUS[a.bearbeitungsstatus] ?? AUFTRAG_STATUS.offen;
  return { alarm: a.ist_ueberfaellig, unbearbeitet: !!status.unbearbeitet && !a.ist_ueberfaellig };
}

/** Kopfzeile: Priorität, Phase, Extern, ETB-Sprung; rechts Überfällig und Frist. */
export function AuftragKopf({
  auftrag: a,
  einsatzId,
  mitEtbSprung = true,
}: {
  auftrag: Auftrag;
  einsatzId?: number;
  /** In der Listenkarte ohne Sprung: die Karte trägt nur das Auswahlziel und Kennungs-Links. */
  mitEtbSprung?: boolean;
}) {
  const { rollen } = useRollen();
  // Zeiten in der Anzeigezone, wie im Formular dazu (LFH-692).
  const { formatZeit } = useAnzeigeKonventionen();
  const status = AUFTRAG_STATUS[a.bearbeitungsstatus] ?? AUFTRAG_STATUS.offen;
  return (
    <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
      <Space size={6} wrap>
        <PrioBadge prio={a.prioritaet} />
        <StatusBadge
          phase={status.phase}
          label={status.label}
          unbearbeitet={!!status.unbearbeitet}
          ton={status.ton}
        />
        {a.richtung === 'extern' && <StatusChip ton="neutral" wort="Extern" />}
        {mitEtbSprung && a.quell_etb_eintrag_id != null && einsatzId != null && (
          <KennungsLink to={etbPfad(einsatzId, { eintrag: a.quell_etb_eintrag_id })}>
            ↗ ETB-Eintrag
          </KennungsLink>
        )}
      </Space>
      <Space size={10} wrap>
        {a.ist_ueberfaellig && (
          <Text type="danger" strong style={{ fontSize: 12 }}>
            <span aria-hidden="true">
              <IconUhr />
            </span>{' '}
            Überfällig
          </Text>
        )}
        {a.frist_at && (
          <Text type="secondary" style={{ ...monoStil(11), color: rollen.gedaempft }}>
            Frist {formatZeit(a.frist_at)}
          </Text>
        )}
      </Space>
    </Flex>
  );
}

/** Zählzeile „n Empfänger · q/n quittiert“ eines Auftrags, mit den Zahlen des Servers. */
export function AuftragQuittungsstand({ auftrag: a }: { auftrag: Auftrag }) {
  return <Quittungsstand anzahl={a.empfaenger_anzahl} quittiert={a.quittiert_anzahl} />;
}

export interface AuftragEmpfaengerProps {
  auftrag: Auftrag;
  darfSchreiben?: boolean;
  quittierungLaeuft?: boolean;
  quittierungZiel?: { auftragId: number; empfaengerId: number } | null;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
  /** Welche Empfängerzeilen quittierbar sind; ohne: alle (ein Abschnittsgerät nur seine). */
  darfQuittierenFuer?: (empfaenger: AuftragEmpfaenger) => boolean;
  /** Grund der zuletzt abgelehnten Quittung an diesem Auftrag; steht an der Empfängerzeile. */
  quittierFehlerGrund?: ZeilenGrund | null;
}

/**
 * Empfänger eines Auftrags über den gemeinsamen Block {@link EmpfaengerQuittung}: mit Rückfrage,
 * weil eine Auftragsquittung keinen Rückweg hat (LFH-343).
 */
export function AuftragEmpfaenger({
  auftrag: a,
  darfSchreiben,
  quittierungLaeuft,
  quittierungZiel,
  onQuittieren,
  darfQuittierenFuer,
  quittierFehlerGrund,
}: AuftragEmpfaengerProps) {
  const zeilen = useMemo(
    () =>
      a.empfaenger.map((e) => ({
        id: e.id,
        name: mitBesetzung(e.snap_anzeige, e.aktuelle_besetzung),
        ariaName: e.snap_anzeige,
        quittiertAt: e.quittiert_at,
      })),
    [a.empfaenger],
  );
  // Ein aufgehobener Auftrag erwartet keine Quittung mehr (LLH-1098): kein Knopf, die Zeile
  // nennt die Unquittierten ohne „offen“.
  const aufgehoben = a.bearbeitungsstatus === 'aufgehoben';
  return (
    <EmpfaengerQuittung
      zeilen={zeilen}
      stand={{ anzahl: a.empfaenger_anzahl, quittiert: a.quittiert_anzahl }}
      canQuittieren={!!(darfSchreiben && onQuittieren) && !aufgehoben}
      canQuittierenFor={
        darfQuittierenFuer
          ? (id) => {
              const e = a.empfaenger.find((x) => x.id === id);
              return !!e && darfQuittierenFuer(e);
            }
          : undefined
      }
      isLocked={!!quittierungLaeuft}
      pendingId={quittierungZiel?.auftragId === a.id ? quittierungZiel.empfaengerId : null}
      onQuittieren={(id) => onQuittieren?.(a.id, id)}
      rueckfrage={{ title: 'Empfang/Kenntnis quittieren?', okText: 'Empfang quittieren' }}
      offenLabel={aufgehoben ? 'Nicht quittiert:' : 'Quittung offen:'}
      error={quittierFehlerGrund}
    />
  );
}

/** Zeitpunkt, Person und Grund einer Aufhebung (LLH-1098); an einem anderen Auftrag nichts. */
export function AuftragAufhebung({ auftrag: a }: { auftrag: Auftrag }) {
  const { formatZeit } = useAnzeigeKonventionen();
  if (a.bearbeitungsstatus !== 'aufgehoben') return null;
  return (
    <Space orientation="vertical" size={0} style={{ marginBottom: 8 }}>
      <Text style={{ fontSize: 13 }}>
        {[
          `Aufgehoben am: ${a.aufgehoben_at ? formatZeit(a.aufgehoben_at) : '—'}`,
          a.aufgehoben_von_name,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {a.aufhebungsgrund && <Text style={{ fontSize: 13 }}>{`Grund: ${a.aufhebungsgrund}`}</Text>}
    </Space>
  );
}

/** Vollzug und Abnahme lesend; abgeschlossen mit Zeiten, offen nur der Vollzugsvermerk. */
export function AuftragVollzug({
  auftrag: a,
  ansicht,
}: {
  auftrag: Auftrag;
  ansicht: 'offen' | 'abgeschlossen';
}) {
  const { formatZeit } = useAnzeigeKonventionen();
  if (ansicht === 'abgeschlossen') {
    return (
      <Space orientation="vertical" size={0} style={{ marginBottom: 8 }}>
        {a.vollzogen_at && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            Vollzogen am: {formatZeit(a.vollzogen_at)}
          </Text>
        )}
        {a.abgenommen_at && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            Abgenommen am: {formatZeit(a.abgenommen_at)}
          </Text>
        )}
        {a.vollzugsmeldung && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            Vollzugsvermerk: {a.vollzugsmeldung}
          </Text>
        )}
      </Space>
    );
  }
  if (!a.vollzugsmeldung) return null;
  return (
    <Text style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
      <Text type="secondary">Vollzug: </Text>
      {a.vollzugsmeldung}
    </Text>
  );
}

/** Die gefüllten Schemafelder als Tabelle; ohne Felder nichts. */
export function AuftragSchema({ auftrag: a }: { auftrag: Auftrag }) {
  const { formatZeit } = useAnzeigeKonventionen();
  const details = gefuellteFelder(a, formatZeit);
  if (details.length === 0) return null;
  return (
    <Descriptions size="small" column={1} bordered>
      {details.map(({ label, wert }) => (
        <Descriptions.Item key={label} label={label}>
          {wert}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

export interface AuftragHandlungenProps {
  auftrag: Auftrag;
  darfSchreiben?: boolean;
  onInArbeit?: (auftragId: number) => void;
  onVollzugMelden?: (auftragId: number) => void;
  onAbnehmen?: (auftragId: number) => void;
  /** Öffnet das Formular zum Berichtigen (LLH-1098); nur angeboten, solange `berichtigbar`. */
  onBerichtigen?: (auftragId: number) => void;
  /** Öffnet die Rückfrage „Auftrag aufheben“ (LLH-1098). */
  onAufheben?: (auftragId: number) => void;
  /**
   * Grund der zuletzt abgelehnten Handlung (In Bearbeitung, Rücknahme, Abnahme), aus
   * `components/useZeilenFehler.ts`. Ein stabiles Objekt je Grund, die Karte bleibt `memo`.
   */
  fehlerGrund?: ZeilenGrund | null;
  /** Wo die Knöpfe stehen: in der Karte rechtsbündig, im Detail linksbündig. */
  ausrichtung?: 'flex-start' | 'flex-end';
}

/** Die Knöpfe je Phase, mit Schreibrecht; der Grund einer Ablehnung steht darüber. */
export function AuftragHandlungen({
  auftrag: a,
  darfSchreiben,
  onInArbeit,
  onVollzugMelden,
  onAbnehmen,
  onBerichtigen,
  onAufheben,
  fehlerGrund,
  ausrichtung = 'flex-end',
}: AuftragHandlungenProps) {
  const aktionen: ReactNode[] = darfSchreiben
    ? [
        // EIN Klick; der Rückweg steht im Rückgängig-Toast (`POST …/vollzug` mit `status: 'offen'`, nur
        // aus `in_arbeit`). „Abnehmen" behält seine Rückfrage: die Abnahme hat keinen Rückweg.
        // Der Knopf nennt die Handlung, das Etikett daneben sagt „Offen" (LFH-959).
        a.bearbeitungsstatus === 'offen' && onInArbeit ? (
          <Button key="ia" onClick={() => onInArbeit(a.id)}>
            {AUFTRAG_HANDLUNG.in_arbeit}
          </Button>
        ) : null,
        // „Vollzug melden" öffnet ein Modal (eigene Bestätigung).
        (a.bearbeitungsstatus === 'offen' || a.bearbeitungsstatus === 'in_arbeit') &&
        onVollzugMelden ? (
          <Button key="vm" onClick={() => onVollzugMelden(a.id)}>
            Vollzug melden
          </Button>
        ) : null,
        a.bearbeitungsstatus === 'vollzogen' && onAbnehmen ? (
          <Popconfirm
            key="ab"
            title="Auftrag abnehmen?"
            okText="Auftrag abnehmen"
            cancelText="Abbrechen"
            onConfirm={() => onAbnehmen(a.id)}
          >
            <Button type="primary" ghost>
              Abnehmen
            </Button>
          </Popconfirm>
        ) : null,
      ].filter(Boolean)
    : [];

  /*
   * Berichtigen und Aufheben (LLH-1098). Der `darfSchreiben`-Riegel steht hier, ein Callback ist
   * kein Rechtebeleg. Berichtigen nur an einem offenen Auftrag; nach der ersten Quittung steht es
   * gesperrt mit Grund (LFH-966), der Server liefert die Regel als `berichtigbar`. Aufheben bis
   * zur Abnahme.
   */
  const kannAufheben =
    a.bearbeitungsstatus === 'offen' ||
    a.bearbeitungsstatus === 'in_arbeit' ||
    a.bearbeitungsstatus === 'vollzogen';
  const weitere: MenueEintrag<'berichtigen' | 'aufheben'>[] = darfSchreiben
    ? [
        ...(a.bearbeitungsstatus === 'offen' && onBerichtigen
          ? [
              a.berichtigbar
                ? { key: 'berichtigen' as const, label: 'Berichtigen' }
                : {
                    key: 'berichtigen' as const,
                    label: 'Berichtigen (schon quittiert)',
                    gesperrt: true as const,
                  },
            ]
          : []),
        ...(kannAufheben && onAufheben
          ? [
              {
                key: 'aufheben' as const,
                label: AUFTRAG_HANDLUNG.aufgehoben,
                gefahr: true as const,
              },
            ]
          : []),
      ]
    : [];
  const waehle = (key: 'berichtigen' | 'aufheben') =>
    key === 'berichtigen' ? onBerichtigen?.(a.id) : onAufheben?.(a.id);
  // Gebündelt ab drei Aktionen nach der Rechteprüfung (LFH-365); darunter wäre ein Menü ein Umweg.
  const buendeln = aktionen.length + weitere.length >= 3;
  const kennung = a.lfd_nr != null ? `Auftrag #${a.lfd_nr}` : 'Auftrag';

  return (
    <>
      {/* Grund einer abgelehnten Handlung über ihren Knöpfen, bis zur nächsten Handlung an diesem
         Auftrag (LFH-1077). */}
      {fehlerGrund && (
        <div style={{ marginTop: 8 }}>
          <ZeilenFehler fehler={fehlerGrund.fehler} fallback={fehlerGrund.fallback} />
        </div>
      )}
      {aktionen.length + weitere.length > 0 && (
        <Flex justify={ausrichtung} style={{ marginTop: 8 }}>
          {/* `middle`: Rot steht nicht bündig neben Neutralem (LFH-363). Der Abstands-Guard sieht
             diese gespreizte Reihe nicht und führt die Teile unter BEWERTET_OHNE_SCANNER_DECKUNG. */}
          <Space size="middle" wrap>
            {aktionen}
            {buendeln ? (
              <MenueAusloeser
                eintraege={weitere}
                zugaenglicherName={`Aktionen zu ${kennung}`}
                onWahl={waehle}
              />
            ) : (
              weitere.map((w) => (
                <Button
                  key={w.key}
                  danger={w.gefahr}
                  disabled={w.gesperrt}
                  onClick={() => waehle(w.key)}
                >
                  {w.label}
                </Button>
              ))
            )}
          </Space>
        </Flex>
      )}
    </>
  );
}
