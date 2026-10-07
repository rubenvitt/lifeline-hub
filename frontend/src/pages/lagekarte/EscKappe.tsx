import { theme } from 'antd';
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
 */
export default function EscKappe() {
  const { token } = theme.useToken();
  return (
    <span className="lfh-nur-feiner-zeiger" aria-hidden="true" data-lfh="esc-kappe">
      <Tastenkuerzel style={{ marginInlineStart: token.marginXS }}>Esc</Tastenkuerzel>
    </span>
  );
}
