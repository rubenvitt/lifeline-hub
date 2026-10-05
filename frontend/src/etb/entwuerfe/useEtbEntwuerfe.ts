import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntwurfWerte, EtbEntwurf } from './entwurfModell';
import { istLeer, werteZuPatch } from './entwurfModell';
import {
  aktivSchluessel,
  entwuerfeLaden,
  entwurfEntfernen,
  entwurfSpeichern,
} from './entwurfStore';
import type { MetadatenWerte } from '../schnellerfassungModell';
import { neueClientId } from '../../offline/clientId';

/**
 * Ein neuer, leerer Entwurf. Er trägt keine Von/An-Vorbelegung (LFH-894, design.md D2/D3): der
 * Standard-Rufname kommt erst beim Anzeigen und Absenden hinzu, der Entwurf hält nur, was die
 * Person ausdrücklich gesetzt hat. Damit entfiel auch die Marke `an_vorbelegung_geprueft`
 * (LFH-461); ältere Entwürfe tragen sie noch, sie wird nicht mehr gelesen.
 */
function leererEntwurf(
  benutzerId: number,
  einsatzId: number,
  metadaten: MetadatenWerte = {},
): EtbEntwurf {
  const jetzt = new Date().toISOString();
  return {
    id: neueClientId(),
    benutzer_id: benutzerId,
    einsatz_id: einsatzId,
    ...werteZuPatch({ inhalt: '', typ: 'meldung', metadaten }),
    erstellt_at: jetzt,
    geaendert_at: jetzt,
  };
}

/**
 * Der Aufrufer montiert je Einsatz neu (key=einsatzId). `benutzerId` ist die angemeldete Person
 * (LFH-767): Sie sieht und schreibt nur ihre eigenen Entwürfe. Ohne Person lädt und speichert
 * der Hook nichts — `RequireAuth` lässt die Seite dann ohnehin nicht zu.
 */
