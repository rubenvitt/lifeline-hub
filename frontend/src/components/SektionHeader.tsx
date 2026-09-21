import { Typography } from 'antd';
import type { ReactNode } from 'react';
import Datenstand from './Datenstand';
import Augenbraue, { type AugenbraueElement } from './instrument/Augenbraue';
import { useRollen } from './instrument/rollenwerte';

interface SektionHeaderProps {
  titel: ReactNode;
  /** Einzeilige, gedämpfte Beschreibung unter dem Titel. */
  beschreibung?: ReactNode;
  /** Rechter Slot (z. B. eine Sektions-Aktion). */
  extra?: ReactNode;
  /** Letzter erfolgreicher Listenabruf (`query.dataUpdatedAt`). */
  dataUpdatedAt?: number;
  /**
   * Überschriftenebene; Vorgabe `h2` — ein Abschnitt direkt unter dem Seitentitel (`h1`),
   * auf derselben Ebene wie ein `Paneel`. Steht der Abschnitt IN einem Paneel (Form-Gruppe in
   * „Kopfdaten", Modulkategorien in einem `Formularpaneel`), setzt der Aufrufer `h3`.
   */
  ueberschrift?: Extract<AugenbraueElement, 'h2' | 'h3' | 'h4'>;
  children?: ReactNode;
}

/**
 * Wiederkehrender Sektions-Titel für die Verwaltungs-Seiten (LFH-281). Zentralisiert die
 * sonst überall manuell gesetzten Typography-Margin-Resets; Abstände aus `theme.useToken()`.
 *
 * Neuentwurf „Instrumententafel" (21.09.2026): der Titel ist eine AUGENBRAUE (10 px, 600,
 * Versalien, `schwach`) über einer Haarlinie `linie` — dieselbe Stimme wie der Paneelkopf.
 * Die Überschriftenebene folgt der Gliederung (22.09.2026, vorher fest `h5`): unter dem
 * `h1` des Seitentitels ist ein Abschnitt `h2`, in einem Paneel `h3` — ein festes `h5`
 * übersprang zwei Ebenen.
 */
export default function SektionHeader({
  titel,
  beschreibung,
  extra,
  dataUpdatedAt,
  ueberschrift = 'h2',
  children,
}: SektionHeaderProps) {
  const { token, rollen } = useRollen();
  return (
    <div style={{ marginBottom: token.marginSM }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: token.margin,
          paddingBlockEnd: token.paddingXS,
          borderBlockEnd: `1px solid ${rollen.linie}`,
        }}
      >
        <Augenbraue als={ueberschrift}>{titel}</Augenbraue>
        {extra}
      </div>
      {beschreibung && (
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: token.marginXS, marginBottom: 0 }}
        >
          {beschreibung}
        </Typography.Paragraph>
      )}
      <Datenstand dataUpdatedAt={dataUpdatedAt} />
      {children}
    </div>
  );
}
