import { Navigate, useParams } from 'react-router-dom';

/**
 * Deep-Link-Modul: leitet auf die `route` eines anderen Moduls im selben Einsatz um.
 * Absoluter Pfad, weil relatives Navigieren aus einer Leaf-Route mehrdeutig ist.
 */
export default function ModulRedirect({ to }: { to: string }) {
  const { id } = useParams();
  return <Navigate to={`/einsaetze/${id}/${to}`} replace />;
}
