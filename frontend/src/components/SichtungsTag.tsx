import { Tag, theme } from 'antd';
import type { CSSProperties } from 'react';
import type { Sichtungskategorie } from '../api/types';
import { sichtung } from '../theme/statusFarben';
import { sichtungsfarben } from '../theme/tokens';

/** Nur für Vorleser: das Wort „ungesichtet“ neben dem sichtbaren Gedankenstrich. */
const NUR_VORLESER: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

type SichtungsTagProps =
  | {
      kategorie: Sichtungskategorie;
      anzahl?: number;
      style?: CSSProperties;
      form?: 'tag';
    }
  | {
      /** `null` heißt ungesichtet: „—“, das Wort steht im zugänglichen Namen. */
      kategorie: Sichtungskategorie | null;
      style?: CSSProperties;
      /**
       * Kompakte Form (LLH-1135) für die Personenmarke im UHS-Grundriss: Farbfeld plus Kürzel in
       * der Schrift der Umgebung, ohne `Tag`-Rahmen und -Polster. Die Marke ist dichteunabhängig
       * so hoch wie ihre Zeile (die belegte Platzkarte plant sie mit 24 px ein); diese Form wird
       * nicht höher als die Schriftzeile.
       */
      form: 'kompakt';
    };

/** LFH-455: Fachfarbe am Farbfeld, lesbare Beschriftung in beiden Modi.
 * Die Umrandung macht auch Gelb auf hellem und Schwarz auf dunklem Grund sichtbar.
 * Das Farbfeld ist kein Bedienziel und trägt bewusst keine Dichte-Mindesthöhe. */
export default function SichtungsTag(props: SichtungsTagProps) {
  const { token } = theme.useToken();
  if (props.form === 'kompakt') return <SichtungKompakt {...props} />;
  const { kategorie, anzahl, style } = props;
  const darstellung = sichtung[kategorie];
  return (
    <Tag
      data-sichtung={kategorie}
      style={{
        ...style,
        color: token.colorText,
        background: 'transparent',
        borderColor: token.colorTextTertiary,
      }}
    >
      {darstellung.farbe && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '0.7em',
            height: '0.7em',
            verticalAlign: 'baseline',
            background: sichtungsfarben[darstellung.farbe],
            border: `1px solid ${token.colorText}`,
            marginInlineEnd: token.marginXXS,
          }}
        />
      )}
      {darstellung.label}
      {anzahl !== undefined ? `: ${anzahl}` : ''}
    </Tag>
  );
}

/**
 * Die Schrift kommt von der Umgebung (`inherit`): auf der Marke ist das deren Textrolle auf ihrem
 * Grund, gemessen in `e2e/uhs-sichtung-wartebereich.spec.ts`. Die Umrandung des Farbfelds liest
 * dieselbe Farbe (`currentColor`), damit sie auf beiden Gründen steht.
 */
function SichtungKompakt({
  kategorie,
  style,
}: {
  kategorie: Sichtungskategorie | null;
  style?: CSSProperties;
}) {
  const { token } = theme.useToken();
  const darstellung = kategorie ? sichtung[kategorie] : null;
  return (
    <span
      data-sichtung={kategorie ?? 'ungesichtet'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginXXS,
        flex: 'none',
        color: 'inherit',
        whiteSpace: 'nowrap',
        position: 'relative',
        ...style,
      }}
    >
      {darstellung?.farbe && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '0.8em',
            height: '0.8em',
            boxSizing: 'border-box',
            background: sichtungsfarben[darstellung.farbe],
            // Ohne Farbe gilt `currentColor`.
            border: '1px solid',
          }}
        />
      )}
      {darstellung ? (
        darstellung.label
      ) : (
        <>
          <span aria-hidden="true">—</span>
          <span style={NUR_VORLESER}>ungesichtet</span>
        </>
      )}
    </span>
  );
}
