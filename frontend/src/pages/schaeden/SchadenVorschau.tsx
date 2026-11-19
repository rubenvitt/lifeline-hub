import { useQuery } from '@tanstack/react-query';
import { Space } from 'antd';
import { monoStil, useRollen } from '../../components/instrument';
import { ladeSchaden, schadenRegistrierAnzeige } from '../../api/einsatzSchaden';
import { einsatzKeys } from '../../api/queryKeys';
import { FRISCH_MS } from '../../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../../command-palette/VorschauZustand';
import SchadenDaten from './SchadenDaten';
import { STATUS_META } from './schadenHelfer';
import { Status } from '../../components/instrument/Status';

/**
 * Lese-Vorschau eines Schadens in der Sprungpalette. Quelle ist der Einzelabruf im Fach
 * `einsatzKeys.schaedenEinzeln`, das der Zeilenabgleich live mitschreibt (LFH-1075), nicht das
 * Detailfach `einsatzKeys.schaden` — das steht in `NICHT_LIVE_KEYS`. Inhalt ist `SchadenDaten` ohne
 * Eingaben, ohne „Auf Karte verorten" und ohne Ort-Zeile (eigener Serverabruf).
 */
export default function SchadenVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const { token } = useRollen();
  const abfrage = useQuery({
    queryKey: einsatzKeys.schaedenEinzeln(einsatzId, id),
    queryFn: () => ladeSchaden(einsatzId, id),
    staleTime: FRISCH_MS,
  });

  return (
    <VorschauZustand abfrage={abfrage} sorte="Der Schaden">
      {(s) => (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap size={token.marginSM}>
            <span style={monoStil('monoGross', 500)}>
              {schadenRegistrierAnzeige(s.registrier_nr)}
            </span>
            <Status darstellung={STATUS_META[s.status]} />
            {s.storniert_at && <Status ton="neutral" wort="storniert" groesse="klein" />}
          </Space>
          <SchadenDaten schaden={s} einsatzId={einsatzId} ortZeile={false} spalten={2} />
        </Space>
      )}
    </VorschauZustand>
  );
}
