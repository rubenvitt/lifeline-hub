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
   * Von `Form.Item` injiziert — MUSS durchgereicht werden. Ohne sie trägt das `<input>` keine
   * `id`, das `<label for>` zeigt ins Leere, und Vorlesende wie `getByLabelText` verlieren den
   * Bezug.
   */
  id?: string;
  /** Genau einmal je vollständigem Code — der Weg zum automatischen Absenden. */
  onVoll?: (code: string) => void;
  autoFocus?: boolean;
}

/**
 * Sechsstellige TOTP-Eingabe (LFH-345 · C10) — eine Bauform für Anmeldung und Profil.
 *
 * ── Warum ein Merker statt eines Effekts ────────────────────────────────────────
 * `onChange` feuert erneut, sobald der Wert wieder sechsstellig ist; eine zweite Meldung mit
 * demselben Code (Einfügen auf die Auswahl, Rerender-Echo) löste ein zweites
 * `enrollFinish`/`totp/finish` aus, und ein TOTP-Code ist serverseitig genau einmal gültig. Der
 * Merker hält den zuletzt GEMELDETEN Code, kein Flag auf „ist sechsstellig" — eine Flanke wäre
 * nach dem Rerender vorbei.
 *
 * **Der Merker überlebt ein `resetFields()` des Aufrufers**: wird das Feld von außen geleert und
 * derselbe Code EINGEFÜGT (ohne kürzeren Zwischenwert), bleibt das Auto-Absenden aus. Kein
 * Deadlock — der Bestätigen-Knopf ist der Rückfallweg —, aber die Grenze des Riegels.
 *
 * ── Warum keine Größen-Angabe ───────────────────────────────────────────────────
 * Eine Größen-Prop an einem interaktiven Element verstieße gegen die Dichte-Politik
 * (`components/dichte.guard.test.ts`): die Höhe erbt das Feld vom `ConfigProvider`. Die
 * Ziffern-Optik kommt aus `login-otp` (Sperrung, tabellarische Ziffern, Schriftgrad).
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
      // Unvollständig heißt: der nächste volle Code ist wieder neu, auch wenn er gleich lautet.
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
