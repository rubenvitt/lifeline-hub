import { Alert, Switch } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Formularpaneel, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { loadEinsatzAnbindungen, setAnbindungFreigabe } from '../../api/anbindungen';
import { einsatzKeys } from '../../api/queryKeys';
import type { AnbindungFreigabe } from '../../api/types';
import { RechteText } from './AnbindungDialoge';

/** Zustandszeile einer Freigabe, rein und exportiert für den Test. */
export function freigabeZustand(f: AnbindungFreigabe, zeit: (wert: string) => string): string {
  return [
    f.freigegeben
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
 * Ansicht.
 */
export default function EinsatzAnbindungen({
  einsatzId,
  darf,
}: {
  einsatzId: number;
  darf: boolean;
}) {
  const qc = useQueryClient();
  const { rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();

  const freigabenQ = useQuery({
    queryKey: einsatzKeys.anbindungen(einsatzId),
    queryFn: () => loadEinsatzAnbindungen(einsatzId),
  });
  const schalten = useMutation({
    mutationFn: (v: { zugangId: string; an: boolean }) =>
      setAnbindungFreigabe(einsatzId, v.zugangId, v.an),
    onSuccess: (liste) => qc.setQueryData(einsatzKeys.anbindungen(einsatzId), liste),
  });

  // Ein Ladefehler ist kein „keine Anbindung angelegt“: sichtbar statt still ausgeblendet.
  if (freigabenQ.isError) {
    return <Alert type="error" title="Anbindungen nicht ladbar" showIcon />;
  }
  const freigaben = freigabenQ.data ?? [];
  if (freigaben.length === 0) return null;
  const zeit = (wert: string) => zeitKurz(wert, konv);

  return (
    <Formularpaneel titel="Anbindungen" dataUpdatedAt={freigabenQ.dataUpdatedAt}>
      <SpeicherFehler fehler={schalten.error} titel="Nicht umgeschaltet" />
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
                  checked={f.freigegeben}
                  disabled={!darf || schalten.isPending}
                  onChange={(an) => schalten.mutate({ zugangId: f.zugang_id, an })}
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
                    <span style={{ color: rollen.gedaempft }} data-lfh="einsatz-anbindung-zustand">
                      {freigabeZustand(f, zeit)}
                    </span>
                  </>
                }
              />
            </ListenEintrag>
          </div>
        )}
      />
    </Formularpaneel>
  );
}
