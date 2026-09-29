import { Spin, theme } from 'antd';
import { createContext, useContext, useId } from 'react';
import type { AriaAttributes, CSSProperties, Key, ReactNode } from 'react';
import { KlickbareZeile } from './Klickbar';
import type { UnterEbene } from './Markdown';
import { SeitenLeer } from './SeitenZustand';
import { useRollen } from './instrument/rollenwerte';

/**
 * Schlanker Ersatz für antds deprecated `<List>` (LFH-167; Entfernung in antd v7).
 *
 * Bildet die genutzte Teilmenge nach (vertikale Liste, Trennlinien, Größen small/default,
 * bordered, Header, Loading, Leer-Zustand, Item mit Aktionen/Klick, Meta aus Titel +
 * Beschreibung), über Flex-Layout + Theme-Tokens.
 *
 * **Innenabstände (LFH-328/T14).** `antdToken()` überschreibt `padding`/`paddingSM`/
 * `paddingXS`/`paddingLG`, **nicht** die `size*`-Map-Tokens, aus denen antd die
 * `paddingContent*`-Aliase ableitet — die blieben in jeder Dichtestufe bei 16/16/12/8. Hier
 * steht deshalb die gleichwertige, dichteabhängige Quelle derselben Alias-Kette:
 * `paddingContentHorizontalSM`/`padding` ← `size` · `paddingContentHorizontalLG`/`paddingLG`
 * ← `sizeLG` · `paddingContentVertical`/`paddingSM` ← `sizeSM` ·
 * `paddingContentVerticalSM`/`paddingXS` ← `sizeXS`. Unter dem antd-Standardtheme 16/24/12/8,
 * unter `kompakt` 11/18/7/3. Gepinnt in `Liste.test.tsx`.
 *
 * **Optik.** Karten ohne Schatten und ohne Rundung; die umrandete Liste steht auf `flaeche` mit
 * Rahmen `linie` (die dekorative Haarlinie, nicht antds `colorBorder`), die Zeilen trennt
 * `flaeche3`. Die Rollen kommen über `instrument/rollenwerte.ts`; antd kennt `flaeche3` nicht.
 *
 * **Kopf (LFH-470).** Der Kopf einer Liste benennt sie: er ist eine echte Überschrift, und die
 * `<ul>` ist per `aria-labelledby` an ihn gebunden. Ein Vorleser springt so zwischen den Gruppen,
 * statt durch alle Einträge zu wandern. Die Ebene kennt nur der Einbauort, deshalb ist
 * `unterEbene` Pflicht (Ebene der nächsten Überschrift darüber, gerendert wird eine darunter;
 * dieselbe Rechnung wie `Markdown`). Die Optik bleibt die der früheren Kopfzeile.
 */

const { useToken } = theme;

type ListenGroesse = 'small' | 'default';

interface ListenKontext {
  size: ListenGroesse;
  bordered: boolean;
}

const ListeContext = createContext<ListenKontext>({ size: 'default', bordered: false });

/** Kopf einer Liste — immer eine Überschrift, nie bloß eine Zeile. */
export interface ListenKopf {
  inhalt: ReactNode;
  /** Ebene der nächsten Überschrift über der Liste (Seitentitel = 1, Paneel = 2, …). */
  unterEbene: UnterEbene;
}

/** Eine Ebene unter der nächsten Überschrift darüber; `UnterEbene` endet bei 5, der Kopf bei h6. */
const KOPF_ELEMENT = {
  1: 'h2',
  2: 'h3',
  3: 'h4',
  4: 'h5',
  5: 'h6',
} as const satisfies Record<UnterEbene, string>;

