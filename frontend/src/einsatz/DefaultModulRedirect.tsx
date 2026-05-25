import { Navigate } from 'react-router-dom';
import { redirectZiel } from './modulRegistry';

/** Index-Route /einsaetze/:id → relatives Default-Modul (Dashboard sobald fertig, sonst ETB). */
export default function DefaultModulRedirect() {
  return <Navigate to={redirectZiel()} replace />;
}
