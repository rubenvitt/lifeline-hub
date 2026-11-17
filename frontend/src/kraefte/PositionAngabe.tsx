import { POSITION_KUERZEL, POSITION_LABELS, POSITION_OPTIONEN } from '../api/personal';
import type { StaerkePosition } from '../api/types';
import { InlineAngabe } from '../components/InlineAngabe';
import { Select } from '../components/Select';
import { monoStil } from '../components/instrument';

export interface PositionAngabeProps {
  kennung?: string;
  wert: StaerkePosition | null;
  darfSchreiben: boolean;
  /** Ganze Wörter statt Kürzel (Ansicht); die Liste zeigt F/UF/M. */
  ausgeschrieben?: boolean;
  /** `null` leert die Position. */
  onSpeichern: (neu: StaerkePosition | null) => Promise<unknown>;
}

/**
 * Stärke-Position als Inline-Angabe (LLH-1060 D4/D7): in der Liste das Kürzel F, UF oder M, in der
 * Ansicht das Wort; die Auswahl nennt immer die Wörter. Wählen, dann „Speichern“ — vorher schrieb
 * ein `Select` sofort, und ein Fehlgriff änderte still die Stärke. Das Wort steht als `title` am
 * Kürzel.
 */
export default function PositionAngabe({
  kennung,
  wert,
  darfSchreiben,
  ausgeschrieben = false,
  onSpeichern,
}: PositionAngabeProps) {
  return (
    <InlineAngabe<StaerkePosition | null>
      etikett="Position"
      kennung={kennung}
      wert={wert}
      anzeige={
        wert == null ? null : ausgeschrieben ? (
          POSITION_LABELS[wert]
        ) : (
          <span style={monoStil(13)} title={POSITION_LABELS[wert]}>
            {POSITION_KUERZEL[wert]}
          </span>
        )
      }
      leer={(w) => w == null}
      darfSchreiben={darfSchreiben}
      onSpeichern={onSpeichern}
      eingabe={({ feld, value, onChange, popup }) => (
        <Select<StaerkePosition | null>
          {...feld}
          {...popup}
          value={value ?? undefined}
          allowClear
          placeholder="ohne Position"
          onChange={(v) => onChange(v ?? null)}
          options={POSITION_OPTIONEN}
          popupMatchSelectWidth={false}
          style={{ width: '100%', minWidth: 0 }}
        />
      )}
    />
  );
}
