// src/etb/SlashMenu.tsx
import { Typography, theme } from 'antd';
import { useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import type { EtbBaustein } from '../api/types';
import { filterSlashEintraege, type MetaFeld, type SlashEintrag } from './schnellerfassungModell';

export interface SlashMenuHandle {
  /** Tastatur-Navigation vom Container weitergereicht. Liefert true, wenn verarbeitet. */
  handleKey: (key: string) => boolean;
}

interface Props {
  offen: boolean;
  filter: string;
  bausteine: EtbBaustein[];
  gesetzteFelder: MetaFeld[];
  onWahl: (eintrag: SlashEintrag) => void;
  onSchliessen: () => void;
}

const SlashMenu = forwardRef<SlashMenuHandle, Props>(function SlashMenu(
  { offen, filter, bausteine, gesetzteFelder, onWahl, onSchliessen },
  ref,
) {
  const treffer = useMemo(
    () => filterSlashEintraege(filter, bausteine, gesetzteFelder),
    [filter, bausteine, gesetzteFelder],
  );
  const flach: SlashEintrag[] = useMemo(() => [...treffer.felder, ...treffer.bausteine], [treffer]);
  const [aktiv, setAktiv] = useState(0);
  // Aufgelöste Theme-Tokens statt antd-CSS-Variablen: cssVar ist nicht aktiviert,
  // daher würde `var(--ant-color-bg-elevated, …)` immer den Fallback nehmen
  // (dunkel) und im Light Mode schwarzen Grund mit schwarzem Text erzeugen.
  const { token } = theme.useToken();

  useEffect(() => setAktiv(0), [filter, offen]);

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (!offen) return false;
      if (key === 'Escape') { onSchliessen(); return true; }
      if (flach.length === 0) {
        // Enter bei leerem Menü ("Kein Treffer") konsumieren und schließen,
        // damit der Container den Eintrag nicht versehentlich absendet.
        if (key === 'Enter') { onSchliessen(); return true; }
        return false;
      }
      if (key === 'ArrowDown') { setAktiv((i) => (i + 1) % flach.length); return true; }
      if (key === 'ArrowUp') { setAktiv((i) => (i - 1 + flach.length) % flach.length); return true; }
      if (key === 'Enter') { const e = flach[aktiv]; if (!e) return false; onWahl(e); return true; }
      return false;
    },
  }), [offen, flach, aktiv, onWahl, onSchliessen]);

  if (!offen) return null;

  function sektion(titel: string, eintraege: SlashEintrag[], offset: number) {
    if (eintraege.length === 0) return null;
    return (
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 11, padding: '4px 12px', display: 'block' }}>
          {titel}
        </Typography.Text>
        {eintraege.map((e, i) => {
          const idx = offset + i;
          return (
            <div
              key={`${e.art}-${e.key}`}
              role="option"
              aria-selected={idx === aktiv}
              onMouseDown={(ev) => { ev.preventDefault(); onWahl(e); }}
              style={{
                padding: '6px 12px', cursor: 'pointer', color: token.colorText,
                background: idx === aktiv ? token.controlItemBgActive : undefined,
              }}
            >
              {e.label}{e.gesetzt ? ' ✓' : ''}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="slash-menu"
      style={{
        position: 'absolute', zIndex: 10, minWidth: 240, marginTop: 4,
        background: token.colorBgElevated, color: token.colorText,
        border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowSecondary, maxHeight: 280, overflow: 'auto',
      }}
    >
      {flach.length === 0 ? (
        <div style={{ padding: '6px 12px', opacity: 0.6 }}>Kein Treffer</div>
      ) : (
        <>
          {sektion('Felder', treffer.felder, 0)}
          {sektion('Bausteine', treffer.bausteine, treffer.felder.length)}
        </>
      )}
    </div>
  );
});

export default SlashMenu;
