import { Navigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Spin } from 'antd';
import { ladeEinstellungen } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { einsaetzePfad, parseRouteId } from '../routing/deeplinks';
import { aufloeseStandardModul, redirectZiel } from './modulRegistry';

/**
 * Index-Route /einsaetze/:id → relatives Default-Modul. Berücksichtigt das pro Einsatz
 * konfigurierbare Standard-Modul (LFH-131); fällt auf `redirectZiel()` (Überblick, sonst ETB)
 * zurück, wenn keines gesetzt oder das gesetzte Modul nicht (mehr) fertig ist.
 */
export default function DefaultModulRedirect() {
  const einsatzId = parseRouteId(useParams().id);
  // Ungültige ID → Einsatzliste statt eines Abrufs gegen `NaN` (LFH-438); im App-Baum fängt das
  // schon `EinsatzLayout` ab, hier steht es, weil die Komponente allein trägt.
  if (einsatzId == null) return <Navigate to={einsaetzePfad()} replace />;
  return <StandardModulWeiche einsatzId={einsatzId} />;
}

function StandardModulWeiche({ einsatzId }: { einsatzId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });
  // Bis die Einstellungen geladen sind: kurzer Spinner statt Fehl-Redirect — sonst
  // würde er erst auf den Fallback und dann auf den Override springen (Doppel-Navigation).
  if (isLoading) return <Spin style={{ margin: 24 }} />;
  const ziel = data ? aufloeseStandardModul(data.standard_modul) : redirectZiel();
  return <Navigate to={ziel} replace />;
}
