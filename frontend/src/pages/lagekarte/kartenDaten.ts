import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Wendet eine Datenaktualisierung zuverlässig auf die Karte an — auch wenn der Style gerade nicht
 * geladen ist.
 *
 * MapLibre verwirft `addSource`/`setData` still, solange `isStyleLoaded()` false ist — etwa mitten
 * im Zonen-Zeichnen, wenn terra-draw Layer auf- und abbaut. Die Anwendung wird dann auf den ersten
 * `render`-Frame mit geladenem Style vertagt. Nicht `idle`: das feuert erst nach dem letzten Frame
 * plus Tile-Loads und kostete den Zeichner Sekunden. `anwenden` kapselt das idempotente
 * (Re-)Anlegen plus setData.
 */
export function wendeKartenDatenAn(
  map: Pick<MapLibreMap, 'isStyleLoaded' | 'on' | 'off'>,
  anwenden: () => void,
): void {
  if (map.isStyleLoaded()) {
    anwenden();
    return;
  }
  const versuch = () => {
    if (!map.isStyleLoaded()) return; // weiter warten
    map.off('render', versuch);
    anwenden();
  };
  map.on('render', versuch);
}
