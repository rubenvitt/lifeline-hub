import type { CSSProperties, ReactNode } from 'react';
import Augenbraue from './Augenbraue';
import { monoStil, useRollen } from './rollenwerte';
import { datenfeldStil, datenrasterStil } from './datenrasterStil';

/**
 * Datenraster — die Detail-Optik statt antds `Descriptions`: je Feld eine Augenbraue über dem
 * Wert, 2–4 Spalten im Fugenraster, Kennungen/Zahlen/Zeiten in Mono.
 *
 * SEMANTIK: ein `<dl>`; jedes Feld ist ein `<div>` mit `<dt>` (Augenbraue) und `<dd>` — die
 * zulässige Gruppierung nach HTML, Vorleser hören Begriff und Wert als Paar.
 *
 * BEARBEITEN AN ORT UND STELLE: im Edit-Modus einer Detailseite steht statt `Datenfeld` eine
 * `DatenfeldEingabe` (`./DatenfeldEingabe.tsx`, LLH-1101) im selben Raster — mit einem Etikett, das
 * die Eingabe benennt, und einem `Form.Item` OHNE `noStyle`, damit ein Prüffehler sichtbar unter
 * der Eingabe steht. Ein `Form.Item noStyle` im `Datenfeld` ist der alte Weg: die Eingabe bliebe
 * ohne Namen, und eine Regel verhinderte das Speichern still. `mono` setzt die Schrift am `<dd>`.
 */
interface DatenrasterProps {
  children: ReactNode;
  /** Höchstzahl der Spalten; das Raster gibt auf schmalem Schirm selbst ab. Vorgabe 3. */
  spalten?: number;
  /** Zugänglicher Name, wenn die Seite mehrere Raster trägt. */
  beschriftung?: string;
  style?: CSSProperties;
}

export default function Datenraster({
  children,
  spalten = 3,
  beschriftung,
  style,
}: DatenrasterProps) {
  const { rollen } = useRollen();
  return (
    <dl
      aria-label={beschriftung}
      data-lfh="datenraster"
      data-fugenraster=""
      style={{ ...datenrasterStil(rollen, spalten), ...style }}
    >
      {children}
    </dl>
  );
}

interface DatenfeldProps {
  /** Begriff — erscheint als Augenbraue. */
  label: ReactNode;
  children: ReactNode;
  /** Wert in Mono (Kennung, Zahl, Zeit, Funkrufname). */
  mono?: boolean;
  /** Über alle Spalten (Freitext, Bearbeitungsfeld). */
  breit?: boolean;
}

export function Datenfeld({ label, children, mono = false, breit = false }: DatenfeldProps) {
  const { token, rollen } = useRollen();
  return (
    <div data-lfh="datenfeld" style={datenfeldStil(rollen, token, breit)}>
      <Augenbraue als="dt">{label}</Augenbraue>
      <dd
        style={{
          margin: 0,
          minWidth: 0,
          overflowWrap: 'anywhere',
          color: rollen.text,
          ...(mono ? monoStil(13) : { fontSize: 13 }),
        }}
      >
        {children}
      </dd>
    </div>
  );
}
