import type { CSSProperties } from 'react';
import { Button, theme } from 'antd';
import { TbSearch } from 'react-icons/tb';
import { useCommandPalette } from '../command-palette/CommandPaletteProvider';
import { farbenDunkel, rahmenFarben } from '../theme/tokens';
import Tastenkuerzel from './Tastenkuerzel';
import { useViewport } from './useViewport';

const TREFFLAECHE = 48;

/** Größte Breite des Suchfelds in der Kommandoleiste (Neuentwurf, `shell.dc.html`). */
export const SUCHFELD_MAX_BREITE = 520;

/**
 * Sichtbarer Text im Suchfeld. „Koordinate" aus dem Entwurf steht bewusst NICHT darin: die
 * Palette kann eine Koordinate heute nicht auf einen Kartenausschnitt abbilden
 * (`lagekartePfad` kennt keinen Mittelpunkt), und ein Feld, das eine Suche verspricht, die es
 * nicht gibt, ist schlechter als eines, das sie verschweigt.
 */
export const SUCHFELD_TEXT = 'Modul, Einheit, Meldung …';

/** Sichtbares Kürzel für den globalen Suchzugang. */
export function suchKuerzelFuerUserAgent(userAgent: string): string {
  return /Mac|iPhone|iPad|iPod/.test(userAgent) ? '⌘K' : 'Strg+K';
}

/**
 * Stil des Auslösers in Suchfeld-Gestalt (ab `lg`) — rein und exportiert, damit die
 * Zusicherung über die Dichtestufen ohne Rendern prüfbar ist (Muster `bedienzielStil`).
 *
 * ZWEI Angaben (LFH-365): `minHeight` aus `controlHeight` (30 / 48 / 72) plus Polsterung.
 * Grund `flaeche2`, Rahmen `linieStark` — beides Nachtwerte, weil die Kommandoleiste in
 * beiden Modi dunkel ist. Der Rahmen ist hier DEKORATION: das Ziel ist über Grund, Ikone
 * und Text erkennbar, nicht allein über die Linie (WCAG 1.4.11 zielt auf die
 * identifizierende Grafik).
 */
export function suchfeldStil(token: {
  controlHeight: number;
  paddingSM: number;
  paddingXS: number;
}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: token.paddingSM,
    width: '100%',
    maxWidth: SUCHFELD_MAX_BREITE,
    minHeight: token.controlHeight,
    padding: `${token.paddingXS}px ${token.paddingSM}px`,
    background: rahmenFarben.feld,
    border: `1px solid ${farbenDunkel.linieStark}`,
    color: rahmenFarben.schwach,
    fontSize: 13,
    textAlign: 'left',
    boxShadow: 'none',
  };
}

/**
 * Einheitlicher Zugang zur Kommandopalette in beiden Kopfzeilen.
 *
 * Ab `lg` in Suchfeld-Gestalt (Neuentwurf): Suchikone, Hinweistext, Kürzelmarke. Es BLEIBT
 * ein Knopf — die Palette ist ein Dialog mit eigenem Eingabefeld, ein zweites Eingabefeld im
 * Kopf wäre ein zweiter Ort derselben Eingabe. Der zugängliche Name bleibt „Suchen": der
 * Hinweistext ist Beiwerk, und an „Suchen" hängen die Abfragen der e2e-Suiten.
 *
 * Unterhalb von `lg` nur die Ikone; die A1-Trefffläche bleibt der Mindestwert. Die
 * Handschuh-Stufe darf darüber wachsen (LFH-460), weil dies der sichtbare Suchzugang ist.
 */
export default function CommandPaletteTrigger() {
  const { toggle } = useCommandPalette();
  const { token } = theme.useToken();
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const trefflaeche = Math.max(TREFFLAECHE, token.controlHeight);
  const kuerzel = suchKuerzelFuerUserAgent(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
  );

  if (!breit) {
    return (
      <Button
        type="text"
        aria-label="Suchen"
        aria-keyshortcuts={kuerzel === '⌘K' ? 'Meta+K' : 'Control+K'}
        icon={<TbSearch size={20} aria-hidden />}
        onClick={toggle}
        style={{
          color: rahmenFarben.text,
          flexShrink: 0,
          width: trefflaeche,
          height: trefflaeche,
          minWidth: trefflaeche,
          minHeight: trefflaeche,
        }}
      />
    );
  }

  return (
    <Button
      type="text"
      aria-label="Suchen"
      aria-keyshortcuts={kuerzel === '⌘K' ? 'Meta+K' : 'Control+K'}
      onClick={toggle}
      style={suchfeldStil(token)}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}>
        <TbSearch size={15} />
      </span>
      {/* Eine Flex-Zeile, kein Fragment: JSX verschluckt den Zeilenumbruch zwischen zwei
          Elementen ersatzlos — so stand bis zum 08.08.2026 „Suchen⌘K" in einem Zug. */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {SUCHFELD_TEXT}
      </span>
      <Tastenkuerzel aria-hidden style={{ color: rahmenFarben.schwach }}>
        {kuerzel}
      </Tastenkuerzel>
    </Button>
  );
}
