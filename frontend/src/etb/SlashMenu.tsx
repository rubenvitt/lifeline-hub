// src/etb/SlashMenu.tsx
import { Typography } from 'antd';
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

  useEffect(() => setAktiv(0), [filter, offen]);

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (!offen || flach.length === 0) return false;
      if (key === 'ArrowDown') { setAktiv((i) => (i + 1) % flach.length); return true; }
      if (key === 'ArrowUp') { setAktiv((i) => (i - 1 + flach.length) % flach.length); return true; }
      if (key === 'Enter') { onWahl(flach[aktiv]); return true; }
      if (key === 'Escape') { onSchliessen(); return true; }
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
                padding: '6px 12px', cursor: 'pointer',
                background: idx === aktiv ? 'rgba(22,119,255,0.15)' : undefined,
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
        background: 'var(--ant-color-bg-elevated, #1f1f1f)',
        border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
        boxShadow: '0 6px 18px rgba(0,0,0,0.4)', maxHeight: 280, overflow: 'auto',
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