interface ListeProps<T> {
  dataSource?: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Stabiler React-Key je Eintrag (Default: Index). */
  rowKey?: (item: T, index: number) => Key;
  size?: ListenGroesse;
  bordered?: boolean;
  kopf?: ListenKopf;
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
  kopf,
  loading = false,
  emptyText,
  style,
  className,
}: ListeProps<T>) {
  const { token, rollen } = useRollen();
  const kopfId = useId();
  const KopfElement = kopf ? KOPF_ELEMENT[kopf.unterEbene] : null;

  const containerStyle: CSSProperties = {
    ...(bordered
      ? {
          border: `1px solid ${rollen.linie}`,
          borderRadius: 0,
          background: rollen.flaeche,
        }
      : {}),
    ...style,
  };

  const headerPaddingInline = bordered ? (size === 'small' ? token.padding : token.paddingLG) : 0;

  // Mit `emptyText` steht nur dieser Text in der zentrierten Box; ohne ihn trägt `SeitenLeer`
  // den Fallback „Keine Daten" — dieselbe Form wie alle übrigen Leerzustände. Wer eine echte
  // Aussage will, setzt `emptyText`.
  //
  // Die Ladeunterdrückung lebt an genau EINER Stelle (B3/D4): solange geladen wird, wird nichts
  // über die Menge behauptet, sonst blitzte der Leerzustand hinter dem Spinner auf.
  const leer = loading ? null : emptyText != null ? (
    <div
      style={{
        padding: token.padding,
        color: token.colorTextDisabled,
        fontSize: token.fontSize,
        textAlign: 'center',
      }}
    >
      {emptyText}
    </div>
  ) : (
    <SeitenLeer titel="Keine Daten" />
  );

  // Items als `<ul>/<li>` (list/listitem-Rolle wie antds `List` — Screenreader-Semantik erhalten).
  const inhalt =
    dataSource.length === 0 ? (
      leer
    ) : (
      <ul
        aria-labelledby={kopf ? kopfId : undefined}
        style={{ margin: 0, padding: 0, listStyle: 'none' }}
      >
        {dataSource.map((item, index) => (
          <li
            key={rowKey(item, index)}
            style={index > 0 ? { borderBlockStart: `1px solid ${rollen.flaeche3}` } : undefined}
          >
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
    );

  return (
    <ListeContext.Provider value={{ size, bordered }}>
      <div style={containerStyle} className={className}>
        {kopf && KopfElement && (
          <KopfElement
            id={kopfId}
            style={{
              // Die globalen h*-Stile (antd-Reset: Abstand, Gewicht, Größe, Überschriftenfarbe)
              // dürfen die Kopfzeile nicht verändern — die Gliederung gehört in den Baum, nicht
              // ins Aussehen.
              margin: 0,
              fontSize: 'inherit',
              fontWeight: 'inherit',
              lineHeight: 'inherit',
              color: 'inherit',
              padding: `${token.paddingSM}px ${headerPaddingInline}px`,
              borderBlockEnd: `1px solid ${rollen.linie}`,
            }}
          >
            {kopf.inhalt}
          </KopfElement>
        )}
        <Spin spinning={loading}>{inhalt}</Spin>
      </div>
    </ListeContext.Provider>
  );
}

interface ListenEintragBasisProps {
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
  /**
   * Markiert die aktuelle Zeile (z. B. den offenen Chat-Kanal). Landet am WURZELelement, also am
   * Knoten mit `role="button"` — an einem inneren Element sagte der Vorleser die Rolle ohne
   * „aktuell" an (LFH-621).
   */
  'aria-current'?: AriaAttributes['aria-current'];
}

interface ListenEintragAuswahlProps extends ListenEintragBasisProps {
  /** Button-semantische Auswahl der Zeile; Navigation bleibt ein nativer Link. */
  onClick: () => void;
  actions?: never;
}

interface ListenEintragAnzeigeProps extends ListenEintragBasisProps {
  /** Rechts ausgerichtete Aktionen (analog antd `List.Item` `actions`). */
  actions?: ReactNode[];
  onClick?: never;
}

type ListenEintragProps = ListenEintragAuswahlProps | ListenEintragAnzeigeProps;

export function ListenEintrag({
  children,
  actions,
  onClick,
  style,
  className,
  'aria-current': ariaCurrent,
}: ListenEintragProps) {
  const { token, rollen } = useRollen();
  const { size, bordered } = useContext(ListeContext);

  const paddingBlock = size === 'small' ? token.paddingXS : token.paddingSM;
  const paddingInline = size === 'small' ? token.padding : bordered ? token.paddingLG : 0;

  const eintragProps = {
    className: ['listen-eintrag', className].filter(Boolean).join(' '),
    'aria-current': ariaCurrent,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: token.padding,
      paddingBlock,
      paddingInline,
      // Die Spread-Position ist TRAGEND (LFH-366): ein Aufrufer mit Trefflächenboden übergibt die
      // Kurzform `padding` (`bedienzielStil` in `pages/lagekarte/Sidebar.tsx`), und die gewinnt nur,
      // weil sie SPÄTER steht. Nach vorn gezogen fiele die Polsterungshälfte der „ZWEI
      // Angaben"-Konvention still weg.
      ...style,
    },
  };

  const inhalt = (
    <>
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
                      borderInlineStart: `1px solid ${rollen.linie}`,
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
    </>
  );

  return onClick ? (
    <KlickbareZeile {...eintragProps} onAktivieren={onClick}>
      {inhalt}
    </KlickbareZeile>
  ) : (
    <div {...eintragProps}>{inhalt}</div>
  );
}

interface ListenEintragMetaProps {
  title?: ReactNode;
  description?: ReactNode;
}

export function ListenEintragMeta({ title, description }: ListenEintragMetaProps) {
  const { token } = useToken();
  // Bildet antd `List.Item.Meta` nach: Titel als <h4> (heading-Rolle + emphasized), darunter die
  // Beschreibung. Overrides wie antd (margin/color/fontSize/lineHeight); den Rest erbt das <h4>
  // aus der globalen Kaskade.
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
