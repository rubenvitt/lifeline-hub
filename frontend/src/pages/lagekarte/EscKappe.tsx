import Tastenkuerzel from '../../components/Tastenkuerzel';
import './lagekarte.css';

/**
 * Tastenkappe „Esc“ im Knopf, den Esc gerade auslöst (LFH-1083, statt eines Satzes über die
 * Tasten). Der Knopf trägt dazu `aria-keyshortcuts="Escape"`; die Kappe ist `aria-hidden`, der
 * Knopfname bleibt das Wort.
 *
 * Die Klasse `lfh-nur-feiner-zeiger` sitzt an der Hülle, nicht an der Kappe: `Tastenkuerzel`
 * setzt `display` inline, und ein Inline-Stil schlüge das `display: none` der Regel. Touch hat
 * keine Esc-Taste, und die Kappe kostete dort Breite in einer Knopfreihe, die bei 390 px knapp ist.
 *
 * Kein eigener Rand: die Kappe steht immer in einem antd-Knopf, und der trennt seine Kinder schon
 * mit `marginXS`. Ein zweiter Rand verdoppelte die Lücke (in `handschuh` 16 px) und schob die
 * Knopfreihe der Messkarte auf 390 px über den Rand (`e2e/leisten-flaeche.spec.ts`, LLH-1057).
 */
export default function EscKappe() {
  return (
    <span className="lfh-nur-feiner-zeiger" aria-hidden="true" data-lfh="esc-kappe">
      <Tastenkuerzel>Esc</Tastenkuerzel>
    </span>
  );
}
