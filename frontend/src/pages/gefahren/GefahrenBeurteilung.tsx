import { Button, Typography } from 'antd';
import type { Gefahrengebiet } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { Stapel, Status, monoStil, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { BESTAETIGT, UNBESTAETIGT } from './beurteilung';

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
 * Bewertung zeigt „keine“; ob jemand die Matrix angesehen hat, steht hier: „bestätigt <DTG> ·
 * Name“ oder „unbestätigt“. Der Knopf steht nur mit Schreibrecht da; bestätigen schreibt
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
      style={{ marginBottom: token.margin }}
    >
      <Stapel abstand="xs">
        {/* `sm` (8/12/16): Aussage und Knopf halten den Zielabstand der Stufe. */}
        <Stapel richtung="zeile" umbruch abstand="sm" ausrichten="mitte">
          {gebiet.beurteilt_at ? (
            <Typography.Text data-lfh="beurteilung-stand">
              {BESTAETIGT}{' '}
              <span style={monoStil(token.fontSize)}>{zeitpunkt(gebiet.beurteilt_at)}</span>
              {gebiet.beurteilt_von_name ? ` · ${gebiet.beurteilt_von_name}` : ''}
            </Typography.Text>
          ) : (
            <Status groesse="klein" ton="achtung" wort={UNBESTAETIGT} />
          )}
          {darfSchreiben && (
            // Keine Größen-Prop: die Trefffläche kommt vom ConfigProvider (`controlHeight`).
            <Button onClick={onBestaetigen} loading={laeuft} disabled={matrixLaedt}>
              Beurteilung bestätigen
            </Button>
          )}
        </Stapel>
        {fehler != null && (
          <div data-fehler>
            <SpeicherFehler fehler={fehler} titel="Beurteilung nicht bestätigt" />
          </div>
        )}
      </Stapel>
    </div>
  );
}
