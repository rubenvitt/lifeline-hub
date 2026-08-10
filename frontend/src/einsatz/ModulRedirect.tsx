import { Navigate, useParams } from 'react-router';
import { einsatzModulPfad } from '../routing/deeplinks';

/**
 * Deep-Link-Modul: leitet auf die `route` eines anderen Moduls im selben Einsatz um.
 * Absoluter Pfad, weil relatives Navigieren aus einer Leaf-Route mehrdeutig ist.
 *
 * `Number(id)` statt des rohen Params: der Builder nimmt laut Dateikopf von
 * `deeplinks.ts` eine gültige positive Integer-ID entgegen. Die Route matcht ohnehin
 * nur MIT `:id`, ein fehlender Param ist hier also nicht erreichbar — die Umwandlung
 * ist die Vertragserfüllung gegenüber dem Builder, keine Guard-Verdopplung.
 */
export default function ModulRedirect({ to }: { to: string }) {
  const { id } = useParams();
  return <Navigate to={einsatzModulPfad(Number(id), to)} replace />;
}
