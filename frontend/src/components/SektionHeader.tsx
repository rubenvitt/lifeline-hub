import { Typography } from 'antd';
import type { ReactNode } from 'react';
import Datenstand from './Datenstand';
import Augenbraue from './instrument/Augenbraue';
import { useRollen } from './instrument/rollenwerte';

interface SektionHeaderProps {
  titel: ReactNode;
  /** Einzeilige, gedämpfte Beschreibung unter dem Titel. */
  beschreibung?: ReactNode;
  /** Rechter Slot (z. B. eine Sektions-Aktion). */
  extra?: ReactNode;
  /** Letzter erfolgreicher Listenabruf (`query.dataUpdatedAt`). */
  dataUpdatedAt?: number;
  children?: ReactNode;
}

/**
 * Wiederkehrender Sektions-Titel für die Verwaltungs-Seiten (LFH-281). Zentralisiert die
 * sonst überall manuell gesetzten Typography-Margin-Resets; Abstände aus `theme.useToken()`.
 *
 * Neuentwurf „Instrumententafel" (21.09.2026): der Titel ist eine AUGENBRAUE (10 px, 600,
 * Versalien, `schwach`) über einer Haarlinie `linie` — dieselbe Stimme wie der Paneelkopf.
 * Die Überschriftenebene bleibt `h5`: die Gliederung der Seiten hängt daran (u. a.
 * `EinheitDetailPage.test.tsx`, `ModulEinstellungsListe.test.tsx` greifen Ebene 5), und
 * eine Optikänderung ist kein Anlass, die Dokumentgliederung zu verschieben.
 */
export default function SektionHeader({
  titel,
  beschreibung,
  extra,
  dataUpdatedAt,
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
        <Augenbraue als="h5">{titel}</Augenbraue>
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
