import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import RegistrierlisteDruckSeite from '../betreuung/registrierung/RegistrierlisteDruckSeite';
import { GERAET_START_PFAD, geraetBetreuungPfad } from '../routing/deeplinks';

/**
 * Registrierliste der eigenen Stelle drucken am Gerät „Betreuungsstelle“ (LLH-1616, Spec
 * `betreuung-registrierung`, „Registrierliste drucken am Gerät“). Die Stelle ist die gebundene,
 * sie steht nicht in der Adresse; der Server lässt nur sie zu (fremd 403) und protokolliert je
 * Person mit dem Gerätekonto. Bewusste Ausnahme zu `geraetDarf('person-druck')`.
 */
export default function GeraetRegistrierlisteDruckPage() {
  const { geraet } = useAuth();
  if (!geraet) return <Navigate to={GERAET_START_PFAD} replace />;
  if (geraet.stelle_id == null)
    return <Navigate to={geraetBetreuungPfad(geraet.einsatz_id)} replace />;
  return (
    <RegistrierlisteDruckSeite
      einsatzId={geraet.einsatz_id}
      stelleId={geraet.stelle_id}
      stelleBezeichnung={geraet.stelle ?? undefined}
      zurueck={{ pfad: geraetBetreuungPfad(geraet.einsatz_id), label: 'Zurück zur Stelle' }}
    />
  );
}
