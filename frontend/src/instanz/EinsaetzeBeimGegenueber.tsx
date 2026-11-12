import { useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Paneel, StatusChip, useRollen } from '../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { SeitenStandVeraltet } from '../components/SeitenZustand';
import { ApiError, fehlerText } from '../api/client';
import { loadFuehrungFremd } from '../api/fuehrung';
import { globalKeys } from '../api/queryKeys';
import type { FuehrungAnzeige } from '../api/types';
import FuehrungPaneel from './FuehrungPaneel';
import { FUEHRUNG_ART_TEXT, fuehrungKurz } from './fuehrungText';

/**
 * Einsätze beim Gegenüber (LLH-1491, Spec `instanz-fuehrung`): Akten, deren Einsatz nicht hier
 * liegt, mit Führung und Epoche. Ein Admin der Org bedient die Führung von hier (Anfrage,
 * Notübernahme mit Unterschrift oder Code). Ohne Schalter `LIFELINE_FUEHRUNG` antwortet der Server
 * mit 404, einer Führungskraft ohne System-Admin mit 403; dann fehlt der Abschnitt. Jeder andere
 * Ladefehler steht im Abschnitt, ein gescheiterter Neuabruf über der alten Liste (LLH-1675).
 */

/** Ausgeblendet ändert Nachfragen nichts; sonst alle 30 s, auch nach einem Fehler (LLH-1675). */
export function fremdeNachladenAlle(fehler: unknown): number | false {
  return isAusgeblendet(fehler) ? false : 30_000;
}

/**
 * Die Antwort des eigenen Servers, dass der Abschnitt hier nicht gilt: 404 ohne Schalter, 403 ohne
 * Admin-Recht. Ein 404 ohne `{error}`-Umschlag kommt von einem Gateway und ist ein Ladefehler.
 */
function isAusgeblendet(fehler: unknown): boolean {
  if (!(fehler instanceof ApiError)) return false;
  return fehler.status === 403 || (fehler.status === 404 && fehler.vomAnwendungsserver);
}

export function EinsaetzeBeimGegenueber({ darfBedienen }: { darfBedienen: boolean }) {
  const { token } = useRollen();
  const [offenId, setOffenId] = useState<number | null>(null);
  const q = useQuery({
    queryKey: globalKeys.instanzkopplungFuehrung(),
    queryFn: loadFuehrungFremd,
    refetchInterval: (query) => fremdeNachladenAlle(query.state.error),
    retry: false,
  });
  if (q.isError && isAusgeblendet(q.error)) return null;
  if (!q.data) {
    if (!q.isError) return null;
    return (
      <Paneel
        titel="Einsätze beim Gegenüber"
        koerperPolster
        style={{ marginBlockStart: token.marginMD }}
      >
        <Alert
          type="error"
          showIcon
          title="Akten des Gegenübers nicht abrufbar"
          description={fehlerText(q.error, 'Keine Verbindung zum Server')}
          action={<Button onClick={() => void q.refetch()}>Erneut laden</Button>}
        />
      </Paneel>
    );
  }
  const offen = q.data.find((a) => a.id === offenId) ?? null;
  return (
    <Paneel
      titel="Einsätze beim Gegenüber"
      meta={q.data.length}
      koerperPolster
      style={{ marginBlockStart: token.marginMD }}
    >
      {q.isError && (
        <div style={{ marginBlockEnd: token.marginSM }}>
          <SeitenStandVeraltet onWiederholen={() => void q.refetch()} />
        </div>
      )}
      <Liste<FuehrungAnzeige>
        bordered
        dataSource={q.data}
        rowKey={(a) => a.id}
        emptyText="Kein Einsatz beim Gegenüber"
        renderItem={(a) => (
          <ListenEintrag
            actions={[
              <Button key="fuehrung" onClick={() => setOffenId(a.id)} data-lfh="fremd-fuehrung">
                Führung …
              </Button>,
            ]}
          >
            <ListenEintragMeta
              title={
                <span>
                  {a.nummer ? `${a.nummer} ` : ''}
                  {a.bezeichnung}
                  {a.status === 'abgeschlossen' ? ' · abgeschlossen' : ''}
                </span>
              }
              description={
                <span>
                  <StatusChip
                    ton={a.offen ? 'achtung' : a.fuehrend ? 'normal' : 'neutral'}
                    wort={fuehrungKurz({
                      fuehrend: a.fuehrend,
                      bei: a.fuehrer_name,
                      epoche: a.epoche,
                    })}
                  />{' '}
                  {FUEHRUNG_ART_TEXT[a.art]}
                </span>
              }
            />
          </ListenEintrag>
        )}
      />
      <Modal
        open={offen != null}
        title={offen ? offen.bezeichnung : ''}
        footer={null}
        onCancel={() => setOffenId(null)}
        width={640}
        destroyOnHidden
      >
        {offen && <FuehrungPaneel fuehrung={offen} darfBedienen={darfBedienen} />}
      </Modal>
    </Paneel>
  );
}
