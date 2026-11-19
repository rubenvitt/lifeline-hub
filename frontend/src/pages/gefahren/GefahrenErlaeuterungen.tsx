import type { GefahrBewertung } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { Liste, ListenEintrag } from '../../components/Liste';
import { MetaZeile, Stapel, useRollen } from '../../components/instrument';
import GefahrenStufe from './GefahrenStufe';
import { geaendertText, zellTitel, zellenMitErlaeuterung } from './erlaeuterungen';

export interface GefahrenErlaeuterungenProps {
  matrix: readonly GefahrBewertung[];
  /** Tipp auf eine Zeile: mit Schreibrecht öffnet er den Dialog, sonst hebt er die Zelle hervor. */
  onWaehlen: (zelle: GefahrBewertung) => void;
}

/**
 * Liste „Erläuterungen“ unter der Matrix (LLH-1110, Spec `gefahrenmatrix`): je Zelle mit
 * Erläuterung eine Zeile mit Gefahr × Schutzobjekt, Stufe, Text, „gemeldet von“ und „geändert
 * <DTG> · Name“, in der Folge der Matrix. Ohne Erläuterung steht nichts, auch kein Kopf: eine
 * leere Liste wäre eine zweite Aussage neben der Matrix, die nichts sagt.
 *
 * Kopf eine Ebene unter dem Gebietstitel (h3 → h4), an die Liste gebunden (LFH-470). Die Zeile ist
 * das Ziel (`ListenEintrag` mit `onClick`, Tastatur über `KlickbareZeile`); was der Tipp tut,
 * entscheidet die Matrix.
 */
export default function GefahrenErlaeuterungen({ matrix, onWaehlen }: GefahrenErlaeuterungenProps) {
  const { token } = useRollen();
  const { zeitpunkt } = useAnzeigeKonventionen();
  const zellen = zellenMitErlaeuterung(matrix);
  if (zellen.length === 0) return null;
  return (
    <div data-lfh="gefahren-erlaeuterungen" style={{ marginTop: token.margin }}>
      <Liste
        size="small"
        bordered
        kopf={{ inhalt: 'Erläuterungen', unterEbene: 3 }}
        dataSource={zellen}
        rowKey={(z) => z.id}
        renderItem={(z) => (
          <ListenEintrag
            onClick={() => onWaehlen(z)}
            // Trefflächenboden wie die Gebietszeile (`gebietszeileStil`): die Zeile ist ein
            // handgebautes Bedienziel.
            style={{ cursor: 'pointer', minHeight: token.controlHeight }}
          >
            {/* Kein `ListenEintragMeta`: die Zeile ist ein Knopf, und eine Überschrift in einem
                Knopf verliert ihre Rolle. Gliederung trägt der Kopf „Erläuterungen“. */}
            <Stapel abstand="xxs">
              <strong>{zellTitel(z.gefahrentyp, z.schutzobjekt)}</strong>
              <Stapel richtung="zeile" abstand="xs" ausrichten="baseline">
                <GefahrenStufe stufe={z.warnstufe} />
                <span style={{ minWidth: 0, whiteSpace: 'pre-line' }}>
                  {z.beschreibung?.trim()}
                </span>
              </Stapel>
              <MetaZeile>
                <MetaZeile.Teil>
                  {z.gemeldet_von?.trim() && `gemeldet von ${z.gemeldet_von.trim()}`}
                </MetaZeile.Teil>
                <MetaZeile.Teil>{geaendertText(z, zeitpunkt)}</MetaZeile.Teil>
              </MetaZeile>
            </Stapel>
          </ListenEintrag>
        )}
      />
    </div>
  );
}
