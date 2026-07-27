import { Navigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Spin } from 'antd';
import { ladeEinstellungen } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { aufloeseStandardModul, redirectZiel } from './modulRegistry';

/**
 * Index-Route /einsaetze/:id → relatives Default-Modul. Berücksichtigt das pro
 * Einsatz konfigurierbare Standard-Modul (LFH-131); fällt auf das globale
 * `redirectZiel()` (Dashboard, sonst ETB) zurück, wenn keines gesetzt oder das
 * gesetzte Modul nicht (mehr) fertig ist.
 */
export default function DefaultModulRedirect() {
  const { id } = useParams();
  const einsatzId = Number(id);
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
