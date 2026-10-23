import { Button, Typography } from 'antd';
import type { Gefahrengebiet } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { StatusChip, monoStil, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { NICHT_BEURTEILT } from './beurteilung';

export interface GefahrenBeurteilungProps {
  gebiet: Gefahrengebiet;
  darfSchreiben: boolean;
  /** Die Matrix ist noch nicht geladen: bestätigt würde, was niemand gesehen hat. */
  matrixLaedt: boolean;
  laeuft: boolean;
  /** Grund eines abgelehnten Bestätigens; steht hier, nicht als Toast (LFH-966). */
  fehler?: unknown;
  onBestaetigen: () => void;
  /** Klasse der Hülle, etwa `gefahren-no-print` (LLH-1364: auf Papier steht sie im Druckkopf). */
  className?: string;
}

/**
 * Beurteilung der Gefahrenmatrix eines Gebiets (LLH-1090, Spec `gefahrenmatrix`). Eine Zelle ohne
 * Bewertung zeigt „keine“; ob jemand die Matrix angesehen hat, steht hier: „beurteilt <DTG> ·
 * Name“ oder „nicht beurteilt“. Der Knopf steht nur mit Schreibrecht da; bestätigen schreibt
 * einen Systemeintrag ins ETB, jede spätere Zelländerung frischt Zeit und Person auf (Server).
 */
export default function GefahrenBeurteilung({
  gebiet,
  darfSchreiben,
  matrixLaedt,
  laeuft,
  fehler,
  onBestaetigen,
  className,
}: GefahrenBeurteilungProps) {
  const { token } = useRollen();
  const { zeitpunkt } = useAnzeigeKonventionen();
  return (
    <div
      data-lfh="gefahrengebiet-beurteilung"
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, marginBottom: 12 }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          // `marginSM` (7/11/16): Aussage und Knopf halten den Zielabstand der Stufe.
          gap: token.marginSM,
        }}
      >
        {gebiet.beurteilt_at ? (
          <Typography.Text data-lfh="beurteilung-stand">
            beurteilt <span style={monoStil(token.fontSize)}>{zeitpunkt(gebiet.beurteilt_at)}</span>
            {gebiet.beurteilt_von_name ? ` · ${gebiet.beurteilt_von_name}` : ''}
          </Typography.Text>
        ) : (
          <StatusChip ton="achtung" wort={NICHT_BEURTEILT} />
        )}
        {darfSchreiben && (
          // Keine Größen-Prop: die Trefffläche kommt vom ConfigProvider (`controlHeight`).
          <Button onClick={onBestaetigen} loading={laeuft} disabled={matrixLaedt}>
            Beurteilung bestätigen
          </Button>
        )}
      </div>
      {fehler != null && (
        <div data-fehler>
          <SpeicherFehler fehler={fehler} titel="Beurteilung nicht bestätigt" />
        </div>
      )}
    </div>
  );
}
