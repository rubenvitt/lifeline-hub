import { useQuery } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router';
import { ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenLeer } from '../components/SeitenZustand';
import { einsatzModulPfad, parseRouteId } from '../routing/deeplinks';
import { useNichtGefundenMelden } from './nichtGefundenMarke';
import { freiesRueckwegModul, modulZielRoute, modulZuRoute, redirectZiel } from './modulRegistry';

/**
 * Auffangseite für eine unbekannte Adresse im Einsatz (LLH-1729): ein unbekanntes Segment
 * (`/einsaetze/1/gibtsnicht`), ein unbekannter Unterpfad eines Moduls (`/etb/quatsch`) oder ein
 * Registry-Schlüssel statt der Route (`/gefahrenzonen`). Vorher fielen sie bis zur globalen
 * Auffangroute durch und landeten ohne Meldung auf der Einsatzliste.
 *
 * Die Seite steht im Einsatzrahmen, die Adresse bleibt in der Leiste und steht sichtbar da, damit
 * sich ein Tippfehler erkennen lässt. Kein Toast: die Toastplätze tragen nur Alarme
 * (`frontend/AGENTS.md`). Keine Zweitadresse für Registry-Schlüssel, jedes Modul hat eine Route.
 *
 * Der Rückweg führt in den Überblick, ist er gesperrt, ins erste freie Modul
 * (`freiesRueckwegModul` ohne das Standardmodul des Einsatzes, anders als Modulwächter und
 * `ModulStub`: der Auftrag nennt den Überblick). Bis die Freigaben geladen sind, steht kein Knopf,
 * sonst wechselte sein Ziel unter dem Finger. Die Adresse merkt der Rahmen nicht als letzten Ort
 * (`nichtGefundenMarke.ts`).
 */
export default function SeiteNichtGefunden() {
  const einsatzId = parseRouteId(useParams().id);
  const { pathname } = useLocation();
  useNichtGefundenMelden();
  const freigabenQ = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId ?? 0),
    queryFn: () => ladeModulFreigaben(einsatzId!),
    enabled: einsatzId !== null,
  });

  let aktion: { label: string; pfad: string } | undefined;
  if (einsatzId !== null && !freigabenQ.isLoading) {
    // Ohne Freigaben (Abruf gescheitert, offline) der feste Einstieg: ein Rückweg ist besser als
    // keiner, und die Zielseite meldet eine Sperre selbst.
    const zielRoute = freigabenQ.data
      ? modulZielRoute(freiesRueckwegModul(freigabenQ.data))
      : redirectZiel();
    const ziel = modulZuRoute(zielRoute);
    aktion = {
      label: ziel ? `${ziel.label} öffnen` : 'Einstiegsmodul öffnen',
      pfad: einsatzModulPfad(einsatzId, zielRoute),
    };
  }

  return (
    <EinsatzSeite titel="Seite nicht gefunden">
      <SeitenLeer
        titel="Diese Adresse gibt es im Einsatz nicht"
        hinweis={pathname}
        aktion={aktion}
      />
    </EinsatzSeite>
  );
}
