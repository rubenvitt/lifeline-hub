import { Navigate, useParams } from 'react-router';
import { einsatzModulPfad } from '../routing/deeplinks';

/**
 * Deep-Link-Modul: leitet auf die `route` eines anderen Moduls im selben Einsatz um.
 * Absoluter Pfad, weil relatives Navigieren aus einer Leaf-Route mehrdeutig ist.
 * `Number(id)`, weil der Builder eine positive Integer-ID erwartet; die Route matcht nur MIT `:id`.
 */
export default function ModulRedirect({ to }: { to: string }) {
  const { id } = useParams();
  return <Navigate to={einsatzModulPfad(Number(id), to)} replace />;
}
