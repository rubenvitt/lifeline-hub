import type { PersonAnlass } from '../api/types';
import FlaechenWahl from './FlaechenWahl';
import { ANLASS_REIHE, ANLASS_WORT } from './personMeta';

const OPTIONEN = ANLASS_REIHE.map((a) => ({ wert: a, label: ANLASS_WORT[a] }));

/**
 * Wahl des Anlasses der Hilfeleistung (LLH-1566) aus dem festen Katalog, als Flächen. Ein Tipp
 * auf den gewählten Anlass nimmt ihn zurück (`null`): eine Person darf ohne Anlass bleiben. Ein
 * Bauteil für Erfassungsmaske und Patientenkopf, Formularvertrag wie ein antd-Feld.
 */
export default function AnlassWahl({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value?: PersonAnlass | null;
  onChange?: (wert: PersonAnlass | null) => void;
  disabled?: boolean;
}) {
  return (
    <FlaechenWahl<PersonAnlass>
      id={id}
      aria-label="Anlass"
      optionen={OPTIONEN}
      value={value ?? null}
      disabled={disabled}
      onChange={(w) => onChange?.(w)}
      onAbwaehlen={() => onChange?.(null)}
    />
  );
}
