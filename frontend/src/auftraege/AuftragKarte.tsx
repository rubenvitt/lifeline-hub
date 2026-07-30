import {
  Button, Card, Collapse, Descriptions, Flex, Popconfirm, Space, Tag, Typography, theme,
} from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Auftrag } from '../api/types';
import { AUFTRAG_STATUS, PRIO_META, StatusBadge, formatZeit } from '../kommunikation';
import { etbPfad } from '../routing/deeplinks';

const { Text } = Typography;

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
  return SCHEMA_FELDER
    .map(({ key, label, zeit }) => {
      const roh = (a[key] ?? '') as string;
      const wert = zeit && roh ? formatZeit(roh) : roh;
      return { label, wert };
    })
    .filter(({ wert }) => typeof wert === 'string' && wert.trim() !== '');
}

export interface AuftragKarteProps {
  auftrag: Auftrag;
  ansicht?: 'offen' | 'abgeschlossen';
  einsatzId?: number;
  darfSchreiben?: boolean;
  /** Deeplink-Hervorhebung (?auftrag=, LFH-153): markierte Karte + scroll-adressierbar. */
  hervorgehoben?: boolean;
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
  auftrag: a, ansicht = 'offen', einsatzId, darfSchreiben, hervorgehoben,
  onQuittieren, onInArbeit, onVollzugMelden, onAbnehmen,
}: AuftragKarteProps) {
  const { token } = theme.useToken();
  const status = AUFTRAG_STATUS[a.bearbeitungsstatus] ?? AUFTRAG_STATUS.offen;
  const prio = PRIO_META[a.prioritaet] ?? PRIO_META.normal;
  const ueberfaellig = a.ist_ueberfaellig;
  const sichtbareEmpf = a.empfaenger.slice(0, 3);
  const restEmpf = a.empfaenger.length - sichtbareEmpf.length;
  const details = gefuellteFelder(a);
  // Nur die SICHTBAREN Empfänger bekommen eine Aktion — aus Layoutgründen, damit die
  // Aktionszeile kurz bleibt. Die Daten wären da: `a.empfaenger` trägt jeden Empfänger
  // mit `snap_anzeige` (`src/auftrag/repo.rs`/`empfaenger_von` hat kein LIMIT), nur die
  // ANZEIGE ist auf drei geschnitten.
  // Damit bleibt eine Lücke, die der Bestand vor LFH-364 genauso hatte (der
  // `Typography.Link` sass in derselben `slice(0, 3)`): sind die ersten drei quittiert
  // und ein vierter offen, verschwindet die Zeile und der Auftrag ist nicht mehr voll
  // quittierbar — womit `empfaenger_anzahl == quittiert_anzahl` in
  // `src/routes/auftrag.rs` nie wahr wird und die Auto-Erinnerung aus LFH-118 nicht
  // schliesst. Eigener Task, siehe LFH-371.
  const offeneQuittungen = darfSchreiben && onQuittieren
    ? sichtbareEmpf.filter((e) => !e.quittiert_at)
    : [];

  const aktionen: ReactNode[] = darfSchreiben
    ? [
        a.bearbeitungsstatus === 'offen' && onInArbeit
          ? (
            <Popconfirm
              key="ia"
              title="Auftrag auf „In Bearbeitung“ setzen?"
              okText="Bestätigen"
              cancelText="Abbrechen"
              onConfirm={() => onInArbeit(a.id)}
            >
              <Button>In Bearbeitung</Button>
            </Popconfirm>
          ) : null,
        // „Vollzug melden" öffnet das Modal (= eigene Bestätigung) → kein Popconfirm.
        (a.bearbeitungsstatus === 'offen' || a.bearbeitungsstatus === 'in_arbeit') && onVollzugMelden
          ? <Button key="vm" onClick={() => onVollzugMelden(a.id)}>Vollzug melden</Button> : null,
        a.bearbeitungsstatus === 'vollzogen' && onAbnehmen
          ? (
            <Popconfirm
              key="ab"
              title="Auftrag abnehmen?"
              okText="Bestätigen"
              cancelText="Abbrechen"
              onConfirm={() => onAbnehmen(a.id)}
            >
              <Button type="primary" ghost>Abnehmen</Button>
            </Popconfirm>
          ) : null,
      ].filter(Boolean)
    : [];

  return (
    <Card
      size="small"
      data-auftrag-id={a.id}
      data-hervorgehoben={hervorgehoben ? 'true' : undefined}
      style={{
        marginBottom: 10,
        borderInlineStart: `3px solid ${ueberfaellig ? token.colorError : 'transparent'}`,
        background: ueberfaellig ? token.colorErrorBg : undefined,
        boxShadow: hervorgehoben ? `0 0 0 2px ${token.colorPrimary}` : undefined,
      }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
        <Space size={6} wrap>
          <Tag color={prio.color} style={{ margin: 0, fontWeight: 600 }}>{prio.label}</Tag>
          <StatusBadge phase={status.phase} label={status.label} />
          {a.richtung === 'extern' && <Tag color="purple" style={{ margin: 0 }}>Extern</Tag>}
          {a.quell_etb_eintrag_id != null && einsatzId != null && (
            <Link to={etbPfad(einsatzId, { eintrag: a.quell_etb_eintrag_id })}>↗ ETB-Eintrag</Link>
          )}
        </Space>
        <Space size={10} wrap>
          {ueberfaellig && (
            <Text type="danger" strong style={{ fontSize: 12 }}>
              <ClockCircleOutlined /> Überfällig
            </Text>
          )}
          {a.frist_at && <Text type="secondary" style={{ fontSize: 12 }}>Frist {formatZeit(a.frist_at)}</Text>}
        </Space>
      </Flex>

      <Text strong style={{ fontSize: 15, lineHeight: 1.4, display: 'block', marginBottom: 8 }}>{a.auftrag_text}</Text>

      <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {a.empfaenger_anzahl} Empfänger · {a.quittiert_anzahl}/{a.empfaenger_anzahl} quittiert
        </Text>
        <Space size={4} wrap>
          {sichtbareEmpf.map((e) => (
            <Tag key={e.id} variant="filled" color={e.quittiert_at ? 'green' : 'default'} style={{ margin: 0, fontSize: 12 }}>
              {e.snap_anzeige}{e.quittiert_at ? ' ✓' : ''}
            </Tag>
          ))}
          {restEmpf > 0 && <Text type="secondary" style={{ fontSize: 12 }}>+{restEmpf}</Text>}
        </Space>
      </Flex>

      {/* Quittungs-Aktionen in EIGENER Zeile (LFH-364/B5d, Weg (a) des Elterntickets).
          Der zweite Weg — den Empfänger-Chip komplett antippbar machen — ist verworfen:
          derselbe Tag trägt oben auch den reinen Statuszustand (grün + ✓). Antippbar und
          nicht-antippbar sähen dann gleich aus, die Bedienbarkeit hinge allein an der
          Farbe und der zweite Kanal fehlte (WCAG 1.4.1).
          Der Knopftext bleibt wörtlich „quittieren"; wer für WEN quittiert, steht im
          zugänglichen Namen — bei mehreren offenen Empfängern wären sonst mehrere
          gleichnamige Knöpfe nicht auseinanderzuhalten. */}
      {offeneQuittungen.length > 0 && (
        <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Quittung offen:</Text>
          {offeneQuittungen.map((e) => (
            <Space key={e.id} size={4}>
              <Text style={{ fontSize: 13 }}>{e.snap_anzeige}</Text>
              <Popconfirm
                title="Empfang/Kenntnis quittieren?"
                okText="Bestätigen"
                cancelText="Abbrechen"
                onConfirm={() => onQuittieren?.(a.id, e.id)}
              >
                <Button aria-label={`Empfang für ${e.snap_anzeige} quittieren`}>quittieren</Button>
              </Popconfirm>
            </Space>
          ))}
        </Flex>
      )}

      {ansicht === 'abgeschlossen' && (
        <Space orientation="vertical" size={0} style={{ marginBottom: 8 }}>
          {a.vollzogen_at && <Text type="secondary" style={{ fontSize: 13 }}>Vollzogen am: {formatZeit(a.vollzogen_at)}</Text>}
          {a.abgenommen_at && <Text type="secondary" style={{ fontSize: 13 }}>Abgenommen am: {formatZeit(a.abgenommen_at)}</Text>}
          {a.vollzugsmeldung && <Text type="secondary" style={{ fontSize: 13 }}>Vollzugsvermerk: {a.vollzugsmeldung}</Text>}
        </Space>
      )}
      {ansicht !== 'abgeschlossen' && a.vollzugsmeldung && (
        <Text style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
          <Text type="secondary">Vollzug: </Text>{a.vollzugsmeldung}
        </Text>
      )}

      {details.length > 0 && (
        <Collapse
          ghost
          style={{ marginInline: -8 }}
          items={[{
            key: 'details',
            label: 'Befehlsdetails',
            children: (
              <Descriptions size="small" column={1} bordered>
                {details.map(({ label, wert }) => (
                  <Descriptions.Item key={label} label={label}>{wert}</Descriptions.Item>
                ))}
              </Descriptions>
            ),
          }]}
        />
      )}

      {aktionen.length > 0 && (
        <Flex justify="flex-end" gap={8} wrap style={{ marginTop: 8 }}>
          {aktionen}
        </Flex>
      )}
    </Card>
  );
}
