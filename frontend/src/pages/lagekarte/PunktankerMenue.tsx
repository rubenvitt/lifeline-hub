/**
 * Menü an einem Punkt der Lagekarte — die gemeinsame Schale des Flächen-Auswahlmenüs (LFH-812) und
 * des Kontextmenüs (LFH-776, `openspec/changes/lfh-776-lagekarte-kontextmenue/design.md` D1).
 *
 * Bedienung nach Leitlinie „Datensatz-Aktionen": antds `Dropdown` im Portal mit `autoFocus`
 * (Pfeile, Enter, Esc bringt das Menü mit), Einträge in der Steuerhöhe der Dichtestufe
 * (`punktmenueEintragStil`). Ein Kopf (`kopf`) steht über dem Menü, nicht als antd-Gruppe darin: rc-menu
 * fokussiert mit `autoFocus` sonst die Gruppe statt des ersten Eintrags. Verankert an einem unsichtbaren Punkt in Pixeln
 * relativ zur Kartenhülle. Geschlossen wird allein über `onOpenChange`; jeder Weg hinaus gibt den
 * Fokus an die Karte zurück (`fokusZiel`). Esc bei offenem Menü erkennt der Zeichnen-Esc über
 * `escGehoertOverlay` als Overlay.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Dropdown, theme, type MenuProps } from 'antd';

type Items = NonNullable<MenuProps['items']>;

/**
 * Stil eines Menüeintrags: antds Menüeinträge wachsen nicht mit `controlHeight`, also trägt jeder
 * Eintrag die Steuerhöhe der Dichtestufe als Boden (Gate 3, Handschuh 72 px).
 */
export function punktmenueEintragStil(token: {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
}) {
  return {
    display: 'flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    paddingBlock: token.paddingXS,
    paddingInline: token.paddingSM,
  } as const;
}

/** Kopfzeile über den Einträgen: Mono mit festen Ziffern (Koordinate), nicht bedienbar. */
function punktmenueKopfStil(token: {
  paddingXS: number;
  paddingSM: number;
  colorTextSecondary: string;
  colorBorderSecondary: string;
  fontFamilyCode: string;
}) {
  return {
    paddingBlock: token.paddingXS,
    paddingInline: token.paddingSM,
    color: token.colorTextSecondary,
    fontFamily: token.fontFamilyCode,
    fontVariantNumeric: 'tabular-nums',
    borderBottom: `1px solid ${token.colorBorderSecondary}`,
    whiteSpace: 'nowrap',
  } as const;
}

/** Hängt den Stil an jeden wählbaren Eintrag (nicht an Trenner). */
function mitEintragStil(items: Items, stil: ReturnType<typeof punktmenueEintragStil>): Items {
  return items.map((item) =>
    item && (!('type' in item) || item.type === 'item' || item.type === undefined)
      ? { ...item, style: { ...stil, ...(item as { style?: object }).style } }
      : item,
  ) as Items;
}

export interface PunktankerMenueProps {
  /** Ankerpunkt in Pixeln relativ zur Kartenhülle; `null` = kein Menü. */
  anker: { x: number; y: number } | null;
  ariaLabel: string;
  /** `data-lfh` des Ankers (Nachweise im e2e). */
  ankerKennung: string;
  items: Items;
  /** Nicht wählbare Zeile über den Einträgen (Kontextmenü: die Koordinate der Stelle). */
  kopf?: ReactNode;
  onWaehlen: (key: string) => void;
  onSchliessen: () => void;
  /** Wohin der Fokus beim Schließen zurückgeht (die Karte). */
  fokusZiel?: () => HTMLElement | null;
}

export default function PunktankerMenue({
  anker,
  ariaLabel,
  ankerKennung,
  items,
  kopf,
  onWaehlen,
  onSchliessen,
  fokusZiel,
}: PunktankerMenueProps) {
  const { token } = theme.useToken();
  const fokusZielRef = useRef(fokusZiel);
  fokusZielRef.current = fokusZiel;
  // Nimmt die Karte das Menü ohne antd weg (Kartenbewegung, exklusiver Modus), fiele der Fokus
  // mit dem Eintrag auf `body`. Zurück an die Karte, aber nur, wenn er noch im Menü oder im
  // Nichts steht: einen Fokus, den der Mensch woanders hingesetzt hat, nimmt das nicht weg.
  const offen = anker != null;
  useEffect(() => {
    if (!offen) return;
    return () => {
      const aktiv = document.activeElement;
      if (!aktiv || aktiv === document.body || aktiv.closest('.ant-dropdown'))
        fokusZielRef.current?.()?.focus({ preventScroll: true });
    };
  }, [offen]);
  if (!anker) return null;

  const schliessen = () => {
    onSchliessen();
    fokusZiel?.()?.focus({ preventScroll: true });
  };

  return (
    <Dropdown
      open
      trigger={['click']}
      autoFocus
      onOpenChange={(offen) => {
        if (!offen) schliessen();
      }}
      popupRender={
        kopf == null
          ? undefined
          : (menue) => (
              // `autoFocus` fokussiert das äußerste Element des Overlays — mit Kopf ist das diese
              // Hülle, nicht das Menü. Sie reicht den Fokus an den ersten freien Eintrag weiter.
              <div
                tabIndex={-1}
                onFocus={(e) => {
                  if (e.target !== e.currentTarget) return;
                  e.currentTarget
                    .querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
                    ?.focus({ preventScroll: true });
                }}
                style={{
                  background: token.colorBgElevated,
                  boxShadow: token.boxShadowSecondary,
                  outline: 'none',
                }}
              >
                <div data-lfh={`${ankerKennung}-kopf`} style={punktmenueKopfStil(token)}>
                  {kopf}
                </div>
                {menue}
              </div>
            )
      }
      menu={{
        'aria-label': ariaLabel,
        // Mit Kopf trägt die Hülle Grund und Schatten; das Menü darin wirft keinen zweiten.
        ...(kopf == null ? {} : { style: { boxShadow: 'none' } }),
        items: mitEintragStil(items, punktmenueEintragStil(token)),
        // Geschlossen wird allein über `onOpenChange`: antd meldet dort auch den Klick auf einen
        // Eintrag (Quelle `menu`), ein zweites Schließen hier liefe doppelt.
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          onWaehlen(key);
        },
      }}
    >
      <span
        aria-hidden="true"
        data-lfh={ankerKennung}
        style={{
          position: 'absolute',
          left: anker.x,
          top: anker.y,
          width: 1,
          height: 1,
          pointerEvents: 'none',
        }}
      />
    </Dropdown>
  );
}
