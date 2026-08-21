import { Button, Card, Flex, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { Erinnerung } from '../api/types';
import { auftraegePfad, etbPfad, meldungenPfad, parseRouteId } from '../routing/deeplinks';
import { ERINNERUNG_STATUS, StatusBadge, QuittungIndikator, formatZeit } from '../kommunikation';

const { Text } = Typography;

/** Fachliche Erklärung der beiden Abschluss-Wege (Kern von LFH-106). */
const TOOLTIP_QUITTIEREN = 'Quittiert = zur Kenntnis genommen; die Erinnerung erübrigt sich.';
const TOOLTIP_ERLEDIGT = 'Erledigt = die erinnerte Handlung wurde durchgeführt (Vollzug).';

/**
 * bezug_typ → zentraler Deeplink-Builder (mit Objekt-Selektion) + Anzeige-Wort. Baut über
 * routing/deeplinks.ts (Quelle der Wahrheit, LFH-25) statt lokaler Route-Literale, damit der
 * Deeplink das referenzierte Objekt selektiert (`?auftrag=`/`?meldung=`/`?eintrag=`) statt nur
 * auf die ungefilterte Liste zu zeigen (F36/LFH-257). Ohne Treffer: kein Deeplink.
 */
const BEZUG_LINK: Record<string, { pfad: (einsatzId: number, id: number) => string; wort: string }> = {
  auftrag: { pfad: (einsatzId, id) => auftraegePfad(einsatzId, { auftrag: id }), wort: 'Auftrag' },
  meldung: { pfad: (einsatzId, id) => meldungenPfad(einsatzId, { meldung: id }), wort: 'Meldung' },
  etb: { pfad: (einsatzId, id) => etbPfad(einsatzId, { eintrag: id }), wort: 'ETB-Eintrag' },
};

/** Deeplink zum Quell-Objekt, sofern bezug_typ/-id gesetzt und Route bekannt. */
function BezugLink({ e, einsatzId }: { e: Erinnerung; einsatzId: string | undefined }) {
  if (!e.bezug_typ || e.bezug_id == null) return null;
  const bezug = BEZUG_LINK[e.bezug_typ];
  const text = `↗ ${bezug?.wort ?? e.bezug_typ} #${e.bezug_id}`;
  const eid = parseRouteId(einsatzId);
  if (!bezug || eid == null) {
    // Unbekannter Bezugstyp oder fehlende/ungültige Einsatz-id → reines Tag ohne Link.
    return <Tag color="cyan" style={{ margin: 0 }}>{text}</Tag>;
  }
  return (
    <Tag color="cyan" style={{ margin: 0 }}>
      <Link to={bezug.pfad(eid, e.bezug_id)}>{text}</Link>
    </Tag>
  );
}

export interface ErinnerungKarteProps {
  erinnerung: Erinnerung;
  /** Steuert die Abschluss-Spalten (Erledigt/Quittiert-Zeitpunkt) in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  darfSchreiben?: boolean;
  onErledigen?: (id: number) => void;
  onQuittieren?: (id: number) => void;
}

/**
 * Erinnerungs-Karte (LFH-112): Karten-Look analog AuftragKarte, ohne Prio. Fällig-/Überfällig-
 * Hervorhebung ist dark-safe über Theme-Tokens (colorErrorBg/colorError) statt hartkodiertem Rosa.
 * Quittiert-vs-Erledigt bleibt fachlich getrennt (Tooltips + getrennte Aktionen, LFH-106).
 */
export default function ErinnerungKarte({
  erinnerung: e, ansicht = 'offen', darfSchreiben, onErledigen, onQuittieren,
}: ErinnerungKarteProps) {
  const { token } = theme.useToken();
  const { id: einsatzId } = useParams();
  const status = ERINNERUNG_STATUS[e.status] ?? ERINNERUNG_STATUS.offen;
  const istAbg = ansicht === 'abgeschlossen';
  // ist_faellig ist ein reiner faellig_at<=jetzt-Vergleich (Backend) und bleibt auf
  // abgeschlossenen Erinnerungen true → Hervorhebung nur in der Offen-Ansicht zeigen.
  const faellig = e.ist_faellig && !istAbg;

  // Beide Schritte schalten mit EINEM Klick (LFH-343 · C8, Befund H50). Der
  // Rückfrage-Dialog, der hier stand, kostete jede Routine-Aktion zwei Klicks; der
  // Rückweg steht stattdessen im Rückgängig-Toast der Seite, und seit derselben
  // Änderung nimmt der Server ihn auch an (`POST …/erinnerungen/{eid}/oeffnen`).
  // Die Tooltips BLEIBEN — sie tragen die fachliche Trennung Quittiert/Erledigt
  // (LFH-106), die der Rückfrage-Dialog nur mit übernommen hatte.
  const aktionen: ReactNode[] = darfSchreiben && !istAbg
    ? [
        <Tooltip key="q" title={TOOLTIP_QUITTIEREN}>
          <Button onClick={() => onQuittieren?.(e.id)}>Quittieren</Button>
        </Tooltip>,
        <Tooltip key="e" title={TOOLTIP_ERLEDIGT}>
          <Button type="primary" onClick={() => onErledigen?.(e.id)}>Erledigt</Button>
        </Tooltip>,
      ]
    : [];

  return (
    <Card
      size="small"
      style={{
        marginBottom: 10,
        borderInlineStart: `3px solid ${faellig ? token.colorError : 'transparent'}`,
        background: faellig ? token.colorErrorBg : undefined,
      }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
        <Space size={6} wrap>
          <Text strong style={{ fontSize: 15, lineHeight: 1.4 }}>{e.titel}</Text>
          {istAbg && <StatusBadge phase={status.phase} label={status.label} />}
          {faellig && <Tag color="red" style={{ margin: 0 }}>fällig</Tag>}
          {e.intervall_minuten && <Tag style={{ margin: 0 }}>alle {e.intervall_minuten} Min</Tag>}
          {e.quelle === 'auto_frist' && <Tag color="orange" style={{ margin: 0 }}>automatisch</Tag>}
          {e.vollzug_status === 'vollzogen' && <Tag color="success" style={{ margin: 0 }}>Vollzogen</Tag>}
          <BezugLink e={e} einsatzId={einsatzId} />
        </Space>
        <Space size={10} wrap>
          {e.faellig_at && (
            <Text type={faellig ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
              {faellig && <ClockCircleOutlined />} fällig: {formatZeit(e.faellig_at)}
            </Text>
          )}
        </Space>
      </Flex>

      <Space orientation="vertical" size={2} style={{ marginBottom: aktionen.length ? 8 : 0 }}>
        {e.empfaenger_funktion && (
          <Text type="secondary" style={{ fontSize: 13 }}>für: {e.empfaenger_funktion}</Text>
        )}
        {e.beschreibung && <Text style={{ fontSize: 13 }}>{e.beschreibung}</Text>}
        {istAbg && (
          <Space wrap size={[8, 4]}>
            {/* QuittungIndikator nur bei quittiert: bei erledigt wäre „Quittung offen"
                neben dem grünen „Erledigt"-Badge irreführend (scheinbarer Widerspruch). */}
            {e.status === 'quittiert' && <QuittungIndikator quittiert am={e.quittiert_at} />}
            {e.status === 'erledigt' && e.erledigt_at && (
              <Text type="secondary" style={{ fontSize: 13 }}>Erledigt: {formatZeit(e.erledigt_at)}</Text>
            )}
            {e.status === 'quittiert' && e.quittiert_at && (
              <Text type="secondary" style={{ fontSize: 13 }}>Quittiert: {formatZeit(e.quittiert_at)}</Text>
            )}
          </Space>
        )}
      </Space>

      {aktionen.length > 0 && (
        <Flex justify="flex-end" gap={8} wrap style={{ marginTop: 8 }}>
          {aktionen}
        </Flex>
      )}
    </Card>
  );
}
