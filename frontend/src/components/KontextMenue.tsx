/**
 * Kontextmenü eines Datensatzes (LLH-1596, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/om9oxxiq-kontextmenue-baustein/design.md` D5/D6).
 *
 * Zeigt dieselben `MenueEintrag[]` wie das ⋮-Menü (`MenueAusloeser`) über dieselbe Funktion
 * `menueEintraege`: Gefahr rot hinter einem Trenner, gesperrte Einträge deaktiviert. Die Schale ist
 * `PunktankerMenue` am Fensterpunkt (`bezug="fenster"`); sie bringt `autoFocus`, Pfeile, Escape und
 * die Fokusrückgabe mit. Ausgelöst wird es über `useKontextMenue`.
 */
import PunktankerMenue from './PunktankerMenue';
import { menueEintraege, type MenueEintrag } from './MenueAusloeser';
import type { KontextAnker } from './useKontextMenue';

export interface KontextMenueOffen {
  anker: KontextAnker;
  /** Bekommt den Fokus beim Schließen zurück (das Element, von dem es geöffnet wurde). */
  vorherFokus: Element | null;
}

export interface KontextMenueProps<K extends string = string> {
  /** `null` = zu. */
  offen: KontextMenueOffen | null;
  eintraege: readonly MenueEintrag<K>[];
  /** Name des Menüs für Hilfstechnik (der des ⋮-Auslösers, mit Kennung des Datensatzes). */
  zugaenglicherName: string;
  onWahl: (key: K) => void;
  onSchliessen: () => void;
}

export function KontextMenue<K extends string = string>({
  offen,
  eintraege,
  zugaenglicherName,
  onWahl,
  onSchliessen,
}: KontextMenueProps<K>) {
  // Kein Menü ohne Einträge, auch kein leeres (wie beim ⋮-Auslöser).
  if (offen == null || eintraege.length === 0) return null;
  const vorher = offen.vorherFokus;
  return (
    <PunktankerMenue
      anker={offen.anker}
      bezug="fenster"
      ariaLabel={zugaenglicherName}
      ankerKennung="kontextmenue-anker"
      items={menueEintraege(eintraege) ?? []}
      onWaehlen={(key) => onWahl(key as K)}
      onSchliessen={onSchliessen}
      fokusZiel={() =>
        vorher instanceof HTMLElement && vorher.isConnected && vorher !== document.body
          ? vorher
          : null
      }
    />
  );
}
