import {
  bezeichnungsOptionen,
  funktionsOptionen,
  type FunktionsOption,
  type FunktionsVorschlaege,
} from './funktionsOptionenKern';
import { VorschlagsSelect } from './VorschlagsSelect';

/**
 * Auswahl EINES Empfängers aus dem Funktionskatalog oder als Freitext (LFH-549) — für
 * Erinnerung und Führungsstelle.
 *
 * Mehrfach-Select, die jüngste Wahl ersetzt die alte (`getValueFromEvent` am `Form.Item` des
 * Aufrufers, {@link letzterWert}). Tastatur nach der Regel der Vorschlagsfelder (LLH-1753,
 * `VorschlagsSelect`): Enter und Tab nehmen den markierten Katalogtreffer, Freitext nur über
 * „„…“ als Freitext übernehmen“; nach der Wahl schließt die Liste. Verlassen nimmt den Tipptext
 * nur, wenn kein Treffer passt (Entscheidung 20.11.2026), sonst nichts.
 */
export function EinWertAuswahl({
  vorschlaege,
  zusatz = [],
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
  const katalog = funktionsOptionen(vorschlaege);
  const options = [...zusatz.filter((z) => !katalog.some((o) => o.value === z.value)), ...katalog];
  return (
    <VorschlagsSelect
      {...rest}
      gruppen={[{ options }]}
      zusatz={(text) => bezeichnungsOptionen(vorschlaege, text)}
      freitextBeimVerlassen
    />
  );
}

/** Tags-Select mit EINEM Wert: die jüngste Wahl gewinnt (`Form.Item getValueFromEvent`). */
export function letzterWert(werte: string[]): string[] {
  return werte.slice(-1);
}
