import { Switch } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Formularpaneel, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import {
  ladeLagemonitorFreigaben,
  schalteLagemonitorFreigabe,
} from '../../api/lagemonitorZugaenge';
import { einsatzKeys } from '../../api/queryKeys';
import type { LesezugangFreigabe } from '../../api/types';

/** Zustandszeile einer Freigabe, rein und exportiert für den Test. */
export function freigabeZustand(f: LesezugangFreigabe, zeit: (wert: string) => string): string {
  return [
    f.freigegeben
      ? 'zeigt diesen Einsatz'
      : f.anderer_einsatz
        ? 'zeigt einen anderen Einsatz'
        : null,
    f.zuletzt_genutzt_at ? `zuletzt ${zeit(f.zuletzt_genutzt_at)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Externe Lagemonitore auf der Seite „Geräte“ (LLH-1484). Die Zugänge legt der System-Admin in
 * der Verwaltung an; hier schaltet die Einsatzleitung, ob ein Zugang diesen Einsatz zeigt. Ein
 * Zugang zeigt höchstens einen Einsatz: das Einschalten löst eine Freigabe an einem anderen ab
 * (der Server schreibt das in beide ETBs).
 *
 * Ohne angelegten Zugang bleibt die Sektion weg; ohne aktiven Einsatz steht sie nur zur Ansicht.
 */
export default function EinsatzLagemonitore({
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
    queryKey: einsatzKeys.lagemonitorZugaenge(einsatzId),
    queryFn: () => ladeLagemonitorFreigaben(einsatzId),
  });
  const schalten = useMutation({
    mutationFn: (v: { zugangId: number; an: boolean }) =>
      schalteLagemonitorFreigabe(einsatzId, v.zugangId, v.an),
    onSuccess: (liste) => qc.setQueryData(einsatzKeys.lagemonitorZugaenge(einsatzId), liste),
  });

  const freigaben = freigabenQ.data ?? [];
  if (freigaben.length === 0) return null;
  const zeit = (wert: string) => zeitKurz(wert, konv);

  return (
    <Formularpaneel titel="Externe Lagemonitore" dataUpdatedAt={freigabenQ.dataUpdatedAt}>
      <SpeicherFehler fehler={schalten.error} titel="Nicht umgeschaltet" />
      <Liste<LesezugangFreigabe>
        bordered
        dataSource={freigaben}
        rowKey={(f) => f.zugang_id}
        renderItem={(f) => (
          <ListenEintrag
            actions={[
              <Switch
                key="freigabe"
                aria-label={`Lagemonitor ${f.bezeichnung} zeigt diesen Einsatz`}
                checked={f.freigegeben}
                disabled={!darf || schalten.isPending}
                onChange={(an) => schalten.mutate({ zugangId: f.zugang_id, an })}
              />,
            ]}
          >
            <ListenEintragMeta
              title={<span data-lfh="lagemonitor-titel">{f.bezeichnung}</span>}
              description={
                <span style={{ color: rollen.gedaempft }} data-lfh="lagemonitor-zustand">
                  {freigabeZustand(f, zeit) || 'nicht freigegeben'}
                </span>
              }
            />
          </ListenEintrag>
        )}
      />
    </Formularpaneel>
  );
}
