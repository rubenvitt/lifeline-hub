import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthOptional } from '../auth/AuthContext';
import { ladeBenutzerEinstellungen, setzeBenutzerEinstellung } from '../api/benutzerEinstellungen';
import { globalKeys } from '../api/queryKeys';
import {
  SCHLUESSEL_ZULETZT_BEFEHLE,
  leseZuletztBefehle,
  naechsteZuletztBefehle,
} from './zuletztBefehle';
import type { BenutzerEinstellungen } from '../api/types';

export interface BefehlsGedaechtnis {
  /** Gemerkte Befehls-IDs, jüngstes zuerst. Identitätsstabil, solange sich der Stand nicht ändert. */
  ids: string[];
  /** Meldet eine Ausführung. Nach dem Unmount des Aufrufers weiterhin gültig — siehe unten. */
  merke: (id: string) => void;
}

/**
 * Verdrahtet den Server-Slot am Benutzer mit dem reinen Kern aus `zuletztBefehle.ts`.
 *
 * ER GEHÖRT IN DEN PROVIDER, nicht in `PaletteHost`:
 *
 * **(1) Der Schreibweg muss die Palette überleben.** `CommandPalette.fuehreAus` ruft
 * `schliesse()` VOR `ausfuehren()`, der Palettenbaum ist dann abgehängt. Der Callback schließt
 * deshalb allein den `QueryClient` ein und ruft `apiSend` direkt; eine `useMutation` hätte zum
 * Zeitpunkt des Schreibens keine Fläche mehr.
 *
 * **(2) Das Lesen muss VOR dem Öffnen fertig sein**, sonst klappte die oberste Gruppe sichtbar
 * nach (WCAG 3.2.5). Der Provider ist app-weit montiert; den Fall einer späten Antwort fängt das
 * Standbild in `PaletteHost` ab.
 *
 * `enabled` hängt am angemeldeten Benutzer: ein 401 liefe durch `meldeSitzungAbgelaufen()`, die
 * Anmeldeseite meldete „Sitzung abgelaufen“. Der Key trägt die `benutzer.id` (Herleitung an
 * `globalKeys.benutzerEinstellungenVon`), ein Schichtwechsel ohne Neuladen wechselt das Fach mit.
 */
export function useZuletztBefehle(): BefehlsGedaechtnis {
  const auth = useAuthOptional();
  // Ein gekoppeltes Gerät hat keine Palette und kein Gedächtnis (LFH-892).
  const benutzerId = auth?.geraet ? null : (auth?.benutzer?.id ?? null);
  const client = useQueryClient();
  // MEMOISIERT: der Key steht in den Dependencies von `merke`, und das Standbild in `PaletteHost`
  // hängt an dessen Identität.
  const key = useMemo(() => globalKeys.benutzerEinstellungenVon(benutzerId), [benutzerId]);

  const { data } = useQuery({
    queryKey: key,
    queryFn: ladeBenutzerEinstellungen,
    enabled: benutzerId != null,
    /**
     * Der Stand ändert sich nur durch eigene Schreibvorgänge; ein Hintergrund-Refetch brächte
     * nichts Neues, könnte aber eine noch nicht quittierte Änderung zurückdrehen.
     */
    staleTime: Infinity,
  });

  const ids = useMemo(() => leseZuletztBefehle(data), [data]);

  /**
   * **ERST DEN BESTAND KENNEN, DANN SCHREIBEN.** Das PUT ist VOLLERSATZ; aus einem leeren Cache
   * gebildet ersetzte es die gemerkten IDs still durch eine (Kaltstart mit zähem Netz,
   * gescheiterter GET). Liegt kein Stand im Cache, wird er zuerst geholt; `ensureQueryData` hängt
   * sich an eine laufende Abfrage an. Nichts geht optimistisch in den Cache, sonst schriebe die
   * Erst-Antwort darüber.
   *
   * **Bleibt der Bestand unbekannt, wird GAR NICHT geschrieben**: das kostet einen Befehl, ein
   * Vollersatz aus dem Nichts löschte alle.
   *
   * Nach dem Warten wird der Stand erneut aus dem CACHE gelesen: zwei rasche Ausführungen hängen
   * an derselben Zusage, die zweite muss den Eintrag der ersten sehen. Eine eingeschlossene Liste
   * trüge den Stand ihres Renders.
   */
  const merke = useCallback(
    (id: string) => {
      // Ohne Sitzung gibt es kein Fach; ein GET liefe in den 401-Seam („Sitzung abgelaufen“).
      if (benutzerId == null) return;
      void (async () => {
        if (client.getQueryData<BenutzerEinstellungen>(key) === undefined) {
          try {
            await client.ensureQueryData({
              queryKey: key,
              queryFn: ladeBenutzerEinstellungen,
              staleTime: Infinity,
            });
          } catch {
            return;
          }
        }
        const stand = client.getQueryData<BenutzerEinstellungen>(key);
        if (stand === undefined) return;
        const wert = JSON.stringify(naechsteZuletztBefehle(leseZuletztBefehle(stand), id));
        client.setQueryData<BenutzerEinstellungen>(key, (alt) => ({
          ...alt,
          eintraege: { ...alt?.eintraege, [SCHLUESSEL_ZULETZT_BEFEHLE]: wert },
        }));
        // Die ANTWORT wird verworfen, obwohl sie den vollen Stand trägt: rasche Ausführungen quittieren
        // in unbestimmter Reihenfolge, eine späte Antwort setzte die Liste zurück. Ein Fehlschlag kostet
        // einen Gedächtniseintrag, und die Palette ist bereits geschlossen.
        void setzeBenutzerEinstellung(SCHLUESSEL_ZULETZT_BEFEHLE, wert).catch(() => {});
      })();
    },
    [benutzerId, client, key],
  );

  return useMemo(() => ({ ids, merke }), [ids, merke]);
}