export function useEtbEntwuerfe(benutzerId: number | null, einsatzId: number) {
  const [entwuerfe, setEntwuerfe] = useState<EtbEntwurf[]>([]);
  const [aktiverId, setAktiverId] = useState<string | null>(null);
  const initialisiert = useRef(false);
  // Spiegel des aktuellen State, damit Callbacks den Bestand lesen können, ohne ihn im
  // setEntwuerfe-Updater zu berechnen (der bliebe sonst seiteneffektbehaftet). Render-Phase-
  // Zuweisung ist idempotent (StrictMode-Doppelrender unkritisch).
  const entwuerfeRef = useRef<EtbEntwurf[]>(entwuerfe);
  entwuerfeRef.current = entwuerfe;

  useEffect(() => {
    if (initialisiert.current || benutzerId === null) return;
    let abgebrochen = false;
    void (async () => {
      const geladen = await entwuerfeLaden(benutzerId, einsatzId);
      if (abgebrochen || initialisiert.current) return;
      initialisiert.current = true;
      if (geladen.length === 0) {
        const leer = leererEntwurf(benutzerId, einsatzId);
        setEntwuerfe([leer]);
        setAktiverId(leer.id);
        return;
      }
      setEntwuerfe(geladen);
      const gemerkt = localStorage.getItem(aktivSchluessel(benutzerId, einsatzId));
      const gueltig = gemerkt && geladen.some((e) => e.id === gemerkt);
      setAktiverId(gueltig ? gemerkt! : geladen[0].id);
    })();
    return () => {
      abgebrochen = true;
    };
  }, [benutzerId, einsatzId]);

  const aktivenSetzen = useCallback(
    (id: string) => {
      setAktiverId(id);
      if (benutzerId !== null) localStorage.setItem(aktivSchluessel(benutzerId, einsatzId), id);
    },
    [benutzerId, einsatzId],
  );

  const neuerEntwurf = useCallback(
    (metadaten: MetadatenWerte = {}) => {
      if (benutzerId === null) return;
      const leer = leererEntwurf(benutzerId, einsatzId, metadaten);
      setEntwuerfe((prev) => [...prev, leer]);
      aktivenSetzen(leer.id);
    },
    [benutzerId, einsatzId, aktivenSetzen],
  );

  /**
   * `festhalten`: der Entwurf trägt gewählte Dateien (LFH-748). Dann wird auch ein geleerter
   * Stand gespeichert statt entfernt — sonst fehlte seine id nach dem nächsten Remount der
   * Reiter (Berichtigung), und die Dateien hingen an keinem Entwurf mehr.
   */
  const entwurfAktualisieren = useCallback(
    (id: string, werte: EntwurfWerte, { festhalten = false }: { festhalten?: boolean } = {}) => {
      const patch = werteZuPatch(werte);
      const geaendert_at = new Date().toISOString();
      const bestand = entwuerfeRef.current.find((e) => e.id === id);
      setEntwuerfe((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch, geaendert_at } : e)));
      // Persistenz NACH dem seiteneffektfreien Updater. Der nächste Zustand wird aus Bestand +
      // patch gebildet und hängt nicht vom Updater-Ergebnis ab (id/einsatz_id/erstellt_at sind über
      // die Lebensdauer konstant). So läuft der Write unter React.StrictMode genau einmal (LFH-216).
      if (!bestand) return;
      if (istLeer(werte) && !festhalten) {
        void entwurfEntfernen(id);
      } else {
        void entwurfSpeichern({ ...bestand, ...patch, geaendert_at });
      }
    },
    [],
  );

  /**
   * Sichert einen Entwurf auch ohne Wert: trägt er gewählte Dateien, muss seine id einen Remount
   * der Reiter überleben (Berichtigung), sonst hingen die Dateien an keinem Entwurf mehr. Ein
   * leerer Entwurf entfällt beim nächsten leeren Aktualisieren.
   */
  const entwurfFesthalten = useCallback((id: string) => {
    const bestand = entwuerfeRef.current.find((e) => e.id === id);
    if (bestand) void entwurfSpeichern(bestand);
  }, []);

  /**
   * Gibt einem Entwurf eine NEUE id, Inhalt unverändert. Die Entwurfs-id ist die client_id;
   * steht sie schon für einen anderen Eintrag (409, zweiter Browser-Tab), käme der Entwurf mit
   * ihr nie mehr durch. Liefert die neue id, oder `null`, wenn es den Entwurf nicht (mehr) gibt.
   */
  const entwurfNeuAusweisen = useCallback(
    async (id: string): Promise<string | null> => {
      const bestand = entwuerfeRef.current.find((e) => e.id === id);
      if (!bestand) return null;
      const neu: EtbEntwurf = {
        ...bestand,
        id: neueClientId(),
        geaendert_at: new Date().toISOString(),
      };
      setEntwuerfe((prev) => prev.map((e) => (e.id === id ? neu : e)));
      setAktiverId((aktuell) => {
        if (aktuell !== id) return aktuell;
        localStorage.setItem(aktivSchluessel(neu.benutzer_id, einsatzId), neu.id);
        return neu.id;
      });
      await entwurfEntfernen(id);
      await entwurfSpeichern(neu);
      return neu.id;
    },
    [einsatzId],
  );

  const entwurfSchliessen = useCallback(
    async (id: string, metadaten: MetadatenWerte = {}) => {
      if (benutzerId === null) return;
      await entwurfEntfernen(id);
      // leer EINMAL außerhalb der Updater erzeugen (stabile Id): unter React.StrictMode laufen
      // Updater doppelt, eine darin erzeugte randomUUID divergierte zwischen entwuerfe und
      // aktiverId (LFH-214). Beide Setter bleiben FUNKTIONAL (lesen den frisch committeten State)
      // und sind damit immun gegen Änderungen während des vorausgehenden await — ein
      // Closure-Snapshot ließe einen Zombie-Tab zurück.
      const leer = leererEntwurf(benutzerId, einsatzId, metadaten);
      let naechsteListe: EtbEntwurf[] = [];
      setEntwuerfe((prev) => {
        const rest = prev.filter((e) => e.id !== id);
        naechsteListe = rest.length === 0 ? [leer] : rest;
        return naechsteListe;
      });
      setAktiverId((aktuell) => {
        if (aktuell !== id) return aktuell; // nicht-aktiven Tab geschlossen → aktiven behalten
        // aktiven Tab geschlossen → auf den letzten der neuen Liste wechseln.
        const naechster = naechsteListe[naechsteListe.length - 1].id;
        localStorage.setItem(aktivSchluessel(benutzerId, einsatzId), naechster);
        return naechster;
      });
    },
    [benutzerId, einsatzId],
  );

  return {
    entwuerfe,
    aktiverId,
    neuerEntwurf,
    entwurfSchliessen,
    entwurfAktualisieren,
    entwurfFesthalten,
    entwurfNeuAusweisen,
    aktivenSetzen,
  };
}
