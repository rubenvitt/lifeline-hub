import { Children, type AriaAttributes, type CSSProperties, type ReactNode, type Ref } from 'react';
import { theme } from 'antd';
import { useViewport } from '../useViewport';
import { rasterAbstand } from './Stapel';

/**
 * Knopfreihe — zwei oder mehr Knöpfe nebeneinander (LLH-1973, ADR-0070). Der Abstand ist fest die
 * Rasterstufe `md` der aktiven Dichte (kompakt 12, komfortabel 20, handschuh 24 px): so steht auch
 * ein roter Knopf nie bündig neben einem neutralen, und kein Aufrufer kann einen anderen Abstand
 * wählen. Deshalb gibt es weder `style` noch einen Abstand als Prop.
 *
 * Die Reihe bricht um, statt hinauszulaufen. In einer Tabellenzelle hält `umbruch={false}` sie in
 * einer Zeile, sonst schrumpfte die Spalte auf einen Knopf und jede Zeile würde doppelt so hoch
 * (vgl. `components/aktionsSpalte.tsx`). Bleibt kein Kind, rendert sie nichts. Als Dialogfuß
 * (`fuss`) steht sie ab `md` rechtsbündig und unter `md` untereinander in voller Breite
 * (LFH-953): oben der Abbruch, unten am Daumen der Primärknopf.
 *
 * Die Reihe ordnet ihre Kinder nicht um: Lese- und Tabfolge sind die sichtbare Folge. Im Kopf,
 * im Paneel und in der Zeile steht die Primäraktion vorn, im Fuß hinten. Regel:
 * `frontend/AGENTS.md`, „Aktionen“, „Knopfreihen über `Knopfreihe`“.
 */
export interface KnopfreiheProps extends Pick<AriaAttributes, 'aria-label' | 'aria-labelledby'> {
  children: ReactNode;
  /** Dialogfuß: ab `md` rechtsbündig, unter `md` untereinander in voller Breite. */
  fuss?: boolean;
  /** Vorgabe `true`; `false` in Tabellenzellen und Zeilen, die ihre Höhe halten müssen. */
  umbruch?: boolean;
  id?: string;
  className?: string;
  'data-lfh'?: string;
  ref?: Ref<HTMLDivElement>;
}

export default function Knopfreihe({
  children,
  fuss = false,
  umbruch = true,
  ref,
  ...rest
}: KnopfreiheProps) {
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();
  const gestapelt = fuss && istSchmal;
  const stil: CSSProperties = {
    display: 'flex',
    flexDirection: gestapelt ? 'column' : 'row',
    flexWrap: gestapelt || !umbruch ? 'nowrap' : 'wrap',
    alignItems: gestapelt ? 'stretch' : 'center',
    gap: rasterAbstand(token, 'md'),
    minWidth: 0,
    ...(fuss && !gestapelt ? { justifyContent: 'flex-end' } : {}),
  };
  if (Children.toArray(children).length === 0) return null;
  return (
    <div ref={ref} style={stil} {...rest}>
      {children}
    </div>
  );
}
