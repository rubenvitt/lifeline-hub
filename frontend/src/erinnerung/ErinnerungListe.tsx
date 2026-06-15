import { Button, Empty, List, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Erinnerung } from '../api/types';
import { ERINNERUNG_STATUS, StatusBadge, QuittungIndikator, formatZeit } from '../kommunikation';

/** Fachliche Erklaerung der beiden Abschluss-Wege (Kern von LFH-106). */
const TOOLTIP_QUITTIEREN = 'Quittiert = zur Kenntnis genommen; die Erinnerung erübrigt sich.';
const TOOLTIP_ERLEDIGT = 'Erledigt = die erinnerte Handlung wurde durchgeführt (Vollzug).';

/** bezug_typ → Modul-Route + Anzeige-Wort. Ohne Treffer: kein Deeplink. */
const BEZUG_ROUTE: Record<string, { modul: string; wort: string }> = {
  auftrag: { modul: 'auftraege', wort: 'Auftrag' },
  meldung: { modul: 'meldungen', wort: 'Meldung' },
};

export interface ErinnerungListeProps {
  erinnerungen: Erinnerung[];
  /** Steuert die Abschluss-Spalten (Erledigt/Quittiert-Zeitpunkt) in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  darfSchreiben: boolean;
  onErledigen: (id: number) => void;
  onQuittieren: (id: number) => void;
}

/** Deeplink zum Quell-Objekt, sofern bezug_typ/-id gesetzt und Route bekannt. */
function BezugLink({ e, einsatzId }: { e: Erinnerung; einsatzId: string | undefined }) {
  if (!e.bezug_typ || e.bezug_id == null) return null;
  const route = BEZUG_ROUTE[e.bezug_typ];
  const text = `↗ ${route?.wort ?? e.bezug_typ} #${e.bezug_id}`;
  if (!route || !einsatzId) {
    // Unbekannter Bezugstyp → reines Tag ohne Link (keine sinnvolle Zielroute bekannt).
    return <Tag color="cyan">{text}</Tag>;
  }
  return (
    <Tag color="cyan">
      <Link to={`/einsaetze/${einsatzId}/${route.modul}`}>{text}</Link>
    </Tag>
  );
}

export default function ErinnerungListe({
  erinnerungen, ansicht = 'offen', darfSchreiben, onErledigen, onQuittieren,
}: ErinnerungListeProps) {
  const { id: einsatzId } = useParams();
  if (erinnerungen.length === 0) return <Empty description="Keine Erinnerungen" />;
  return (
    <List
      dataSource={erinnerungen}
      renderItem={(e) => {
        const status = ERINNERUNG_STATUS[e.status] ?? ERINNERUNG_STATUS.offen;
        const istAbg = ansicht === 'abgeschlossen';
        const aktionen: ReactNode[] = darfSchreiben && !istAbg
          ? [
              <Popconfirm
                key="q"
                title="Zur Kenntnis genommen?"
                description={TOOLTIP_QUITTIEREN}
                okText="Quittieren"
                cancelText="Abbrechen"
                onConfirm={() => onQuittieren(e.id)}
              >
                <Tooltip title={TOOLTIP_QUITTIEREN}>
                  <Button size="small">Quittieren</Button>
                </Tooltip>
              </Popconfirm>,
              <Popconfirm
                key="e"
                title="Handlung durchgeführt?"
                description={TOOLTIP_ERLEDIGT}
                okText="Erledigt"
                cancelText="Abbrechen"
                onConfirm={() => onErledigen(e.id)}
              >
                <Tooltip title={TOOLTIP_ERLEDIGT}>
                  <Button size="small" type="primary">Erledigt</Button>
                </Tooltip>
              </Popconfirm>,
            ]
          : [];
        return (
          <List.Item actions={aktionen.length ? aktionen : undefined}>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Typography.Text strong>{e.titel}</Typography.Text>
                  {istAbg && <StatusBadge phase={status.phase} label={status.label} />}
                  {!istAbg && e.ist_faellig && <Tag color="red">fällig</Tag>}
                  {e.intervall_minuten && <Tag>alle {e.intervall_minuten} Min</Tag>}
                  {e.quelle === 'auto_frist' && <Tag color="orange">automatisch</Tag>}
                  {e.vollzug_status === 'vollzogen' && <Tag color="success">Vollzogen</Tag>}
                  <BezugLink e={e} einsatzId={einsatzId} />
                </Space>
              }
              description={
                <Space direction="vertical" size={2}>
                  <span>fällig: {formatZeit(e.faellig_at)}</span>
                  {e.empfaenger_funktion && <span>für: {e.empfaenger_funktion}</span>}
                  {e.beschreibung && <span>{e.beschreibung}</span>}
                  {istAbg && (
                    <Space wrap size={[8, 4]}>
                      {/* QuittungIndikator nur bei quittiert: bei erledigt wäre „Quittung offen"
                          neben dem grünen „Erledigt"-Badge irreführend (scheinbarer Widerspruch). */}
                      {e.status === 'quittiert' && (
                        <QuittungIndikator quittiert am={e.quittiert_at} />
                      )}
                      {e.status === 'erledigt' && e.erledigt_at && (
                        <Typography.Text type="secondary">Erledigt: {formatZeit(e.erledigt_at)}</Typography.Text>
                      )}
                      {e.status === 'quittiert' && e.quittiert_at && (
                        <Typography.Text type="secondary">Quittiert: {formatZeit(e.quittiert_at)}</Typography.Text>
                      )}
                    </Space>
                  )}
                </Space>
              }
            />
          </List.Item>
        );
      }}
    />
  );
}
