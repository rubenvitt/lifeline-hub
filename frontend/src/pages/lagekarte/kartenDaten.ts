import type { Map as MapLibreMap, Style } from 'maplibre-gl';

/** Was `wendeKartenDatenAn` von der Karte braucht. `style` fehlt nach `map.remove()`. */
type Karte = Pick<MapLibreMap, 'on' | 'off'> & { style?: Pick<Style, '_loaded'> };

/** Ausstehende Anwendungen je Karte, in der Reihenfolge ihrer letzten Anmeldung. */
interface Warteschlange {
  eintraege: Map<string, () => void>;
  abarbeiten: () => void;
}

const warteschlangen = new WeakMap<Karte, Warteschlange>();

/**
 * Bereit heißt: das Style-JSON ist angewandt (`style._loaded`), NICHT `isStyleLoaded()`.
 * Geprüft an maplibre 6.11.2 (LFH-943, D3): `addSource`/`addLayer`/`removeLayer` verlangen nur
 * `_loaded` (`_checkLoaded`), `setData` einer GeoJSON-Quelle gar nichts. `isStyleLoaded()` wartet
 * zusätzlich auf jede Kachel und jedes laufende `setData` (`_updatedSources`) — auf schwacher
 * Leitung kamen Eigenposition und Lageänderungen dann nicht auf die Karte, solange etwas lud.
 * Nach `setStyle(…, { diff: false })` ist das neue `Style` synchron ungeladen, nach
 * `map.remove()` fehlt es ganz.
 */
const istBereit = (map: Karte) => map.style?._loaded === true;

/**
 * Wendet eine Datenaktualisierung zuverlässig auf die Karte an — auch wenn der Stil gerade nicht
 * angewandt ist (erster Aufbau, `setStyle`).
 *
 * Ist die Karte nicht bereit, wartet die Anwendung in einer Warteschlange je Karte auf den ersten
 * `render`-Frame mit angewandtem Stil. Nicht `idle`: das feuert erst nach dem letzten Frame plus
 * Kachel-Loads und kostete den Zeichner Sekunden. `anwenden` kapselt das idempotente (Re-)Anlegen
 * plus `setData` und liest seinen Stand aus Refs.
 *
 * Je Karte und `schluessel` wartet höchstens EINE Anwendung (LFH-943, D2): ein neuer Aufruf
 * ersetzt die alte und rückt ans Ende. Die Schlange läuft in der Folge der letzten Anmeldung —
 * zuletzt angemeldet liegt oben (Marker über Abschnitten, Eigenposition über Markern, Zonen-Start
 * nach dem Neuaufbau). Deshalb gilt „sofort“ nur bei leerer Schlange: sonst überholte ein Aufruf
 * die Wartenden.
 */
export function wendeKartenDatenAn(map: Karte, schluessel: string, anwenden: () => void): void {
  const vorhanden = warteschlangen.get(map);
  if (!vorhanden && istBereit(map)) {
    anwenden();
    return;
  }
  const schlange = vorhanden ?? neueWarteschlange(map);
  schlange.eintraege.delete(schluessel);
  schlange.eintraege.set(schluessel, anwenden);
}

function neueWarteschlange(map: Karte): Warteschlange {
  const eintraege = new Map<string, () => void>();
  const abarbeiten = () => {
    // Was ein Eintrag beim Laufen neu anmeldet, landet in derselben Schlange und läuft mit.
    while (istBereit(map)) {
      const naechster = eintraege.entries().next();
      if (naechster.done) {
        map.off('render', abarbeiten);
        warteschlangen.delete(map);
        return;
      }
      const [schluessel, anwenden] = naechster.value;
      eintraege.delete(schluessel);
      anwenden();
    }
  };
  const schlange = { eintraege, abarbeiten };
  warteschlangen.set(map, schlange);
  map.on('render', abarbeiten);
  return schlange;
}
