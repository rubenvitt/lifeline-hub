// frontend/src/etb/entwuerfe/useEtbEntwuerfe.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntwurfWerte, EtbEntwurf } from './entwurfModell';
import { istLeer, werteZuPatch } from './entwurfModell';
import { entwuerfeLaden, entwurfEntfernen, entwurfSpeichern } from './entwurfStore';

function aktivKey(einsatzId: number): string {
  return `etb-entwurf-aktiv-${einsatzId}`;
}

function leererEntwurf(einsatzId: number): EtbEntwurf {
  const jetzt = new Date().toISOString();
  return { id: crypto.randomUUID(), einsatz_id: einsatzId, inhalt: '', typ: 'meldung', erstellt_at: jetzt, geaendert_at: jetzt };
}

export function useEtbEntwuerfe(einsatzId: number) {
  const [entwuerfe, setEntwuerfe] = useState<EtbEntwurf[]>([]);
  const [aktiverId, setAktiverId] = useState<string | null>(null);
  const initialisiert = useRef(false);

  useEffect(() => {
    let abgebrochen = false;
    initialisiert.current = false;
    void (async () => {
      const geladen = await entwuerfeLaden(einsatzId);
      if (abgebrochen || initialisiert.current) return;
      initialisiert.current = true;
      if (geladen.length === 0) {
        const leer = leererEntwurf(einsatzId);
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
  }, [einsatzId]);

  const aktivenSetzen = useCallback((id: string) => {
    setAktiverId(id);
    localStorage.setItem(aktivKey(einsatzId), id);
  }, [einsatzId]);

  const neuerEntwurf = useCallback(() => {
    const leer = leererEntwurf(einsatzId);
    setEntwuerfe((prev) => [...prev, leer]);
    aktivenSetzen(leer.id);
  }, [einsatzId, aktivenSetzen]);

  const entwurfAktualisieren = useCallback((id: string, werte: EntwurfWerte) => {
    const patch = werteZuPatch(werte);
    const geaendert_at = new Date().toISOString();
    setEntwuerfe((prev) => {
      const naechste = prev.map((e) => {
        if (e.id !== id) return e;
        return { ...e, ...patch, geaendert_at };
      });
      // Persistenz innerhalb des Updaters, damit der gespeicherte Wert sicher bekannt ist.
      const gespeichert = naechste.find((e) => e.id === id);
      if (gespeichert) {
        if (istLeer(werte)) {
          void entwurfEntfernen(id);
        } else {
          void entwurfSpeichern(gespeichert);
        }
      }
      return naechste;
    });
  }, []);

  const entwurfSchliessen = useCallback(async (id: string) => {
    await entwurfEntfernen(id);
    setEntwuerfe((prev) => {
      const rest = prev.filter((e) => e.id !== id);
      if (rest.length === 0) {
        const leer = leererEntwurf(einsatzId);
        setAktiverId(leer.id);
        localStorage.setItem(aktivKey(einsatzId), leer.id);
        return [leer];
      }
      setAktiverId((aktuell) => {
        if (aktuell !== id) return aktuell;
        const naechster = rest[rest.length - 1].id;
        localStorage.setItem(aktivKey(einsatzId), naechster);
        return naechster;
      });
      return rest;
    });
  }, [einsatzId]);

  return { entwuerfe, aktiverId, neuerEntwurf, entwurfSchliessen, entwurfAktualisieren, aktivenSetzen };
}
