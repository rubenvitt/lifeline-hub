import { Button, Collapse, Descriptions, Flex, Popconfirm, Space, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Auftrag } from '../api/types';
import { AUFTRAG_STATUS, PrioBadge, StatusBadge, formatZeit } from '../kommunikation';
import KommKarte from '../kommunikation/KommKarte';
import { StatusChip, monoStil, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { etbPfad } from '../routing/deeplinks';

const { Text } = Typography;

/** Höchstzahl quittierter Empfänger-Chips; der Rest steht als „+n ✓" (LFH-371). */
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

/** Liefert die gesetzten (nicht-null/nicht-leer) Schemafelder eines Auftrags.
 *  erteilt_at ist ein UTC-Zeitstempel → lokal über formatZeit. */
function gefuellteFelder(a: Auftrag): { label: string; wert: string }[] {
  return SCHEMA_FELDER.map(({ key, label, zeit }) => {
    const roh = (a[key] ?? '') as string;
    const wert = zeit && roh ? formatZeit(roh) : roh;
    return { label, wert };
  }).filter(({ wert }) => typeof wert === 'string' && wert.trim() !== '');
}

export interface AuftragKarteProps {
  auftrag: Auftrag;
  ansicht?: 'offen' | 'abgeschlossen';
  einsatzId?: number;
  darfSchreiben?: boolean;
  /** Deeplink-Hervorhebung (?auftrag=, LFH-153): markierte Karte + scroll-adressierbar. */
  hervorgehoben?: boolean;
  quittierungLaeuft?: boolean;
  quittierungZiel?: { auftragId: number; empfaengerId: number } | null;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
  onInArbeit?: (auftragId: number) => void;
  onVollzugMelden?: (auftragId: number) => void;
  onAbnehmen?: (auftragId: number) => void;
}

/**
 * Auftrags-Karte (LFH-112): Karten-Look mit klarer Hierarchie. Ersetzt die frühere
 * List.Item-/Collapse-Darstellung. Überfällig-Hervorhebung ist dark-safe über Theme-Tokens
 * (colorErrorBg/colorError) statt hartkodiertem Rosa.
 */
export default function AuftragKarte({
  auftrag: a,
  ansicht = 'offen',
  einsatzId,
  darfSchreiben,
  hervorgehoben,
  quittierungLaeuft,
  quittierungZiel,
  onQuittieren,
  onInArbeit,
  onVollzugMelden,
  onAbnehmen,
}: AuftragKarteProps) {
  const { rollen } = useRollen();
  const status = AUFTRAG_STATUS[a.bearbeitungsstatus] ?? AUFTRAG_STATUS.offen;
  const ueberfaellig = a.ist_ueberfaellig;
  // Eingangszustand (LFH-343 · C8, Befund H47) — derselbe Fall wie
  // `MELDUNG_STATUS.neu`: ein Auftrag, den noch niemand angefasst hat, trug
  // dasselbe graue Etikett wie einer in Bearbeitung. Der linke Rand ist schon vom
  // Überfällig-Alarm belegt; Gefahr gewinnt, das Etikett bleibt davon unberührt.
  const unbearbeitet = !!status.unbearbeitet && !ueberfaellig;
  const details = gefuellteFelder(a);
  // LFH-372/B5k: der Statuschip zeigt nur QUITTIERTE Empfänger. Offene standen nach
  // LFH-364 doppelt — einmal als Chip, einmal in der Zeile „Quittung offen:" — und
  // kosteten bei drei Empfängern auf `handschuh` eine ganze Kartenzeile. Die Zeile selbst
  // hängt bewusst NICHT am Schreibrecht, nur ihr Knopf: sonst verlöre ein Beobachter mit
  // dem Chip zugleich den Namen des offenen Empfängers.
  const istQuittierungZiel = (empfaengerId: number) =>
    !!quittierungLaeuft &&
    quittierungZiel?.auftragId === a.id &&
    quittierungZiel.empfaengerId === empfaengerId;
  // Der optimistische Cache markiert das Ziel sofort als quittiert. Solange der Request
  // läuft, bleibt es trotzdem als ladender Aktionsknopf sichtbar; andere Quittierungen
  // sind serialisiert und damit gesperrt.
  const quittierteEmpf = a.empfaenger.filter((e) => e.quittiert_at && !istQuittierungZiel(e.id));
  const offeneEmpf = a.empfaenger.filter((e) => !e.quittiert_at || istQuittierungZiel(e.id));
  // LFH-371: die Anzeigegrenze schneidet nur noch die QUITTIERTEN Chips — Quittiertes ist
  // Lesestoff und darf hinter „+n" stehen, Offenes ist Arbeit und steht immer da. Vorher
  // schnitt `slice(0, 3)` die ganze Liste, BEVOR getrennt wurde: waren die ersten drei
  // quittiert, verschwand die Zeile „Quittung offen:", der vierte Empfänger hatte keinen
  // Knopf, `empfaenger_anzahl == quittiert_anzahl` in `src/routes/auftrag.rs` wurde nie
  // wahr und die Auto-Frist-Erinnerung aus LFH-118 schloss nie. Die Zeile wächst mit der
  // Zahl OFFENER Empfänger und schrumpft mit jeder Quittung.
  const sichtbareQuittierte = quittierteEmpf.slice(0, QUITTIERT_CHIP_GRENZE);
  const restQuittierte = quittierteEmpf.length - sichtbareQuittierte.length;
  const darfQuittieren = !!(darfSchreiben && onQuittieren);

  const aktionen: ReactNode[] = darfSchreiben
    ? [
        // EIN Klick (LFH-343 · C8, Befund H50): der Rückfrage-Dialog, der hier stand,
        // kostete die häufigste Routine-Aktion der Karte zwei. Der Rückweg steht
        // im Rückgängig-Toast der Seite; `POST …/vollzug` nimmt seit derselben
        // Änderung `status: 'offen'` an — aber NUR aus `in_arbeit`.
        // „Abnehmen" (unten) behält seine Rückfrage: die Abnahme ist der
        // fachliche Schlusspunkt und hat keinen Rückweg.
        a.bearbeitungsstatus === 'offen' && onInArbeit ? (
          <Button key="ia" onClick={() => onInArbeit(a.id)}>
            In Bearbeitung
          </Button>
        ) : null,
        // „Vollzug melden" öffnet das Modal (= eigene Bestätigung) → kein Popconfirm.
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
            okText="Bestätigen"
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
    // Zeitachsen-Optik (Neuentwurf): Erteilungszeit links in Mono, darunter die Nummer.
    // Der linke Rand ist der Kartenrand-Vertrag aus C8/H47 — überfällig schlägt „offen".
    <KommKarte
      data-auftrag-id={a.id}
      data-ueberfaellig={ueberfaellig ? 'true' : undefined}
      alarm={ueberfaellig}
      unbearbeitet={unbearbeitet}
      hervorgehoben={hervorgehoben}
      zeit={<ZeitAnzeige wert={a.erstellt_at} format="uhrzeit" />}
      nr={a.lfd_nr != null ? `#${a.lfd_nr}` : undefined}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
        <Space size={6} wrap>
          <PrioBadge prio={a.prioritaet} />
          <StatusBadge
            phase={status.phase}
            label={status.label}
            unbearbeitet={!!status.unbearbeitet}
          />
          {a.richtung === 'extern' && <StatusChip ton="neutral" wort="Extern" />}
          {a.quell_etb_eintrag_id != null && einsatzId != null && (
            <Link to={etbPfad(einsatzId, { eintrag: a.quell_etb_eintrag_id })}>↗ ETB-Eintrag</Link>
          )}
        </Space>
        <Space size={10} wrap>
          {ueberfaellig && (
            <Text type="danger" strong style={{ fontSize: 12 }}>
              <span aria-hidden="true">
                <ClockCircleOutlined />
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

      <Text strong style={{ fontSize: 15, lineHeight: 1.4, display: 'block', marginBottom: 8 }}>
        {a.auftrag_text}
      </Text>

      <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
        <Text
          type="secondary"
          style={{ ...monoStil(11), color: rollen.gedaempft, whiteSpace: 'nowrap' }}
        >
          {a.empfaenger_anzahl} Empfänger · {a.quittiert_anzahl}/{a.empfaenger_anzahl} quittiert
        </Text>
        <Space size={4} wrap>
          {sichtbareQuittierte.map((e) => (
            <StatusChip key={e.id} ton="normal" wort={`${e.snap_anzeige} ✓`} />
          ))}
          {/* „+n" zählt nur verborgene QUITTIERTE — das ✓ sagt es ohne Farbe (WCAG 1.4.1). */}
          {restQuittierte > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              +{restQuittierte} ✓
            </Text>
          )}
        </Space>
      </Flex>

      {/* Quittungs-Aktionen in EIGENER Zeile (LFH-364/B5d, Weg (a) des Elterntickets).
          Der zweite Weg — den Empfänger-Chip komplett antippbar machen — ist verworfen:
          derselbe Chip trägt oben auch den reinen Statuszustand (grün + ✓). Antippbar und
          nicht-antippbar sähen dann gleich aus, die Bedienbarkeit hinge allein an der
          Farbe und der zweite Kanal fehlte (WCAG 1.4.1).
          Der Knopftext bleibt wörtlich „quittieren"; wer für WEN quittiert, steht im
          zugänglichen Namen — bei mehreren offenen Empfängern wären sonst mehrere
          gleichnamige Knöpfe nicht auseinanderzuhalten. */}
      {offeneEmpf.length > 0 && (
        <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            Quittung offen:
          </Text>
          {offeneEmpf.map((e) => (
            <Space key={e.id} size={4}>
              <Text style={{ fontSize: 13 }}>{e.snap_anzeige}</Text>
              {darfQuittieren && (
                <Popconfirm
                  title="Empfang/Kenntnis quittieren?"
                  okText="Bestätigen"
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
                    quittieren
                  </Button>
                </Popconfirm>
              )}
            </Space>
          ))}
        </Flex>
      )}

      {ansicht === 'abgeschlossen' && (
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
      )}
      {ansicht !== 'abgeschlossen' && a.vollzugsmeldung && (
        <Text style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
          <Text type="secondary">Vollzug: </Text>
          {a.vollzugsmeldung}
        </Text>
      )}

      {details.length > 0 && (
        <Collapse
          ghost
          style={{ marginInline: -8 }}
          items={[
            {
              key: 'details',
              label: 'Befehlsdetails',
              children: (
                <Descriptions size="small" column={1} bordered>
                  {details.map(({ label, wert }) => (
                    <Descriptions.Item key={label} label={label}>
                      {wert}
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              ),
            },
          ]}
        />
      )}

      {aktionen.length > 0 && (
        <Flex justify="flex-end" gap={8} wrap style={{ marginTop: 8 }}>
          {aktionen}
        </Flex>
      )}
    </KommKarte>
  );
}
