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
  // Aufgelöste Theme-Tokens (theme.useToken()) statt antd-CSS-Variablen: robust
  // gegenüber dem Theme-Modus. Eine antd-Custom-Property griff hier früher nie und
  // lief still auf ihren dunklen Fallback — der ConfigProvider setzt `cssVar` nicht,
  // und dass er es NICHT tut, ist seit A2 (LFH-328) eine begründete Entscheidung:
  // handgeschriebenes CSS liest `--lfh-*` aus `theme/rollen.css`, TSX liest useToken().
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
        {/*
          Beschriftung, keine Bedienfläche: die Polsterung zieht mit der Dichte, eine
          Mindesthöhe bekommt sie NICHT. Das ist dieselbe Trennlinie, die der
          Dichte-Guard zwischen interaktiven Elementen und Flächen wie `Card` zieht.
        */}
        <Typography.Text
          type="secondary"
          style={{ fontSize: 11, padding: `${token.paddingXS}px ${token.padding}px`, display: 'block' }}
        >
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
              /*
               * Die Zeile ist ein Bedienziel und folgt deshalb der Dichte-Staffel
               * (LFH-365 · B5e). Zwei getrennte Angaben, weil sie zwei Dinge sind:
               *
               *   `minHeight` trägt den Trefflächenboden (30 / 48 / 72 px aus
               *   `controlHeight`). Ohne sie entsteht die Höhe allein aus Polsterung plus
               *   Zeilenbox — im Handschuh gemessen grob 54 px gegen einen Boden von 72.
               *   Präzedenz ist `components/Datensicht.tsx:1255`, dasselbe Problem an
               *   einem anderen interaktiven Zeilenziel.
               *
               *   `padding` ist die Polsterung. Der Tausch bewegt in der kompakten Stufe
               *   je ±1 px (6→7, 12→11), ist also ein Token-Tausch und keine
               *   Umgestaltung.
               *
               * Tokens und nicht `var(--lfh-*)`: die Arbeitsteilung steht oben an
               * `useToken()` und in `theme/rollen.css` — handgeschriebenes CSS liest die
               * Custom Properties, TSX liest die aufgelösten Tokens. Die Dichteachse
               * wurde in TSX noch nie über eine CSS-Variable gelesen.
               */
              style={{
                minHeight: token.controlHeight,
                padding: `${token.paddingSM}px ${token.padding}px`,
                cursor: 'pointer',
                color: token.colorText,
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
      // Eigenes Attribut statt des Testids: der Aufrufer nimmt das Menü vom
      // „Klick daneben schliesst"-Griff aus, und dafür darf er sich nicht auf
      // eine Test-Kennung stützen, die jederzeit wegfallen darf.
      data-slash-menu=""
      style={{
        position: 'absolute', zIndex: 10, minWidth: 240, marginTop: 4,
        background: token.colorBgElevated, color: token.colorText,
        border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowSecondary, maxHeight: 280, overflow: 'auto',
      }}
    >
      {flach.length === 0 ? (
        /* Dieselbe Polsterung wie eine echte Option — der Leerzustand soll nicht
           schmaler wirken als das, was er ersetzt. Keine Mindesthöhe: er ist nicht
           wählbar. */
        <div style={{ padding: `${token.paddingSM}px ${token.padding}px`, opacity: 0.6 }}>
          Kein Treffer
        </div>
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
