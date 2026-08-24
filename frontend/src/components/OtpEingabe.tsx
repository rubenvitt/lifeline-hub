import { Input } from 'antd';
import { useRef } from 'react';

/** Länge eines TOTP-Codes; serverseitig fest (RFC 6238, 6 Stellen). */
const CODE_LAENGE = 6;

interface OtpEingabeProps {
  /** Von `Form.Item` injiziert. */
  value?: string;
  /** Von `Form.Item` injiziert; bekommt JEDE Änderung. */
  onChange?: (wert: string) => void;
  /**
   * Von `Form.Item` injiziert — MUSS durchgereicht werden.
   *
   * Ohne sie trägt das gerenderte `<input>` keine `id`, das `<label for>` des `Form.Item`
   * zeigt ins Leere, und `getByLabelText` findet das Feld nicht mehr (gemessen: zehn
   * Bestandstests fielen so aus, mit „no form control was found associated to that label").
   * Vorlesende Hilfsmittel verlieren dabei denselben Bezug — der Testausfall ist nur die
   * sichtbare Hälfte des Schadens.
   */
  id?: string;
  /** Genau einmal je vollständigem Code — der Weg zum automatischen Absenden. */
  onVoll?: (code: string) => void;
  autoFocus?: boolean;
}

/**
 * Sechsstellige TOTP-Eingabe (LFH-345 · C10, Befund M20).
 *
 * Die Anmeldeseite hatte `inputMode="numeric"`, `pattern`, `maxLength` und die
 * Ziffern-Optik, die Profilseite ein nacktes `<Input>` — dieselbe Aufgabe, zweimal
 * verschieden gebaut, und die schlechtere Hälfte stand dort, wo man 2FA EINRICHTET.
 *
 * ── Warum ein Merker statt eines Effekts ────────────────────────────────────────
 * `onChange` feuert erneut, sobald der Wert wieder sechsstellig ist — eine Korrektur der
 * letzten Ziffer erzeugt also einen zweiten vollen Code. Ohne Riegel liefe daraus ein
 * zweites `enrollFinish`/`totp/finish`, und ein TOTP-Code ist serverseitig genau einmal
 * gültig: der zweite Aufruf scheitert und meldet „Code ungültig" für einen Code, der
 * gerade funktioniert hat. Der Merker hält den zuletzt GEMELDETEN Code, nicht ein Flag auf
 * „ist sechsstellig" — eine Flanke wäre nach dem Rerender längst vorbei (dieselbe
 * Beobachtung wie beim Fokus-Nachlauf in LFH-369).
 *
 * ── Warum keine Größen-Angabe ───────────────────────────────────────────────────
 * Beide Aufrufer trugen `size="large"`. Am Primitiv wäre das eine neue Größen-Prop an einem
 * interaktiven Element und damit ein Verstoß gegen die Dichte-Politik (LFH-333/B5,
 * erzwungen von `components/dichte.guard.test.ts`): die Höhe erbt das Feld vom
 * `ConfigProvider`, die Dichtestufe entscheidet. Die auffällige ZIFFERN-Optik bleibt und
 * kommt aus `login-otp` (Sperrung, tabellarische Ziffern, Schriftgrad).
 */
export default function OtpEingabe({ value, onChange, id, onVoll, autoFocus }: OtpEingabeProps) {
  const zuletztGemeldet = useRef<string | null>(null);

  function beiEingabe(e: React.ChangeEvent<HTMLInputElement>) {
    const wert = e.target.value;
    onChange?.(wert);
    if (wert.length === CODE_LAENGE) {
      if (zuletztGemeldet.current !== wert) {
        zuletztGemeldet.current = wert;
        onVoll?.(wert);
      }
    } else {
      // Unvollständig heisst: der nächste volle Code ist wieder neu, auch wenn er gleich
      // lautet. Ohne dieses Zurücksetzen bliebe ein zweiter Anlauf mit demselben Code still.
      zuletztGemeldet.current = null;
    }
  }

  return (
    <Input
      className="login-otp"
      id={id}
      value={value}
      onChange={beiEingabe}
      autoFocus={autoFocus}
      autoComplete="one-time-code"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={CODE_LAENGE}
    />
  );
}
