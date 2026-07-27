import { theme } from 'antd';
import type { ReactNode } from 'react';
import { form } from '../theme/tokens';

interface FeldLabelProps {
  /** Sichtbare Beschriftung — zugleich der Accessible Name des beschrifteten Feldes. */
  text: string;
  /**
   * `id` des beschrifteten Feldes. **Pflicht, nicht optional** (Abweichung vom Plan, gemessen):
   * ein `<label>`, das seine Kinder umschließt, zieht deren Textinhalt in den Accessible Name —
   * ein antd-Select mit gewähltem Wert hieße dann „Fachaufgabe Rettungswesen/Sanität down"
   * statt „Fachaufgabe". Deshalb steht die Beschriftung ÜBER dem Feld statt um es herum, und
   * die Assoziation läuft über `htmlFor`/`id`. Die id kommt am besten aus `useId()` — die
   * Aufrufstellen rendern teils mehrfach nebeneinander.
   */
  htmlFor: string;
  children: ReactNode;
}

/**
 * Feldbeschriftung über dem Feld (A1 Prüfliste Kriterium 15) als echtes `<label>`.
 *
 * Vereint die drei Bauweisen, die es vor LFH-328/A2 gab (Spec §3.3): die `<label>`-Assoziation
 * der Inspector-Variante — die einzige der drei mit korrekter Assoziation — und die Farbe aus
 * dem Theme statt des dort hartkodierten `rgba(0,0,0,0.45)`, das im Dunkelmodus schwarz auf
 * dunklem Grund stand.
 *
 * Die Beschriftung spricht die Metadaten-Stimme aus A0 (Signatur 5): gesperrte Versalien in
 * `form.versalSperrung`, `token.fontSizeSM`, `token.colorTextSecondary`.
 *
 * **Ein Name, nicht zwei:** Wo `FeldLabel` steht, trägt das Feld KEIN `aria-label` mehr —
 * `aria-label` gewinnt gegen `<label>` und entkoppelte sonst den sichtbaren Text vom
 * Accessible Name.
 */
export default function FeldLabel({ text, htmlFor, children }: FeldLabelProps) {
  const { token } = theme.useToken();
  return (
    <div>
      <label
        htmlFor={htmlFor}
        style={{
          display: 'block',
          fontSize: token.fontSizeSM,
          fontWeight: 600,
          color: token.colorTextSecondary,
          letterSpacing: form.versalSperrung,
          textTransform: 'uppercase',
          marginBottom: token.marginXXS,
        }}
      >
        {text}
      </label>
      {children}
    </div>
  );
}
