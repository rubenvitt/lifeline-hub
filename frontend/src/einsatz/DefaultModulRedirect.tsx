import { Navigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Spin } from 'antd';
import { ladeEinstellungen, ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { einsaetzePfad, parseModulHinweis, parseRouteId } from '../routing/deeplinks';
import {
  aufloeseStandardModul,
  istModulFreigegeben,
  modulRegistry,
  modulZielRoute,
  redirectZiel,
} from './modulRegistry';

/**
 * Index-Route /einsaetze/:id → relatives Default-Modul. Berücksichtigt das pro Einsatz
 * konfigurierbare Standard-Modul (LFH-131); fällt auf `redirectZiel()` (Überblick, sonst ETB)
 * zurück, wenn keines gesetzt oder das gesetzte Modul nicht (mehr) fertig ist.
 *
 * Mit Modul-Hinweis (`?modul=<key>`, LLH-1821, Change `frgky8qr-einsatzwechsel-modul`, D1) bleibt
 * der Einsatzwechsel im Modul: ist es im Ziel frei (`istModulFreigegeben`), führt die Weiche auf
 * seine Startseite, sonst still auf das Ziel von eben. Der Umweg über diese Route baut die
 * Modulseite neu auf, damit kein Zustand des vorigen Einsatzes stehen bleibt. Die Ankunft ist keine
 * Wahl: „Zuletzt besucht“ zeichnet hier nichts auf (`zuletztModule.ts`).
 */
export default function DefaultModulRedirect() {
  const einsatzId = parseRouteId(useParams().id);
  const [params] = useSearchParams();
  // Ungültige ID → Einsatzliste statt eines Abrufs gegen `NaN` (LFH-438); im App-Baum fängt das
  // schon `EinsatzLayout` ab, hier steht es, weil die Komponente allein trägt.
  if (einsatzId == null) return <Navigate to={einsaetzePfad()} replace />;
  // Nur ein Schlüssel der Registry zählt; ein unbekannter fragt keine Freigaben ab.
  const hinweis = parseModulHinweis(params);
  const bekannt = hinweis && modulRegistry.some((m) => m.key === hinweis) ? hinweis : undefined;
  return <StandardModulWeiche einsatzId={einsatzId} modulHinweis={bekannt} />;
}

function StandardModulWeiche({
  einsatzId,
  modulHinweis,
}: {
  einsatzId: number;
  modulHinweis: string | undefined;
}) {
  const einstellungen = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });
  // Nur mit Hinweis: ohne ihn bleibt die Weiche, wie sie war. Beide Abfragen laufen parallel; die
  // Freigaben des Ziels liegen oft schon im Cache (der Rahmen fragt dieselben).
  const freigaben = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
    enabled: modulHinweis != null,
  });
  // Bis alles geladen ist: kurzer Spinner statt Fehl-Redirect — sonst würde er erst auf den
  // Fallback und dann auf den Override bzw. das Modul springen (Doppel-Navigation).
  if (einstellungen.isLoading || freigaben.isLoading)
    return <Spin style={{ margin: 'var(--lfh-luft-5)' }} />;
  const modul = modulRegistry.find((m) => m.key === modulHinweis);
  // Gesperrt, ausgeblendet, nicht fertig oder Freigaben unbekannt: still das bisherige Ziel.
  if (modul && istModulFreigegeben(modul, freigaben.data)) {
    return <Navigate to={modulZielRoute(modul)} replace />;
  }
  const ziel = einstellungen.data
    ? aufloeseStandardModul(einstellungen.data.standard_modul)
    : redirectZiel();
  return <Navigate to={ziel} replace />;
}
