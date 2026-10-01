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
  /**
   * Typbefehle (`/meldung`, `/anordnung` …) als eigene, ERSTE Sektion anbieten. Der Aufrufer
   * setzt das nur für ein `/` am Zeilenanfang — mitten im Satz bleibt das Menü bei Feldern und
   * Bausteinen.
   */
  typenAnbieten?: boolean;
  /**
   * `@`-Modus: statt Typen/Feldern/Bausteinen genau diese Einheiten-Einträge
   * (`filterAtEintraege`). `null`/fehlend = `/`-Modus.
   */
  einheiten?: readonly SlashEintrag[] | null;
  /**
   * Wohin das Menü aufgeht. Die ETB-Erfassung steht am SEITENFUSS — ein Menü nach unten liefe
   * dort aus dem Fenster.
   */
  richtung?: 'unten' | 'oben';
}

const SlashMenu = forwardRef<SlashMenuHandle, Props>(function SlashMenu(
  {
    offen,
    filter,
    bausteine,
    gesetzteFelder,
    onWahl,
    onSchliessen,
    typenAnbieten = false,
    einheiten = null,
    richtung = 'unten',
  },
  ref,
) {
  const treffer = useMemo(
    () => filterSlashEintraege(filter, bausteine, gesetzteFelder, { typen: typenAnbieten }),
    [filter, bausteine, gesetzteFelder, typenAnbieten],
  );
  // EINE flache Folge in Anzeigereihenfolge — die Pfeiltasten wandern über alle Sektionen.
  const flach: SlashEintrag[] = useMemo(
    () =>
      einheiten != null
        ? [...einheiten]
        : [...treffer.typen, ...treffer.felder, ...treffer.bausteine],
    [einheiten, treffer],
  );
  const [aktiv, setAktiv] = useState(0);
  // Aufgelöste Theme-Tokens statt antd-CSS-Variablen: antd 6 emittiert `--ant-*` nur unter einer
  // Klasse `css-var-<useId>`, nicht an `<html>` (Browserbefund LFH-641, `theme/rollen.css`).
  // Handgeschriebenes CSS liest `--lfh-*` aus `theme/rollen.css`, TSX liest useToken(), keines
  // hängt an antds Variablennamen.
  const { token } = theme.useToken();

  useEffect(() => setAktiv(0), [filter, offen]);

  useImperativeHandle(
    ref,
    () => ({
      handleKey(key) {
        if (!offen) return false;
        if (key === 'Escape') {
          onSchliessen();
          return true;
        }
        if (flach.length === 0) {
          // Enter bei leerem Menü ("Kein Treffer") konsumieren und schließen,
          // damit der Container den Eintrag nicht versehentlich absendet.
          if (key === 'Enter') {
            onSchliessen();
            return true;
          }
          return false;
        }
        if (key === 'ArrowDown') {
          setAktiv((i) => (i + 1) % flach.length);
          return true;
        }
        if (key === 'ArrowUp') {
          setAktiv((i) => (i - 1 + flach.length) % flach.length);
          return true;
        }
        if (key === 'Enter') {
          const e = flach[aktiv];
          if (!e) return false;
          onWahl(e);
          return true;
        }
        return false;
      },
    }),
    [offen, flach, aktiv, onWahl, onSchliessen],
  );

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
          style={{
            fontSize: 11,
            padding: `${token.paddingXS}px ${token.padding}px`,
            display: 'block',
          }}
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
              onMouseDown={(ev) => {
                ev.preventDefault();
                onWahl(e);
              }}
              /*
               * Die Zeile ist ein Bedienziel und folgt der Dichte-Staffel (LFH-365). Zwei Angaben, weil
               * sie zwei Dinge sind: `minHeight` trägt den Trefflächenboden (30 / 48 / 72 px aus
               * `controlHeight`) — ohne ihn entstünde die Höhe allein aus Polsterung plus Zeilenbox und
               * bliebe im Handschuh unter dem Boden. `padding` ist die Polsterung.
               *
               * Tokens und nicht `var(--lfh-*)`: TSX liest die aufgelösten Tokens (s. oben an `useToken()`).
               */
              style={{
                minHeight: token.controlHeight,
                padding: `${token.paddingSM}px ${token.padding}px`,
                cursor: 'pointer',
                color: token.colorText,
                background: idx === aktiv ? token.controlItemBgActive : undefined,
              }}
            >
              {e.label}
              {e.gesetzt ? ' ✓' : ''}
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
        position: 'absolute',
        zIndex: 10,
        minWidth: 240,
        ...(richtung === 'oben' ? { bottom: '100%', marginBottom: 4 } : { marginTop: 4 }),
        background: token.colorBgElevated,
        color: token.colorText,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowSecondary,
        maxHeight: 280,
        overflow: 'auto',
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
          {einheiten != null ? (
            sektion('Einheit', [...einheiten], 0)
          ) : (
            <>
              {sektion('Typ', treffer.typen, 0)}
              {sektion('Felder', treffer.felder, treffer.typen.length)}
              {sektion(
                'Bausteine',
                treffer.bausteine,
                treffer.typen.length + treffer.felder.length,
              )}
            </>
          )}
        </>
      )}
    </div>
  );
});

export default SlashMenu;
