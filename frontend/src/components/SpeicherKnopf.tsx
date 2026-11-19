import { useId } from 'react';
import { Button } from 'antd';
import { useAenderungsanzahl } from './aenderungsstand';
import { Textstufe } from './instrument';

/**
 * „Speichern“ einer Formularseite oder eines `BearbeitbaresPaneel` mit dem Änderungsstand daneben
 * (LLH-1829, Regel `frontend/AGENTS.md`, „Formularseiten“, „Ungespeichertes ist sichtbar“;
 * Wächter `components/speicherKnopf.guard.test.ts`).
 *
 * - Ohne Änderung gesperrt; der Grund steht sichtbar daneben („Keine Änderungen“) und ist per
 *   `aria-describedby` mit dem Knopf verbunden (nie nur im Tooltip).
 * - Ohne `AenderungsstandProvider` bleibt er der alte Knopf: aktiv, ohne Stand.
 * - `disabled` heißt „hier darf niemand speichern“ (kein Schreibrecht, Formular gesperrt): der
 *   Stand entfällt, sonst nennte er „Keine Änderungen“ als falschen Grund. Wer das `<Form>`
 *   sperrt, reicht dieselbe Bedingung hierher; antds `DisabledContext` ist keine öffentliche API.
 * - Steht im `<form>` (`htmlType="submit"`): Enter sendet. Ein gesperrter Knopf unterbindet das
 *   implizite Absenden; wo Enter ohne Änderung schließen soll, trägt das der Aufrufer.
 */

/** Stand in Worten: „Keine Änderungen“, „1 Änderung“, „3 Änderungen“. */
export function aenderungsText(anzahl: number): string {
  if (anzahl === 0) return 'Keine Änderungen';
  return anzahl === 1 ? '1 Änderung' : `${anzahl} Änderungen`;
}

export default function SpeicherKnopf({
  loading,
  disabled,
}: {
  loading?: boolean;
  disabled?: boolean;
}) {
  const anzahl = useAenderungsanzahl();
  const standId = useId();
  const mitStand = anzahl !== null && !disabled;
  const ohneAenderung = mitStand && anzahl === 0;
  return (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--lfh-luft-2)',
      }}
    >
      <Button
        type="primary"
        htmlType="submit"
        loading={loading}
        disabled={disabled || ohneAenderung}
        aria-describedby={mitStand ? standId : undefined}
      >
        Speichern
      </Button>
      {mitStand ? (
        <span aria-live="polite">
          <Textstufe id={standId} stufe="textKlein" ton="text2">
            {aenderungsText(anzahl)}
          </Textstufe>
        </span>
      ) : null}
    </span>
  );
}
