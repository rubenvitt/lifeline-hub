import { Button, theme } from 'antd';
import { TbSearch } from 'react-icons/tb';
import { useCommandPalette } from '../command-palette/CommandPaletteProvider';
import Tastenkuerzel from './Tastenkuerzel';
import { useViewport } from './useViewport';

const TREFFLAECHE = 48;

/** Sichtbares Kürzel für den globalen Suchzugang. */
export function suchKuerzelFuerUserAgent(userAgent: string): string {
  return /Mac|iPhone|iPad|iPod/.test(userAgent) ? '⌘K' : 'Strg+K';
}

/**
 * Einheitlicher Zugang zur Kommandopalette in beiden Kopfzeilen.
 *
 * Unterhalb von `lg` bleibt die A1-Trefffläche der Mindestwert. Die Handschuh-
 * Stufe darf darüber wachsen (LFH-460), weil dies der sichtbare Suchzugang ist.
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
  const stil = {
    color: 'var(--lfh-kopf-vordergrund)',
    flexShrink: 0,
    ...(breit
      ? {}
      : {
          width: trefflaeche,
          height: trefflaeche,
          minWidth: trefflaeche,
          minHeight: trefflaeche,
        }),
  } as const;

  return (
    <Button
      type="text"
      aria-label="Suchen"
      aria-keyshortcuts={kuerzel === '⌘K' ? 'Meta+K' : 'Control+K'}
      icon={<TbSearch size={20} aria-hidden />}
      onClick={toggle}
      style={stil}
    >
      {breit && (
        // Eine Flex-Zeile, kein Fragment: JSX verschluckt den Zeilenumbruch
        // zwischen zwei Elementen ersatzlos, sodass Beschriftung und Marke bis zum
        // 08.08.2026 als „Suchen⌘K" in einem Zug standen.
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}>
          Suchen
          <Tastenkuerzel aria-hidden>{kuerzel}</Tastenkuerzel>
        </span>
      )}
    </Button>
  );
}
