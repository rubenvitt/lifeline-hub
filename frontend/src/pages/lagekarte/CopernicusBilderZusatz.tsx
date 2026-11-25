import { Checkbox, Slider } from 'antd';
import type { FachebeneStatus } from '../../api/fachebenen';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { monoStil, schriftStil, useRollen } from '../../components/instrument';
import { useMinutenTakt } from '../../components/useMinutenTakt';
import { isCopernicusAufnahmeAlt } from './copernicusStil';
import type { CopernicusBild } from './fachebenen';

export interface CopernicusBilderZusatzProps {
  status: FachebeneStatus | undefined;
  liste: readonly CopernicusBild[];
  /** Deckkraft der Bilder in Prozent, nur im Speicher. */
  deckkraft: number;
  onDeckkraft: (prozent: number) => void;
  /** Der gemeinsame Archiv-Schalter beider Copernicus-Ebenen (`useFachebenen`). */
  archiv: boolean;
  onArchiv: (an: boolean) => void;
  /**
   * Der Schalter steht an der Zeile der Vektorebene; hier nur, wenn sie aus ist. Zwei Schalter für
   * denselben Zustand läsen sich wie zwei Einstellungen.
   */
  archivHier: boolean;
}

/**
 * Zusatz unter der Zeile der Copernicus-Satellitenbilder (LLH-2021): Deckkraft, je Bild Herkunft
 * und Aufnahmezeit, die Marke für Aufnahmen älter als 24 h. Die Bilder selbst sind keine
 * Klickebene, deshalb steht ihr Alter hier und nicht im Inspector.
 */
export default function CopernicusBilderZusatz({
  status,
  liste,
  deckkraft,
  onDeckkraft,
  archiv,
  onArchiv,
  archivHier,
}: CopernicusBilderZusatzProps) {
  const { token, rollen } = useRollen();
  const { zeitKurz } = useAnzeigeKonventionen();
  const jetzt = useMinutenTakt();
  return (
    <div
      data-lfh="copernicus-bilder-zusatz"
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
        <span data-lfh="copernicus-bilder-leer">
          Keine Satellitenbilder im Ausschnitt
          {archiv ? '.' : ' – ältere Aktivierungen sind ausgeblendet.'}
        </span>
      )}
      {liste.length > 0 && (
        <ul
          aria-label="Satellitenbilder im Ausschnitt"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {liste.map((b) => (
            <li key={b.bild}>
              <span style={monoStil('monoFein')}>{b.emsr}</span>
              {` · ${b.gebiet} · ${b.sensor ?? 'Sensor unbekannt'}`}
              {b.aufnahme && (
                <>
                  {' · '}
                  <span style={monoStil('monoFein')}>{zeitKurz(b.aufnahme)}</span>
                </>
              )}
              {!b.darstellbar && (
                <span style={{ color: rollen.achtungText }}> · nicht darstellbar</span>
              )}
              {b.darstellbar && isCopernicusAufnahmeAlt(b.aufnahme, jetzt) && (
                <span
                  data-lfh="copernicus-bilder-alt"
                  style={{ display: 'block', color: rollen.achtungText }}
                >
                  <span aria-hidden="true">⧖ </span>Satellitenaufnahme vom{' '}
                  <span style={monoStil('monoFein')}>{zeitKurz(b.aufnahme!)}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {liste.some((b) => b.gekuerzt) && (
        <span data-lfh="copernicus-bilder-gekuerzt" style={{ color: rollen.achtungText }}>
          Zu viele Bilder im Ausschnitt – weiter hineinzoomen, um alle zu sehen.
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
        <span>Deckkraft</span>
        <Slider
          ariaLabelForHandle="Deckkraft der Satellitenbilder"
          min={0}
          max={100}
          step={5}
          value={deckkraft}
          onChange={onDeckkraft}
          tooltip={{ formatter: (v) => `${v} %` }}
          style={{ flex: 1, margin: 0 }}
        />
        <span style={monoStil('monoFein')}>{deckkraft} %</span>
      </div>
      {archivHier && (
        <Checkbox checked={archiv} onChange={(e) => onArchiv(e.target.checked)}>
          Ältere Aktivierungen
        </Checkbox>
      )}
    </div>
  );
}
