import { useCallback, useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
 * Admin-Recht. Ohne `{error}`-Umschlag kommt sie von einem Gateway und ist ein Ladefehler.
 */
function isAusgeblendet(fehler: unknown): boolean {
  if (!(fehler instanceof ApiError) || !fehler.vomAnwendungsserver) return false;
  return fehler.status === 403 || fehler.status === 404;
}

export function EinsaetzeBeimGegenueber({ darfBedienen }: { darfBedienen: boolean }) {
  const { token } = useRollen();
  const qc = useQueryClient();
  // Die beim Öffnen gewählte Akte (LLH-1670): Der Dialog hängt nicht am 30-s-Abruf. Steht sie
  // in der Liste, gilt deren Stand; fällt sie heraus, bleibt der letzte mit Hinweis stehen, samt
  // getipptem Grund, eingegebenem Code und einer Erfolgsmeldung.
  const [gewaehlt, setGewaehlt] = useState<FuehrungAnzeige | null>(null);
  // Solange eine Aktion läuft, bleibt der Dialog offen: Ihre Antwort (etwa der einmalige Code)
  // hätte sonst keinen Ort.
  const [laeuft, setLaeuft] = useState(false);
  // Die Antwort einer eigenen Aktion ist der neueste Stand, in der Liste wie im Dialog, bis der
  // nächste Abruf gelingt; danach fällt die Akte oft aus der Liste (eine Notübernahme löscht den
  // Spiegel). Den Dialog betrifft sie nur, solange er noch diese Akte zeigt.
  const nachAktion = useCallback(
    (f: FuehrungAnzeige) => {
      qc.setQueryData<FuehrungAnzeige[]>(globalKeys.instanzkopplungFuehrung(), (liste) =>
        liste?.map((a) => (a.id === f.id ? f : a)),
      );
      setGewaehlt((g) => (g?.id === f.id ? f : g));
    },
    [qc],
  );
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
        onCancel={() => {
          if (!laeuft) setGewaehlt(null);
        }}
        closable={laeuft ? { disabled: true } : true}
        mask={{ closable: !laeuft }}
        keyboard={!laeuft}
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
            description="Zuletzt bekannter Stand. Die Führung kann sich inzwischen geändert haben."
          />
        )}
        {offen && (
          <FuehrungPaneel
            key={offen.id}
            fuehrung={offen}
            darfBedienen={darfBedienen}
            onGeaendert={nachAktion}
            onLaeuft={setLaeuft}
          />
        )}
      </Modal>
    </Paneel>
  );
}
