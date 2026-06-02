import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Wendet eine Datenaktualisierung zuverlässig auf die Karte an — auch wenn der
 * Style gerade nicht „fertig geladen" ist.
 *
 * MapLibre verwirft `addSource`/`setData` still, solange `isStyleLoaded()` false
 * ist. Genau das passiert mitten im Zonen-Zeichnen: terra-draw baut beim Start/Stop
 * eigene Layer auf und ab, wodurch der Style kurzzeitig „nicht geladen" ist. Fällt
 * der Post-Anlegen-Refetch in dieses Fenster, ginge die frisch gezeichnete Zone
 * verloren und wäre erst nach einem Reload sichtbar. Deshalb vertagen wir die
 * Anwendung in diesem Fall auf den frühestmöglichen Frame mit geladenem Style —
 * `render` feuert pro Frame; beim ersten Frame mit `isStyleLoaded()` wenden wir an
 * und melden uns wieder ab. (Bewusst NICHT `idle`: das feuert erst nach dem letzten
 * Frame plus Tile-Loads und kostete den Zeichner mehrere Sekunden, weil bei ihm
 * terra-draw die Karte noch beschäftigt hält.) `anwenden` kapselt das idempotente
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
