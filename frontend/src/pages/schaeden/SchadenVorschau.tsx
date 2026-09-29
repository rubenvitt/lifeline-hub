import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Space, Tag } from 'antd';
import StatusTag from '../../components/StatusTag';
import { monoStil } from '../../components/instrument';
import { schadenRegistrierAnzeige } from '../../api/einsatzSchaden';
import type { Schaden } from '../../api/types';
import { datensatzAbfrage } from '../../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../../command-palette/VorschauZustand';
import SchadenDaten from './SchadenDaten';
import { STATUS_META } from './schadenHelfer';

/**
 * Lese-Vorschau eines Schadens in der Sprungpalette. Quelle ist die (live) Schadensliste, nicht das
 * Detailfach `einsatzKeys.schaden` — das steht in `NICHT_LIVE_KEYS`. Inhalt ist `SchadenDaten` ohne
 * Eingaben, ohne „Auf Karte verorten" und ohne Ort-Zeile (eigener Serverabruf).
 */
export default function SchadenVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const select = useCallback((liste: Schaden[]) => liste.find((s) => s.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.schaeden(einsatzId), select });

  return (
    <VorschauZustand abfrage={abfrage} sorte="Der Schaden">
      {(s) => (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap size={8}>
            <span style={monoStil(14, 500)}>{schadenRegistrierAnzeige(s.registrier_nr)}</span>
            <StatusTag darstellung={STATUS_META[s.status]} />
            {s.storniert_at && <Tag color="default">storniert</Tag>}
          </Space>
          <SchadenDaten schaden={s} einsatzId={einsatzId} ortZeile={false} spalten={2} />
        </Space>
      )}
    </VorschauZustand>
  );
}
