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

/**
 * Die Teile eines Einzelauftrags (Change `oxgob5gk-auftraege-befehle-angleichen`, design.md D4).
 * Drei Zusammenstellungen nutzen sie, keine kopiert sie: `AuftragKarte` (Geräteansicht, Palette:
 * alles in der Karte), `AuftragListenKarte` (Liste ohne Handlung) und `AuftragDetail` (Detailpaneel).
 */

const { Text } = Typography;

/** Höchstzahl quittierter Empfänger-Chips; der Rest steht als „+n ✓". */
const QUITTIERT_CHIP_GRENZE = 3;

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

/** Zählzeile „n Empfänger · q/n quittiert“, die Listenkarte und Empfängerblock teilen. */
export function AuftragQuittungsstand({ auftrag: a }: { auftrag: Auftrag }) {
  const { rollen } = useRollen();
  return (
    <Text
      type="secondary"
      style={{ ...monoStil(11), color: rollen.gedaempft, whiteSpace: 'nowrap' }}
    >
      {a.empfaenger_anzahl} Empfänger · {a.quittiert_anzahl}/{a.empfaenger_anzahl} quittiert
    </Text>
  );
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

/** Quittungsstand, quittierte Chips und die Zeile „Quittung offen:“ mit ihren Knöpfen. */
export function AuftragEmpfaenger({
  auftrag: a,
  darfSchreiben,
  quittierungLaeuft,
  quittierungZiel,
  onQuittieren,
  darfQuittierenFuer,
  quittierFehlerGrund,
}: AuftragEmpfaengerProps) {
  // Der Statuschip zeigt nur QUITTIERTE Empfänger; offene stehen in der Zeile „Quittung offen:".
  // Die Zeile hängt NICHT am Schreibrecht, nur ihr Knopf — sonst verlöre ein Beobachter den Namen
  // des offenen Empfängers.
  const istQuittierungZiel = (empfaengerId: number) =>
    !!quittierungLaeuft &&
    quittierungZiel?.auftragId === a.id &&
    quittierungZiel.empfaengerId === empfaengerId;
  // Der optimistische Cache markiert das Ziel sofort als quittiert. Solange der Request
  // läuft, bleibt es trotzdem als ladender Aktionsknopf sichtbar; andere Quittierungen
  // sind serialisiert und damit gesperrt.
  const zielEmpfaenger =
    quittierungLaeuft && quittierungZiel?.auftragId === a.id ? quittierungZiel.empfaengerId : null;
  const [quittierteEmpf, offeneEmpf] = useMemo(
    () => [
      a.empfaenger.filter((e) => e.quittiert_at && e.id !== zielEmpfaenger),
      a.empfaenger.filter((e) => !e.quittiert_at || e.id === zielEmpfaenger),
    ],
    [a.empfaenger, zielEmpfaenger],
  );
  // Die Anzeigegrenze schneidet nur QUITTIERTE Chips: Quittiertes ist Lesestoff, Offenes ist
  // Arbeit und steht immer da. Schnitte sie die ganze Liste, verlöre ein offener Empfänger seinen
  // Knopf, und die Auto-Frist-Erinnerung schlösse nie.
  const sichtbareQuittierte = quittierteEmpf.slice(0, QUITTIERT_CHIP_GRENZE);
  const restQuittierte = quittierteEmpf.length - sichtbareQuittierte.length;
  const darfQuittieren = !!(darfSchreiben && onQuittieren);

  return (
    <>
      <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
        <AuftragQuittungsstand auftrag={a} />
        <Space size={4} wrap>
          {sichtbareQuittierte.map((e) => (
            <StatusChip
              key={e.id}
              ton="normal"
              wort={`${mitBesetzung(e.snap_anzeige, e.aktuelle_besetzung)} ✓`}
            />
          ))}
          {/* „+n" zählt nur verborgene QUITTIERTE — das ✓ sagt es ohne Farbe (WCAG 1.4.1). */}
          {restQuittierte > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              +{restQuittierte} ✓
            </Text>
          )}
        </Space>
      </Flex>

      {/* Quittungs-Aktionen in EIGENER Zeile, nicht als antippbarer Chip: derselbe Chip trägt auch den
         reinen Statuszustand, die Bedienbarkeit hinge sonst allein an der Farbe. Wer für WEN
         quittiert, steht im zugänglichen Namen. */}
      {offeneEmpf.length > 0 && (
        <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            Quittung offen:
          </Text>
          {offeneEmpf.map((e) => (
            <Space key={e.id} size={4}>
              <Text style={{ fontSize: 13 }}>
                {mitBesetzung(e.snap_anzeige, e.aktuelle_besetzung)}
              </Text>
              {darfQuittieren && (darfQuittierenFuer?.(e) ?? true) && (
                <Popconfirm
                  title="Empfang/Kenntnis quittieren?"
                  okText="Empfang quittieren"
                  cancelText="Abbrechen"
                  disabled={quittierungLaeuft}
                  onConfirm={() => {
                    if (!quittierungLaeuft) onQuittieren?.(a.id, e.id);
                  }}
                >
                  <Button
                    aria-label={`Empfang für ${e.snap_anzeige} quittieren`}
                    loading={istQuittierungZiel(e.id)}
                    disabled={quittierungLaeuft}
                  >
                    Quittieren
                  </Button>
                </Popconfirm>
              )}
            </Space>
          ))}
        </Flex>
      )}
      {/* Grund einer abgelehnten Quittung an der Empfängerzeile (LFH-1077, `frontend/AGENTS.md`,
         „Rückwege und Fehler“). Außerhalb der Zeile, weil sie fehlt, sobald alle quittiert sind:
         gerade „bereits quittiert“ bliebe sonst ungesagt. */}
      {quittierFehlerGrund && (
        <div style={{ marginBottom: 8 }}>
          <ZeilenFehler
            fehler={quittierFehlerGrund.fehler}
            fallback={quittierFehlerGrund.fallback}
          />
        </div>
      )}
    </>
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
  return (
    <>
      {/* Grund einer abgelehnten Handlung über ihren Knöpfen, bis zur nächsten Handlung an diesem
         Auftrag (LFH-1077). */}
      {fehlerGrund && (
        <div style={{ marginTop: 8 }}>
          <ZeilenFehler fehler={fehlerGrund.fehler} fallback={fehlerGrund.fallback} />
        </div>
      )}
      {aktionen.length > 0 && (
        <Flex justify={ausrichtung} gap={8} wrap style={{ marginTop: 8 }}>
          {aktionen}
        </Flex>
      )}
    </>
  );
}
