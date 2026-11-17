import { useLocation, useParams } from 'react-router';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenLeer } from '../components/SeitenZustand';
import { einsatzModulPfad, parseRouteId } from '../routing/deeplinks';
import { useMarkNichtGefunden } from './nichtGefundenContext';
import { modulZuRoute } from './modulRegistry';
import { useUeberblickRueckweg } from './useUeberblickRueckweg';

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
 * (`useUeberblickRueckweg`, geteilt mit der Fehlergrenze). Bis die Freigaben geladen sind, steht
 * kein Knopf, sonst wechselte sein Ziel unter dem Finger. Die Adresse merkt der Rahmen nicht als letzten Ort
 * (`nichtGefundenContext.ts`).
 */
export default function SeiteNichtGefunden() {
  const einsatzId = parseRouteId(useParams().id);
  const { pathname } = useLocation();
  useMarkNichtGefunden();
  const zielRoute = useUeberblickRueckweg(einsatzId);

  let aktion: { label: string; pfad: string } | undefined;
  if (einsatzId !== null && zielRoute !== null) {
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
