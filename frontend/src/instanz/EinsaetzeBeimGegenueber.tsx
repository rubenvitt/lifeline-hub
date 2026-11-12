import { useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Paneel, StatusChip, useRollen } from '../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { loadFuehrungFremd } from '../api/fuehrung';
import { globalKeys } from '../api/queryKeys';
import type { FuehrungAnzeige } from '../api/types';
import FuehrungPaneel from './FuehrungPaneel';
import { FUEHRUNG_ART_TEXT, fuehrungKurz } from './fuehrungText';

/**
 * Einsätze beim Gegenüber (LLH-1491, Spec `instanz-fuehrung`): Akten, deren Einsatz nicht hier
 * liegt, mit Führung und Epoche. Ein Admin der Org bedient die Führung von hier (Anfrage,
 * Notübernahme mit Unterschrift oder Code). Ohne Schalter `LIFELINE_FUEHRUNG` antwortet der Server
 * mit 404; dann fehlt der Abschnitt.
 */
export function EinsaetzeBeimGegenueber({ darfBedienen }: { darfBedienen: boolean }) {
  const { token } = useRollen();
  // Die beim Öffnen gewählte Akte (LLH-1670): Der Dialog hängt nicht am 30-s-Abruf. Steht sie
  // noch in der Liste, gilt deren neuerer Stand; fällt sie heraus, bleibt der letzte mit Hinweis
  // stehen, samt getipptem Grund, eingegebenem Code und einer Erfolgsmeldung.
  const [gewaehlt, setGewaehlt] = useState<FuehrungAnzeige | null>(null);
  const q = useQuery({
    queryKey: globalKeys.instanzkopplungFuehrung(),
    queryFn: loadFuehrungFremd,
    refetchInterval: 30_000,
    retry: false,
  });
  if (!q.data) return null;
  const ausDerListe = gewaehlt ? (q.data.find((a) => a.id === gewaehlt.id) ?? null) : null;
  const offen = ausDerListe ?? gewaehlt;
  const nichtMehrGelistet = gewaehlt != null && ausDerListe == null;
  return (
    <Paneel
      titel="Einsätze beim Gegenüber"
      meta={q.data.length}
      koerperPolster
      style={{ marginBlockStart: token.marginMD }}
    >
      <Liste<FuehrungAnzeige>
        bordered
        dataSource={q.data}
        rowKey={(a) => a.id}
        emptyText="Kein Einsatz beim Gegenüber"
        renderItem={(a) => (
          <ListenEintrag
            actions={[
              <Button key="fuehrung" onClick={() => setGewaehlt(a)} data-lfh="fremd-fuehrung">
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
        onCancel={() => setGewaehlt(null)}
        width={640}
        destroyOnHidden
      >
        {nichtMehrGelistet && (
          <Alert
            type="info"
            showIcon
            data-lfh="fremd-fuehrung-nicht-gelistet"
            style={{ marginBlockEnd: token.marginSM }}
            title="Nicht mehr unter „Einsätze beim Gegenüber“"
            description="Stand vom letzten Abruf. Die Führung kann sich inzwischen geändert haben."
          />
        )}
        {offen && <FuehrungPaneel fuehrung={offen} darfBedienen={darfBedienen} />}
      </Modal>
    </Paneel>
  );
}
