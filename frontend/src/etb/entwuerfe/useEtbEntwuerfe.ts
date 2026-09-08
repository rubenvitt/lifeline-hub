// frontend/src/etb/entwuerfe/useEtbEntwuerfe.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntwurfWerte, EtbEntwurf } from './entwurfModell';
import { istLeer, werteZuPatch, zuWerte } from './entwurfModell';
import { entwuerfeLaden, entwurfEntfernen, entwurfSpeichern } from './entwurfStore';
import type { MetadatenWerte } from '../schnellerfassungModell';

function aktivKey(einsatzId: number): string {
  return `etb-entwurf-aktiv-${einsatzId}`;
}

function leererEntwurf(einsatzId: number, metadaten: MetadatenWerte = {}, vorbelegungGeprueft = false): EtbEntwurf {
  const jetzt = new Date().toISOString();
  return {
    id: crypto.randomUUID(), einsatz_id: einsatzId,
    ...werteZuPatch({ inhalt: '', typ: 'meldung', metadaten }),
    ...(vorbelegungGeprueft ? { an_vorbelegung_geprueft: true as const } : {}),
    erstellt_at: jetzt, geaendert_at: jetzt,
  };
}

/** Der Aufrufer montiert je Einsatz neu (key=einsatzId). */
export function useEtbEntwuerfe(einsatzId: number, fuehrungsstelle?: string | null, kontextLaedt = false) {
  // Erst beim Initialisieren festhalten: beim Mount kann noch ein alter Einsatz aus
  // dem Query-Cache vorliegen. Spätere Refetches dürfen den Entwurf nicht neu laden.
  const anfangsEmpfaenger = useRef<string | undefined>(undefined);
  const [entwuerfe, setEntwuerfe] = useState<EtbEntwurf[]>([]);
  const [aktiverId, setAktiverId] = useState<string | null>(null);
  const initialisiert = useRef(false);
  // Spiegel des aktuellen State, damit Callbacks den Bestand lesen können, ohne ihn im
  // setEntwuerfe-Updater zu berechnen (der bliebe sonst seiteneffektbehaftet). Render-Phase-
  // Zuweisung ist idempotent (StrictMode-Doppelrender unkritisch).
  const entwuerfeRef = useRef<EtbEntwurf[]>(entwuerfe);
  entwuerfeRef.current = entwuerfe;

  useEffect(() => {
    if (initialisiert.current || kontextLaedt) return;
    let abgebrochen = false;
    void (async () => {
      const geladen = await entwuerfeLaden(einsatzId);
      if (abgebrochen || initialisiert.current) return;
      initialisiert.current = true;
      anfangsEmpfaenger.current = fuehrungsstelle?.trim();
      if (geladen.length === 0) {
        const leer = leererEntwurf(einsatzId, anfangsEmpfaenger.current ? { an: anfangsEmpfaenger.current } : {}, !!anfangsEmpfaenger.current);
        setEntwuerfe([leer]);
        setAktiverId(leer.id);
        return;
      }
      setEntwuerfe(geladen);
      const gemerkt = localStorage.getItem(aktivKey(einsatzId));
      const gueltig = gemerkt && geladen.some((e) => e.id === gemerkt);
      setAktiverId(gueltig ? gemerkt! : geladen[0].id);
    })();
    return () => { abgebrochen = true; };
  }, [einsatzId, fuehrungsstelle, kontextLaedt]);

  // Bewusst leere Zustände nach Entfernen/Absenden/+ bleiben erhalten. Unberührte
  // Anfangsdefaults haben An und werden weiterhin NICHT beim Mount gespeichert.
  // Erst nach dem Commit sichern: ein beim Schließen verworfener Ersatzentwurf
  // darf nicht als Zombie in IndexedDB landen (auch bei parallelem Schließen).
  const leerGesichert = useRef(new WeakSet<EtbEntwurf>());
  useEffect(() => {
    for (const e of entwuerfe) {
      if (e.an_vorbelegung_geprueft && istLeer(zuWerte(e)) && !leerGesichert.current.has(e)) {
        leerGesichert.current.add(e);
        void entwurfSpeichern(e);
      }
    }
  }, [entwuerfe]);

  const aktivenSetzen = useCallback((id: string) => {
    setAktiverId(id);
    localStorage.setItem(aktivKey(einsatzId), id);
  }, [einsatzId]);

  const neuerEntwurf = useCallback((metadaten: MetadatenWerte = {}) => {
    const leer = leererEntwurf(einsatzId, metadaten, !!anfangsEmpfaenger.current);
    setEntwuerfe((prev) => [...prev, leer]);
    aktivenSetzen(leer.id);
  }, [einsatzId, aktivenSetzen]);

  const entwurfAktualisieren = useCallback((id: string, werte: EntwurfWerte) => {
    const patch = werteZuPatch(werte);
    const geaendert_at = new Date().toISOString();
    const bestand = entwuerfeRef.current.find((e) => e.id === id);
    setEntwuerfe((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch, geaendert_at } : e)));
    // Persistenz NACH dem (jetzt seiteneffektfreien) Updater. Der nächste Zustand des
    // geänderten Entwurfs wird funktional aus dem Bestand + patch gebildet — er hängt nicht
    // vom Updater-Ergebnis ab (die nicht-gepatchten Felder id/einsatz_id/erstellt_at sind
    // über die Lebensdauer konstant). So läuft der Write unter React.StrictMode genau einmal
    // statt doppelt (LFH-216).
    if (!bestand) return;
    if (istLeer(werte)) {
      if (!bestand.an_vorbelegung_geprueft) void entwurfEntfernen(id);
    } else {
      void entwurfSpeichern({ ...bestand, ...patch, geaendert_at });
    }
  }, []);

  const entwurfSchliessen = useCallback(async (id: string, metadaten: MetadatenWerte = {}) => {
    await entwurfEntfernen(id);
    // leer EINMAL außerhalb der Updater erzeugen (stabile Id): unter React.StrictMode
    // (Dev-Server / e2e) werden Updater doppelt invoked — eine IM Updater erzeugte
    // crypto.randomUUID-Id divergierte sonst zwischen entwuerfe und aktiverId, sodass der
    // neue leere Tab keinen aktiven Inhalt mehr rendert (LFH-214). Beide Setter bleiben
    // FUNKTIONAL (lesen prev = frisch committeter State) und sind damit immun gegen
    // Zustandsänderungen während des vorausgehenden await (neuer Tab / paralleles
    // Schließen) und chainen korrekt — ein Closure-Snapshot überschriebe den aktuellen
    // State und ließe einen Zombie-Tab zurück.
    const leer = leererEntwurf(einsatzId, metadaten, !!anfangsEmpfaenger.current);
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
      localStorage.setItem(aktivKey(einsatzId), naechster);
      return naechster;
    });
  }, [einsatzId]);

  return { entwuerfe, aktiverId, neuerEntwurf, entwurfSchliessen, entwurfAktualisieren, aktivenSetzen };
}
