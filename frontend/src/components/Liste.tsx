import { Empty, Spin, theme } from 'antd';
import { createContext, useContext } from 'react';
import type { CSSProperties, Key, ReactNode } from 'react';

/**
 * Schlanker, nicht-deprecated Ersatz für antd `<List>` (LFH-167).
 *
 * antd 6 hat `List`/`List.Item`/`List.Item.Meta` als deprecated markiert (Entfernung in v7).
 * Dieses Modul bildet die im Projekt genutzte Teilmenge (vertikale Liste, Trennlinien,
 * Größen small/default, bordered, Header, Loading, Leer-Zustand, Item mit Aktionen/Klick,
 * Meta aus Titel + Beschreibung) über Flex-Layout + Theme-Tokens nach. Farben kommen aus
 * `theme.useToken()` → dark-safe.
 *
 * **Innenabstände (LFH-328/T14).** Sie lagen als Pixel-Literale (16/24) bzw. als
 * `paddingContent*` im Code und waren damit von der Dichte-Staffel abgekoppelt: `antdToken()`
 * überschreibt `padding`/`paddingSM`/`paddingXS`/`paddingLG`, **nicht** die `size*`-Map-Tokens,
 * aus denen antd die `paddingContent*`-Aliase ableitet — gemessen bleiben die bei 16/16/12/8,
 * egal welche Dichtestufe gesetzt ist. Deshalb steht hier jetzt die jeweils gleichwertige,
 * dichteabhängige Quelle derselben antd-Alias-Kette (`alias.js`):
 * `paddingContentHorizontalSM`/`padding` ← `size` · `paddingContentHorizontalLG`/`paddingLG`
 * ← `sizeLG` · `paddingContentVertical`/`paddingSM` ← `sizeSM` ·
 * `paddingContentVerticalSM`/`paddingXS` ← `sizeXS`. Unter dem antd-Standardtheme sind die
 * Werte damit unverändert (16/24/12/8), unter `kompakt` fallen sie auf 11/18/7/3 und ziehen
 * bei einer Dichteumschaltung (B5) mit. Gepinnt in `Liste.test.tsx`.
 */

const { useToken } = theme;

type ListenGroesse = 'small' | 'default';

interface ListenKontext {
  size: ListenGroesse;
  bordered: boolean;
}

const ListeContext = createContext<ListenKontext>({ size: 'default', bordered: false });

interface ListeProps<T> {
  dataSource?: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Stabiler React-Key je Eintrag (Default: Index). */
  rowKey?: (item: T, index: number) => Key;
  size?: ListenGroesse;
  bordered?: boolean;
  header?: ReactNode;
  loading?: boolean;
  /** Inhalt bei leerer `dataSource` (analog antd `locale.emptyText`). */
  emptyText?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function Liste<T>({
  dataSource = [],
  renderItem,
  rowKey = (_item, index) => index,
  size = 'default',
  bordered = false,
  header,
  loading = false,
  emptyText,
  style,
  className,
}: ListeProps<T>) {
  const { token } = useToken();

  const containerStyle: CSSProperties = {
    ...(bordered
      ? {
          border: `1px solid ${token.colorBorder}`,
          borderRadius: token.borderRadiusLG,
        }
      : {}),
    ...style,
  };

  const headerPaddingInline = bordered ? (size === 'small' ? token.padding : token.paddingLG) : 0;

  // antd `List`: bei gesetztem `emptyText` nur den Text zeigen (`.ant-list-empty-text`), sonst
  // das Standard-`<Empty>` (simple image) als Fallback — beides in derselben zentrierten Box.
  // Während `loading` wird der Leer-Zustand unterdrückt (wie antd), damit kein Empty hinter
  // dem Spinner aufblitzt, solange noch keine Daten da sind.
  const leer = loading ? null : (
    <div
      style={{
        padding: token.padding,
        color: token.colorTextDisabled,
        fontSize: token.fontSize,
        textAlign: 'center',
      }}
    >
      {emptyText != null ? emptyText : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: 0 }} />}
    </div>
  );

  // Items als `<ul>/<li>` (list/listitem-Rolle wie antds `List` — Screenreader-Semantik erhalten).
  const inhalt =
    dataSource.length === 0 ? (
      leer
    ) : (
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {dataSource.map((item, index) => (
          <li
            key={rowKey(item, index)}
            style={index > 0 ? { borderBlockStart: `1px solid ${token.colorSplit}` } : undefined}
          >
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
    );

  return (
    <ListeContext.Provider value={{ size, bordered }}>
      <div style={containerStyle} className={className}>
        {header != null && (
          <div
            style={{
              padding: `${token.paddingSM}px ${headerPaddingInline}px`,
              borderBlockEnd: `1px solid ${token.colorSplit}`,
            }}
          >
            {header}
          </div>
        )}
        <Spin spinning={loading}>{inhalt}</Spin>
      </div>
    </ListeContext.Provider>
  );
}

interface ListenEintragProps {
  children?: ReactNode;
  /** Rechts ausgerichtete Aktionen (analog antd `List.Item` `actions`). */
  actions?: ReactNode[];
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function ListenEintrag({ children, actions, onClick, style, className }: ListenEintragProps) {
  const { token } = useToken();
  const { size, bordered } = useContext(ListeContext);

  const paddingBlock = size === 'small' ? token.paddingXS : token.paddingSM;
  const paddingInline = size === 'small' ? token.padding : bordered ? token.paddingLG : 0;

  return (
    <div
      className={['listen-eintrag', className].filter(Boolean).join(' ')}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: token.padding,
        paddingBlock,
        paddingInline,
        ...style,
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>{children}</div>
      {actions != null && actions.length > 0 && (
        <ul
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: '0 0 auto',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {actions.map((aktion, i) => (
            <li
              key={i}
              // Farbe wie antds `.ant-list-item-action > li` (Buttons/Links überschreiben selbst;
              // greift nur für Text-/<span>-Aktionen).
              style={
                i > 0
                  ? {
                      marginInlineStart: token.marginSM,
                      paddingInlineStart: token.marginSM,
                      borderInlineStart: `1px solid ${token.colorSplit}`,
                      lineHeight: 1,
                      color: token.colorTextDescription,
                    }
                  : { lineHeight: 1, color: token.colorTextDescription }
              }
            >
              {aktion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ListenEintragMetaProps {
  title?: ReactNode;
  description?: ReactNode;
}

export function ListenEintragMeta({ title, description }: ListenEintragMetaProps) {
  const { token } = useToken();
  // Bildet antd `List.Item.Meta` nach: Titel als <h4> (heading-Rolle + emphasized), darunter
  // die Beschreibung. Overrides exakt wie antd (margin/color/fontSize/lineHeight); alle übrigen
  // Eigenschaften (u. a. font-weight) erbt das <h4> aus derselben globalen Kaskade wie zuvor.
  return (
    <div style={{ minWidth: 0 }}>
      {title != null && (
        <h4
          style={{
            margin: `0 0 ${token.marginXXS}px 0`,
            color: token.colorText,
            fontSize: token.fontSize,
            lineHeight: token.lineHeight,
          }}
        >
          {title}
        </h4>
      )}
      {description != null && (
        <div
          style={{
            color: token.colorTextDescription,
            fontSize: token.fontSize,
            lineHeight: token.lineHeight,
          }}
        >
          {description}
        </div>
      )}
    </div>
  );
}
