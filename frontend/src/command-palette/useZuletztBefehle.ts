// frontend/src/command-palette/useZuletztBefehle.ts
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthOptional } from '../auth/AuthContext';
import { ladeBenutzerEinstellungen, setzeBenutzerEinstellung } from '../api/benutzerEinstellungen';
import { globalKeys } from '../api/queryKeys';
import { SCHLUESSEL_ZULETZT_BEFEHLE, leseZuletztBefehle, naechsteZuletztBefehle } from './zuletztBefehle';
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
 * ER GEHÖRT IN DEN PROVIDER, nicht in `PaletteHost` — zwei gemessene Gründe, die zusammen
 * die Bauform erzwingen:
 *
 * **(1) Der Schreibweg überlebt die Palette nicht, wenn er an ihr hängt.**
 * `CommandPalette.fuehreAus` ruft `schliesse()` VOR `ausfuehren()`, und
 * `{offen && <PaletteHost/>}` hängt den Teilbaum dabei ab. Eine `useMutation` aus diesem
 * Baum liefe aus einer abgehängten Komponente; beim nächsten Öffnen fehlte der Eintrag,
 * ohne Fehlermeldung. Der Callback hier hat deshalb KEINE Komponentenbindung: er schliesst
 * allein den `QueryClient` ein (der lebt an der Wurzel) und ruft `apiSend` direkt. Genau
 * deshalb ist es auch keine `useMutation` — deren Zustand („läuft", „fehlgeschlagen") hätte
 * zum Zeitpunkt des Schreibens gar keine Fläche mehr.
 *
 * **(2) Das Lesen muss VOR dem Öffnen fertig sein.** Läge die Query in `PaletteHost`, begänne
 * sie mit dem Öffnen — die oberste Gruppe klappte sichtbar nach, während der Blick schon auf
 * der Liste liegt. Die Startansicht ist per Vertrag kuratiert (LFH-337 · M11), keine
 * nachrückende Datenhalde, und „Live-Updates springen nicht unter dem Cursor" ist
 * Projektregel (WCAG 3.2.5). Der Provider ist app-weit montiert; der Stand steht damit im
 * Normalbetrieb lange vor dem ersten `Strg/⌘+K`. Die zweite Hälfte dieser Zusicherung — der
 * Fall, in dem die Antwort DOCH erst nach dem Öffnen eintrifft — liegt in `PaletteHost`:
 * dort wird der Stand beim Öffnen eingefroren.
 *
 * `enabled` hängt am angemeldeten Benutzer, und das ist keine Sparsamkeit: ein 401 auf einer
 * Query läuft in `api/queryClient.ts` durch `meldeSitzungAbgelaufen()` — die Anmeldeseite
 * bekäme beim blossen Laden die Meldung „Sitzung abgelaufen".
 *
 * **DER KEY TRÄGT DIE `benutzer.id`** (Review-Befund zu Etappe D). Die Herleitung steht an
 * `globalKeys.benutzerEinstellungenVon`; hier steht die Folge: ein Schichtwechsel OHNE
 * Neuladen wechselt das Cache-Fach mit, ohne dass irgendjemand etwas räumen muss.
 */
export function useZuletztBefehle(): BefehlsGedaechtnis {
  const auth = useAuthOptional();
  const benutzerId = auth?.benutzer?.id ?? null;
  const client = useQueryClient();
  // MEMOISIERT, nicht je Render frisch gebaut: der Key steht in den Dependencies von
  // `merke`, und ein neues Array je Render machte den Callback identitätsinstabil — das
  // Standbild in `PaletteHost` hängt an genau dieser Identität.
  const key = useMemo(() => globalKeys.benutzerEinstellungenVon(benutzerId), [benutzerId]);

  const { data } = useQuery({
    queryKey: key,
    queryFn: ladeBenutzerEinstellungen,
    enabled: benutzerId != null,
    /**
     * Der Stand ändert sich ausschliesslich durch eigene Schreibvorgänge. Ein
     * Hintergrund-Refetch (Vorgabe: bei Fensterfokus, `staleTime: 10_000`) könnte deshalb
     * nichts Neues bringen — wohl aber eine gerade abgesetzte, noch nicht quittierte
     * Änderung zurückdrehen und den eben ausgeführten Befehl wieder aus der Liste nehmen.
     */
    staleTime: Infinity,
  });

  const ids = useMemo(() => leseZuletztBefehle(data), [data]);

  /**
   * **ERST DEN BESTAND KENNEN, DANN SCHREIBEN** (Review-Befunde 3 und 4 zu Etappe D).
   *
   * Das PUT ist VOLLERSATZ. Aus einem leeren Cache gebildet ersetzte es die fünf gemerkten
   * IDs durch die eine gerade ausgeführte — stumm, ohne Fehlerbild. Zwei Wege dorthin, beide
   * real: der Kaltstart mit zähem Netz (Palette auf und Befehl ausgeführt, bevor
   * `/api/benutzer-einstellungen` geantwortet hat) und der gescheiterte GET, bei dem der
   * Cache dauerhaft leer bleibt.
   *
   * Deshalb: liegt kein Stand im Cache, wird er zuerst GEHOLT. `ensureQueryData` hängt sich
   * an eine bereits LAUFENDE Abfrage an, statt eine zweite zu starten — genau der Fall des
   * Kaltstarts. Und weil damit nichts mehr in den Cache geht, bevor die Antwort da ist,
   * fällt Befund 4 mit: vorher setzte `merke` optimistisch, react-query schrieb die
   * eintreffende Erst-Antwort darüber, und der nächste Schreibvorgang löschte den Eintrag
   * dann auch auf dem Server.
   *
   * **Bleibt der Bestand unbekannt, wird GAR NICHT geschrieben.** Das kostet den einen
   * Befehl — der billigere Verlust: ein Vollersatz aus dem Nichts löschte die gemerkten
   * Befehle serverseitig, und die kommen nicht wieder.
   *
   * Der Stand wird NACH dem Warten erneut aus dem Cache gelesen, nicht aus dem Rückgabewert:
   * zwei Ausführungen kurz hintereinander hängen an derselben Zusage, ihre Fortsetzungen
   * laufen in Reihenfolge — die zweite muss den Eintrag der ersten sehen, sonst verlöre sie
   * ihn. Aus dem CACHE und nicht aus `ids`, weil der Callback absichtlich nur an den
   * `QueryClient` gebunden ist (siehe Kopfkommentar): eine eingeschlossene Liste trüge den
   * Stand des Renders, in dem sie gebaut wurde, und die Palette hält ihn über ihre ganze
   * Öffnung fest.
   */
  const merke = useCallback((id: string) => {
    // Ohne Sitzung gibt es kein Fach, in das geschrieben werden könnte — und ein GET liefe
    // in den 401-Seam aus `queryClient.ts` („Sitzung abgelaufen" ohne Anlass).
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
      // Die ANTWORT wird verworfen, obwohl sie den vollen Stand trägt: zwei rasch
      // aufeinanderfolgende Ausführungen quittieren in unbestimmter Reihenfolge, und die
      // spätere Antwort auf den früheren Schreibvorgang setzte die Liste zurück.
      // Ein Fehlschlag kostet einen Gedächtniseintrag, keine Daten — und es gibt keine
      // Fläche, auf der er stünde: die Palette ist zu diesem Zeitpunkt bereits geschlossen.
      void setzeBenutzerEinstellung(SCHLUESSEL_ZULETZT_BEFEHLE, wert).catch(() => {});
    })();
  }, [benutzerId, client, key]);

  return useMemo(() => ({ ids, merke }), [ids, merke]);
}
