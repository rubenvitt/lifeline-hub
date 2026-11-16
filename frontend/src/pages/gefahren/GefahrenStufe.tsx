import type { Warnstufe } from '../../api/types';
import { schriftStil, useRollen, zahlStil } from '../../components/instrument';
import { warnstufeFlaeche } from '../../theme/statusFarben';
import { zellFlaechenStil } from './zellStil';

/**
 * Stufe einer Matrixzelle als Etikett außerhalb der Matrix (LLH-1110: Liste „Erläuterungen“,
 * Inspector eines Gefahrengebiets auf der Lagekarte). Dieselbe Fläche, derselbe Balken und
 * dasselbe Kürzel wie die Zelle (`zellFlaechenStil`), dazu das Wort: so liest man die Stufe hier
 * wie in der Matrix, und das Wort trägt sie ohne Farbe (WCAG 1.4.1).
 */
export default function GefahrenStufe({ stufe }: { stufe: Warnstufe }) {
  const { token } = useRollen();
  const { kuerzel, label } = warnstufeFlaeche[stufe];
  return (
    <span
      data-lfh="gefahren-stufe"
      data-warnstufe={stufe}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: token.marginXXS,
        padding: `0 ${token.paddingXS}px 3px`,
        whiteSpace: 'nowrap',
        ...zellFlaechenStil(stufe, token),
      }}
    >
      <span aria-hidden="true" style={zahlStil('text', 500)}>
        {kuerzel}
      </span>
      {/* Das Wort der Warnstufe: Rolle `warnung`, mindestens 14 px (Spec `schriftskala`). */}
      <span style={schriftStil('warnung')}>{label}</span>
    </span>
  );
}
