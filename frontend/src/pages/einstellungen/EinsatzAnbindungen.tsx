import { useId } from 'react';
import { Switch, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GewanderteGruende } from '../../components/GewanderteGruende';
import { Formularpaneel, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import { SeitenFehler } from '../../components/SeitenZustand';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { loadEinsatzAnbindungen, setAnbindungFreigabe } from '../../api/anbindungen';
import { einsatzKeys } from '../../api/queryKeys';
import type { AnbindungFreigabe } from '../../api/types';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import { RechteText } from './AnbindungDialoge';
import { ANBINDUNGEN_ABRUF_MS } from './anbindungAnzeige';

/** Zustandszeile einer Freigabe, rein und exportiert für den Test. */
export function freigabeZustand(f: AnbindungFreigabe, zeit: (wert: string) => string): string {
  return [
    f.ruht
      ? 'Freigabe ruht: Instanz meldet sich bei einem Hub'
      : f.freigegeben
        ? 'liest diesen Einsatz'
        : f.anderer_einsatz
          ? 'liest einen anderen Einsatz'
          : 'nicht freigegeben',
    f.zustand === 'wartet' ? 'wartet auf Schlüssel' : null,
    f.zuletzt_genutzt_at ? `zuletzt ${zeit(f.zuletzt_genutzt_at)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Anbindungen auf der Seite „Geräte“ (LLH-1638, Spec `maschinenzugang`). Die Zugänge legt der
 * System-Admin in der Verwaltung an; hier schaltet die Einsatzleitung, ob eine Anbindung diesen
 * Einsatz liest. Eine Anbindung liest höchstens einen Einsatz: das Einschalten löst eine Freigabe
 * an einem anderen ab (der Server schreibt das in beide ETBs).
 *
 * Ohne freigebbare Anbindung bleibt die Sektion weg; ohne aktiven Einsatz steht sie nur zur
 * Ansicht. Meldet sich die Instanz bei einem Hub, nennt der Server nur Anbindungen, deren
 * Freigabe für diesen Einsatz ruht (`ruht`): sie lässt sich beenden, nicht neu erteilen.
 *
 * Der Stand ändert sich auch von außen: Eine andere Einsatzleitung stellt die Anbindung um, der
 * Admin widerruft sie. Dafür gibt es kein Live-Ereignis (`api/queryKeys.ts`, `NICHT_LIVE_KEYS`),
 * deshalb fragt das Paneel im Takt der Verwaltungsseite nach und nach jedem Umschalten, auch
 * einem gescheiterten. Fehlt die Zeile danach (widerrufen, abgelaufen), steht der Grund der
 * Ablehnung als schließbarer Hinweis im Paneel, auch wenn sonst keine Anbindung mehr da ist
 * (`frontend/AGENTS.md`, „Speicherfehler an die Seite“).
 *
 * Ohne Verbindung sind die Schalter gesperrt, mit Grund. Die Mutation sendet sofort oder
 * scheitert sofort (`networkMode: 'always'`): mit der Vorgabe hielte TanStack sie an und schickte
 * sie bei Rückkehr des Netzes hinaus, auch nach Verlassen der Seite
 * (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“).
 */
export default function EinsatzAnbindungen({
  einsatzId,
  darf,
}: {
  einsatzId: number;
  darf: boolean;
}) {
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const ohneNetz = useOhneVerbindung();
  const grundId = useId();
  const schluessel = einsatzKeys.anbindungen(einsatzId);

  const freigabenQ = useQuery({
    queryKey: schluessel,
    queryFn: () => loadEinsatzAnbindungen(einsatzId),
    refetchInterval: ANBINDUNGEN_ABRUF_MS,
  });
  const schalten = useMutation({
    networkMode: 'always',
    mutationFn: (v: { zugangId: string; name: string; an: boolean }) =>
      setAnbindungFreigabe(einsatzId, v.zugangId, v.an),
    // Ein Abruf, der vor dem Umschalten losging (Takt, Fensterfokus), käme nach der Antwort an
    // und überschriebe den neuen Stand: `setQueryData` bricht ihn nicht ab.
    onMutate: () => qc.cancelQueries({ queryKey: schluessel }),
    onSuccess: (liste) => qc.setQueryData(schluessel, liste),
    // Ein 404 oder 409 heißt: die Zeile ist überholt (widerrufen, abgelaufen, abgeschlossen).
    onError: () => void qc.invalidateQueries({ queryKey: schluessel }),
  });

  const freigaben = freigabenQ.data;
  if (freigaben == null) {
    // Ein Ladefehler ist kein „keine Anbindung angelegt“: sichtbar statt still ausgeblendet.
    if (!freigabenQ.isError) return null;
    return (
      <Formularpaneel titel="Anbindungen">
        <SeitenFehler
          text="Anbindungen nicht ladbar"
          ursache={freigabenQ.error}
          onWiederholen={() => void freigabenQ.refetch()}
          laedt={freigabenQ.isFetching}
        />
      </Formularpaneel>
    );
  }
  // Der Grund einer Ablehnung, deren Zeile nach dem Neuladen fehlt.
  const gewandert =
    schalten.isError && !freigaben.some((f) => f.zugang_id === schalten.variables.zugangId)
      ? schalten.variables
      : null;
  if (freigaben.length === 0 && gewandert == null) return null;
  const zeit = (wert: string) => zeitKurz(wert, konv);
  const gesperrt = !darf || ohneNetz || schalten.isPending;

  return (
    <Formularpaneel titel="Anbindungen" dataUpdatedAt={freigabenQ.dataUpdatedAt}>
      {freigabenQ.isError && (
        <div style={{ marginBlockEnd: token.marginSM }}>
          <SeitenFehler
            text="Stand nicht aktuell: neu laden gescheitert"
            ursache={freigabenQ.error}
            onWiederholen={() => void freigabenQ.refetch()}
            laedt={freigabenQ.isFetching}
          />
        </div>
      )}
      {gewandert != null ? (
        <GewanderteGruende
          gruende={[
            {
              schluessel: gewandert.zugangId,
              kennung: `Anbindung „${gewandert.name}“`,
              grund: { fehler: schalten.error },
            },
          ]}
          onSchliessen={() => schalten.reset()}
        />
      ) : (
        <SpeicherFehler fehler={schalten.error} titel="Nicht umgeschaltet" />
      )}
      {darf && ohneNetz && (
        <Typography.Text
          id={grundId}
          type="secondary"
          data-lfh="einsatz-anbindung-ohne-netz"
          style={{ display: 'block', marginBlockEnd: token.marginXS }}
        >
          {OHNE_VERBINDUNG_NICHT_AENDERBAR}
        </Typography.Text>
      )}
      {freigaben.length > 0 && (
        <Liste<AnbindungFreigabe>
          bordered
          dataSource={freigaben}
          rowKey={(f) => f.zugang_id}
          renderItem={(f) => (
            <div data-lfh="einsatz-anbindung">
              <ListenEintrag
                actions={[
                  <Switch
                    key="freigabe"
                    aria-label={`Anbindung ${f.name} liest diesen Einsatz`}
                    aria-describedby={darf && ohneNetz ? grundId : undefined}
                    checked={f.freigegeben}
                    disabled={gesperrt}
                    onChange={(an) => schalten.mutate({ zugangId: f.zugang_id, name: f.name, an })}
                  />,
                ]}
              >
                <ListenEintragMeta
                  title={<span data-lfh="einsatz-anbindung-titel">{f.name}</span>}
                  description={
                    <>
                      <div style={{ color: rollen.gedaempft }}>
                        <RechteText scopes={f.scopes} />
                      </div>
                      <span
                        style={{ color: rollen.gedaempft }}
                        data-lfh="einsatz-anbindung-zustand"
                      >
                        {freigabeZustand(f, zeit)}
                      </span>
                    </>
                  }
                />
              </ListenEintrag>
            </div>
          )}
        />
      )}
    </Formularpaneel>
  );
}
