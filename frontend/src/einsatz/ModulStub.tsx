import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import Platzhalter, { type PlatzhalterRueckweg } from '../components/Platzhalter';
import { aufloeseStandardModul, modulZuRoute, type ModulEintrag } from './modulRegistry';
import { ladeEinstellungen } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { einsatzModulPfad, parseRouteId } from '../routing/deeplinks';

/**
 * Beschriftung des Rückweg-Knopfes aus der Registry („Überblick öffnen" statt „Zurück").
 * Fällt die Route aus der Registry heraus, bleibt der generische Text.
 */
function rueckwegLabel(zielRoute: string): string {
  const ziel = modulZuRoute(zielRoute);
  return ziel ? `${ziel.label} öffnen` : 'Standardmodul öffnen';
}

/**
 * Stub-Seite für geplante/WIP-Module. Route existiert, Inhalt ist Platzhalter.
 *
 * Route und Registry-Eintrag bleiben bewusst erreichbar (LFH-328): ein ausgeblendeter Eintrag
 * ließe die Route als Sackgasse zurück. Aufgelöst wird sie durch einen Rückweg auf das
 * Standardmodul des Einsatzes.
 *
 * Dass die Kommandopalette WIP-Module ausfiltert, ist Absicht: die Palette ist der
 * Schnellzugriff auf Arbeitsfähiges, die Modul-Rail zeigt den Modulbestand.
 */
export default function ModulStub({ modul }: { modul: ModulEintrag }) {
  const einsatzId = parseRouteId(useParams().id);
  const { data, isLoading } = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId ?? 0),
    queryFn: () => ladeEinstellungen(einsatzId!),
    enabled: einsatzId !== null,
  });
  // Erst nach dem Laden anbieten — sonst zeigte der Knopf kurz auf den globalen
  // Fallback und wechselte unter dem Zeigefinger auf das konfigurierte Modul.
  // Bei einem Fehlschlag greift `aufloeseStandardModul(undefined)` = globaler
  // Fallback; ein Rückweg ist dann besser als keiner.
  let rueckweg: PlatzhalterRueckweg | undefined;
  if (einsatzId !== null && !isLoading) {
    const zielRoute = aufloeseStandardModul(data?.standard_modul);
    rueckweg = { pfad: einsatzModulPfad(einsatzId, zielRoute), label: rueckwegLabel(zielRoute) };
  }
  return <Platzhalter titel={modul.label} beschreibung={modul.beschreibung} rueckweg={rueckweg} />;
}
