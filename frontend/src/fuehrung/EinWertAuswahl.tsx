import { useRef, useState } from 'react';
import type { RefSelectProps } from 'antd';
import { Select } from '../components/Select';
import {
  funktionsOptionen,
  type FunktionsOption,
  type FunktionsVorschlaege,
} from './funktionsOptionenKern';

/**
 * Auswahl EINES Empfängers aus dem Funktionskatalog oder als Freitext (LFH-549) — für
 * Erinnerung und Führungsstelle.
 *
 * Tags-Modus, damit Freitext bleibt; die jüngste Wahl ersetzt die alte (`getValueFromEvent` am
 * `Form.Item` des Aufrufers, {@link letzterWert}). Nach einer Wahl schließt die Liste (Blur): im
 * Tags-Modus bliebe sie sonst offen und läge über dem Absende-Knopf — ein Klick träfe erst die
 * Liste. Verlassen übernimmt getippten Freitext, Enter wählt die markierte Zeile.
 */
export function EinWertAuswahl({
  vorschlaege,
  zusatz = [],
  value,
  onChange,
  ...rest
}: {
  vorschlaege: FunktionsVorschlaege;
  /** Optionen vor dem Katalog, z. B. der gespeicherte Wert mit seiner Anzeige. */
  zusatz?: FunktionsOption[];
  value?: string[];
  onChange?: (werte: string[]) => void;
  'aria-label': string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const ref = useRef<RefSelectProps>(null);
  const [suche, setSuche] = useState('');
  const katalogOptionen = funktionsOptionen(vorschlaege, suche);
  const optionen = [
    ...zusatz.filter((z) => !katalogOptionen.some((o) => o.value === z.value)),
    ...katalogOptionen,
  ];
  return (
    <Select
      {...rest}
      ref={ref}
      mode="tags"
      value={value}
      onChange={(werte: string[]) => onChange?.(werte)}
      options={optionen}
      allowClear
      onSearch={setSuche}
      onSelect={() => {
        setSuche('');
        // Erst im nächsten Frame: ein sofortiges Blur übernähme im Tags-Modus den noch stehenden
        // Tipptext („THW“) als zweiten Wert, und der gewänne gegen die Wahl „Fachberater: THW“.
        requestAnimationFrame(() => ref.current?.blur());
      }}
      onBlur={() => setSuche('')}
    />
  );
}

/** Tags-Select mit EINEM Wert: die jüngste Wahl gewinnt (`Form.Item getValueFromEvent`). */
export function letzterWert(werte: string[]): string[] {
  return werte.slice(-1);
}
