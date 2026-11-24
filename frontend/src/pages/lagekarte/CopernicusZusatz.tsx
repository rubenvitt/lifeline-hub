import { Checkbox } from 'antd';
import type { FachebeneStatus } from '../../api/fachebenen';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { monoStil, schriftStil, useRollen } from '../../components/instrument';
import type { CopernicusAktivierung } from './fachebenen';

export interface CopernicusZusatzProps {
  status: FachebeneStatus | undefined;
  /** Auch abgeschlossene Aktivierungen, die älter als 30 Tage sind. Nur im Speicher. */
  archiv: boolean;
  onArchiv: (an: boolean) => void;
  aktivierungen: readonly CopernicusAktivierung[];
}

/**
 * Zusatz unter der Zeile der Copernicus-Ebene (LLH-1200), außerhalb des Zeilenknopfs: die
 * EMSR-Nummern im Ausschnitt mit ihrer jüngsten Aufnahme, bei `leer` ein Hinweis statt eines
 * Fehlers, und der Schalter „Ältere Aktivierungen“.
 *
 * Die Aufnahmezeit steht hier und nicht nur im Inspector: ein Satellitenbild ist Stunden bis Tage
 * alt, und wer die Fläche sieht, muss das Alter mitlesen. „Stand“ der Zeile darüber ist der Abruf
 * durch den Server, nicht die Aufnahme.
 */
export default function CopernicusZusatz({
  status,
  archiv,
  onArchiv,
  aktivierungen,
}: CopernicusZusatzProps) {
  const { token, rollen } = useRollen();
  const { zeitKurz } = useAnzeigeKonventionen();
  return (
    <div
      data-lfh="copernicus-zusatz"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginXXS,
        padding: token.paddingSM,
        paddingInlineStart: token.padding,
        ...schriftStil('textKlein'),
        color: rollen.text2,
      }}
    >
      {status === 'leer' && (
        <span data-lfh="copernicus-leer">
          Keine Copernicus-Auswertung im Ausschnitt
          {archiv ? '.' : ' – ältere Aktivierungen sind ausgeblendet.'}
        </span>
      )}
      {aktivierungen.length > 0 && (
        <ul
          aria-label="Copernicus-Aktivierungen im Ausschnitt"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {aktivierungen.map((a) => (
            <li key={a.emsr}>
              <span style={monoStil('monoFein')}>{a.emsr}</span>
              {a.aufnahme && (
                <>
                  {' · Aufnahme '}
                  <span style={monoStil('monoFein')}>{zeitKurz(a.aufnahme)}</span>
                </>
              )}
              {a.unvollstaendig && (
                <span style={{ color: rollen.achtungText }}> · nicht alle Ebenen geladen</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {aktivierungen.some((a) => a.gekuerzt) && (
        <span data-lfh="copernicus-gekuerzt" style={{ color: rollen.achtungText }}>
          Zu viele Ebenen im Ausschnitt – weiter hineinzoomen, um alle zu sehen.
        </span>
      )}
      <Checkbox checked={archiv} onChange={(e) => onArchiv(e.target.checked)}>
        Ältere Aktivierungen
      </Checkbox>
    </div>
  );
}
