import { Button } from 'antd';
import { TbSearch } from 'react-icons/tb';
import { useCommandPalette } from '../command-palette/CommandPaletteProvider';
import { useViewport } from './useViewport';

const TREFFLAECHE = 48;

/** Sichtbares Kürzel für den globalen Suchzugang. */
export function suchKuerzelFuerUserAgent(userAgent: string): string {
  return /Mac|iPhone|iPad|iPod/.test(userAgent) ? '⌘K' : 'Strg+K';
}

/**
 * Einheitlicher Zugang zur Kommandopalette in beiden Kopfzeilen.
 *
 * Unterhalb von `lg` trägt der Knopf bewusst die A1-Trefffläche statt einer
 * Dichte-Prop: Er ist dann der alleinige sichtbare Suchzugang auf Touch-Geräten.
 */
export default function CommandPaletteTrigger() {
  const { toggle } = useCommandPalette();
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const kuerzel = suchKuerzelFuerUserAgent(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
  );
  const stil = {
    color: 'var(--lfh-kopf-vordergrund)',
    flexShrink: 0,
    ...(breit ? {} : {
      width: TREFFLAECHE,
      height: TREFFLAECHE,
      minWidth: TREFFLAECHE,
      minHeight: TREFFLAECHE,
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
        <>
          <span>Suchen</span>
          <kbd aria-hidden>{kuerzel}</kbd>
        </>
      )}
    </Button>
  );
}
