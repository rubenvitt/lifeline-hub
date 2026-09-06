import { Tag, theme } from 'antd';
import type { CSSProperties } from 'react';
import type { Sichtungskategorie } from '../api/types';
import { sichtung } from '../theme/statusFarben';
import { sichtungsfarben } from '../theme/tokens';

/** LFH-455: Fachfarbe am Farbfeld, lesbare Beschriftung in beiden Modi.
 * Die Umrandung macht auch Gelb auf hellem und Schwarz auf dunklem Grund sichtbar.
 * Das Farbfeld ist kein Bedienziel und trägt bewusst keine Dichte-Mindesthöhe. */
export default function SichtungsTag({
  kategorie,
  praefix = '',
  anzahl,
  style,
}: {
  kategorie: Sichtungskategorie;
  praefix?: string;
  anzahl?: number;
  style?: CSSProperties;
}) {
  const { token } = theme.useToken();
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
      {praefix}
      {darstellung.label}
      {anzahl !== undefined ? `: ${anzahl}` : ''}
    </Tag>
  );
}
