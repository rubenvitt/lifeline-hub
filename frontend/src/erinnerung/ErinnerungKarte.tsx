import { Button, Flex, Space, Tooltip, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { Erinnerung } from '../api/types';
import {
  auftraegePfad,
  etbPfad,
  meldungenPfad,
  parseRouteId,
  abloesungPfad,
} from '../routing/deeplinks';
import { ERINNERUNG_STATUS, StatusBadge, QuittungIndikator, formatZeit } from '../kommunikation';
import KommKarte from '../kommunikation/KommKarte';
import { StatusChip, monoStil } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';

const { Text } = Typography;

/** Fachliche Erklärung der beiden Abschluss-Wege. */
const TOOLTIP_QUITTIEREN = 'Quittiert = zur Kenntnis genommen; die Erinnerung erübrigt sich.';
const TOOLTIP_ERLEDIGT = 'Erledigt = die erinnerte Handlung wurde durchgeführt (Vollzug).';

/**
 * bezug_typ → Deeplink-Builder mit Objekt-Selektion + Anzeige-Wort. Ohne Treffer: kein Deeplink.
 */
const BEZUG_LINK: Record<
  string,
  { pfad: (einsatzId: number, id: number) => string; wort: string }
> = {
  auftrag: { pfad: (einsatzId, id) => auftraegePfad(einsatzId, { auftrag: id }), wort: 'Auftrag' },
  meldung: { pfad: (einsatzId, id) => meldungenPfad(einsatzId, { meldung: id }), wort: 'Meldung' },
  etb: { pfad: (einsatzId, id) => etbPfad(einsatzId, { eintrag: id }), wort: 'ETB-Eintrag' },
  // Auto-Fristen einer Ablösungsschicht: die Seite kennt keine Selektion per Query, der Link
  // führt auf die nach Fälligkeit geordnete Liste.
  abloesung: { pfad: (einsatzId) => abloesungPfad(einsatzId), wort: 'Ablösung' },
  abloesung_vorwarnung: { pfad: (einsatzId) => abloesungPfad(einsatzId), wort: 'Ablösung' },
};

/** Deeplink zum Quell-Objekt, sofern bezug_typ/-id gesetzt und Route bekannt. */
function BezugLink({ e, einsatzId }: { e: Erinnerung; einsatzId: string | undefined }) {
  if (!e.bezug_typ || e.bezug_id == null) return null;
  const bezug = BEZUG_LINK[e.bezug_typ];
  const text = `↗ ${bezug?.wort ?? e.bezug_typ} #${e.bezug_id}`;
  const eid = parseRouteId(einsatzId);
  if (!bezug || eid == null) {
    // Unbekannter Bezugstyp oder fehlende/ungültige Einsatz-id → Verweistext ohne Link.
    return <span style={monoStil(11)}>{text}</span>;
  }
  // Verweis als Link mit ↗-Zeichen, kein farbiges Etikett.
  return (
    <Link to={bezug.pfad(eid, e.bezug_id)} style={monoStil(11)}>
      {text}
    </Link>
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
 * Erinnerungs-Karte: Fällig-Hervorhebung über den Kartenrand-Vertrag von `KommKarte`.
 * Quittiert und Erledigt bleiben fachlich getrennt (Tooltips + getrennte Aktionen).
 */
export default function ErinnerungKarte({
  erinnerung: e,
  ansicht = 'offen',
  darfSchreiben,
  onErledigen,
  onQuittieren,
}: ErinnerungKarteProps) {
  const { id: einsatzId } = useParams();
  const status = ERINNERUNG_STATUS[e.status] ?? ERINNERUNG_STATUS.offen;
  const istAbg = ansicht === 'abgeschlossen';
  // `ist_faellig` bleibt auf abgeschlossenen Erinnerungen true → Hervorhebung nur in der Offen-Ansicht.
  const faellig = e.ist_faellig && !istAbg;

  // Beide Schritte schalten mit EINEM Klick; der Rückweg steht im Rückgängig-Toast der Seite
  // (`POST …/erinnerungen/{eid}/oeffnen`). Die Tooltips tragen die Trennung Quittiert/Erledigt.
  const aktionen: ReactNode[] =
    darfSchreiben && !istAbg
      ? [
          <Tooltip key="q" title={TOOLTIP_QUITTIEREN}>
            <Button onClick={() => onQuittieren?.(e.id)}>Quittieren</Button>
          </Tooltip>,
          <Tooltip key="e" title={TOOLTIP_ERLEDIGT}>
            <Button type="primary" onClick={() => onErledigen?.(e.id)}>
              Erledigt
            </Button>
          </Tooltip>,
        ]
      : [];

  return (
    // Die Fälligkeit führt links in Mono; eine fällige Erinnerung trägt den Alarmrand.
    <KommKarte
      alarm={faellig}
      zeit={e.faellig_at ? <ZeitAnzeige wert={e.faellig_at} format="uhrzeit" /> : undefined}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
        <Space size={6} wrap>
          <Text strong style={{ fontSize: 15, lineHeight: 1.4 }}>
            {e.titel}
          </Text>
          {istAbg && <StatusBadge phase={status.phase} label={status.label} />}
          {faellig && <StatusChip ton="alarm" wort="fällig" />}
          {e.intervall_minuten && (
            <StatusChip ton="neutral" wort={`alle ${e.intervall_minuten} Min`} />
          )}
          {e.quelle === 'auto_frist' && <StatusChip ton="achtung" wort="automatisch" />}
          {e.vollzug_status === 'vollzogen' && <StatusChip ton="normal" wort="Vollzogen" />}
          <BezugLink e={e} einsatzId={einsatzId} />
        </Space>
        <Space size={10} wrap>
          {e.faellig_at && (
            <Text type={faellig ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
              {faellig && (
                <span aria-hidden="true">
                  <ClockCircleOutlined />
                </span>
              )}{' '}
              fällig: {formatZeit(e.faellig_at)}
            </Text>
          )}
        </Space>
      </Flex>

      <Space orientation="vertical" size={2} style={{ marginBottom: aktionen.length ? 8 : 0 }}>
        {e.empfaenger_funktion && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            für: {e.empfaenger_funktion}
          </Text>
        )}
        {e.beschreibung && <Text style={{ fontSize: 13 }}>{e.beschreibung}</Text>}
        {istAbg && (
          <Space wrap size={[8, 4]}>
            {/* QuittungIndikator nur bei quittiert: bei erledigt widerspräche „Quittung offen" dem Badge. */}
            {e.status === 'quittiert' && <QuittungIndikator quittiert am={e.quittiert_at} />}
            {e.status === 'erledigt' && e.erledigt_at && (
              <Text type="secondary" style={{ fontSize: 13 }}>
                Erledigt: {formatZeit(e.erledigt_at)}
              </Text>
            )}
            {e.status === 'quittiert' && e.quittiert_at && (
              <Text type="secondary" style={{ fontSize: 13 }}>
                Quittiert: {formatZeit(e.quittiert_at)}
              </Text>
            )}
          </Space>
        )}
      </Space>

      {aktionen.length > 0 && (
        <Flex justify="flex-end" gap={8} wrap style={{ marginTop: 8 }}>
          {aktionen}
        </Flex>
      )}
    </KommKarte>
  );
}
