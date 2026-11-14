import { useCallback, useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paneel, PaneelZustand, StatusChip, useRollen } from '../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { SeitenStandVeraltet } from '../components/SeitenZustand';
import { ApiError } from '../api/client';
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

/**
 * Dieselbe Akte: ID und Kennung (LLH-1862). Die ID allein trägt nicht, der Server vergibt die ID
 * einer gelöschten Akte neu; die Kennung nennt den Einsatz.
 */
function isGleicheAkte(a: FuehrungAnzeige, b: FuehrungAnzeige): boolean {
  return a.id === b.id && a.kennung === b.kennung;
}

export function EinsaetzeBeimGegenueber({ darfBedienen }: { darfBedienen: boolean }) {
  const { token } = useRollen();
  const qc = useQueryClient();
  // Die beim Öffnen gewählte Akte (LLH-1670): Der Dialog hängt nicht am 30-s-Abruf. Steht sie
  // in der Liste, gilt deren Stand; fällt sie heraus, bleibt der letzte mit Hinweis stehen, samt
  // getipptem Grund, eingegebenem Code und einer Erfolgsmeldung. Eine andere Akte unter derselben
  // ID ist nicht sie (LLH-1862, `isGleicheAkte`).
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
        liste?.map((a) => (isGleicheAkte(a, f) ? f : a)),
      );
      setGewaehlt((g) => (g && isGleicheAkte(g, f) ? f : g));
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
    // Im Bild von „Führung“ auf „Einsatzdaten“ (LLH-1861): `PaneelZustand` polstert selbst.
    return (
      <Paneel titel="Einsätze beim Gegenüber" style={{ marginBlockStart: token.marginMD }}>
        <PaneelZustand
          zustand="fehler"
          titel="Einsätze beim Gegenüber"
          leerText=""
          onNeuladen={() => void q.refetch()}
        >
          {null}
        </PaneelZustand>
      </Paneel>
    );
  }
  const ausDerListe = gewaehlt ? (q.data.find((a) => isGleicheAkte(a, gewaehlt)) ?? null) : null;
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
          // Bedienen darf diese Seite nur ein Admin; er darf auch unterschreiben (LLH-1676).
          <FuehrungPaneel
            key={`${offen.id}:${offen.kennung}`}
            fuehrung={offen}
            darfBedienen={darfBedienen}
            darfUnterschreiben={darfBedienen}
            onGeaendert={nachAktion}
            onLaeuft={setLaeuft}
          />
        )}
      </Modal>
    </Paneel>
  );
}
