import { Navigate, useParams } from 'react-router';
import { einsaetzePfad, einsatzModulPfad, parseRouteId } from '../routing/deeplinks';

/**
 * Deep-Link-Modul: leitet auf die `route` eines anderen Moduls im selben Einsatz um.
 * Absoluter Pfad, weil relatives Navigieren aus einer Leaf-Route mehrdeutig ist.
 * Eine ungültige ID führt auf die Einsatzliste statt in `/einsaetze/NaN/…` (LFH-438); im
 * App-Baum fängt das schon `EinsatzLayout` ab, hier steht es, weil die Komponente allein trägt.
 */
export default function ModulRedirect({ to }: { to: string }) {
  const einsatzId = parseRouteId(useParams().id);
  if (einsatzId == null) return <Navigate to={einsaetzePfad()} replace />;
  return <Navigate to={einsatzModulPfad(einsatzId, to)} replace />;
}
