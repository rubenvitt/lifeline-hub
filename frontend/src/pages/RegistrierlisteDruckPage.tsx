import { Link, Navigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Breadcrumb } from 'antd';
import { ladeBetreuung } from '../api/betreuung';
import { einsatzKeys } from '../api/queryKeys';
import RegistrierlisteDruckSeite from '../betreuung/registrierung/RegistrierlisteDruckSeite';
import { modulName } from '../einsatz/modulRegistry';
import { betreuungPfad, betreuungsstellePfad, parseRouteId } from '../routing/deeplinks';

/**
 * Druckansicht der Registrierliste an der Stabsoberfläche (LLH-1616, Route
 * `betreuung/:stelleId/registrierliste/druck`, gegatet über das Segment `betreuung`). Die
 * Bezeichnung der Stelle kommt aus der Betreuungsübersicht (`einsatzKeys.betreuung`), es gibt
 * keinen Einzelabruf; die Personen nur über den protokollierten Druckabruf der Seite.
 */
export default function RegistrierlisteDruckPage() {
  const { id, stelleId: stelleParam } = useParams();
  const einsatzId = Number(id);
  const stelleId = parseRouteId(stelleParam);
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
  });

  if (stelleId == null) return <Navigate to={betreuungPfad(einsatzId)} replace />;
  const stelle = betreuungQuery.data?.stellen.find((s) => s.id === stelleId);
  const zurueck = betreuungsstellePfad(einsatzId, stelleId);

  return (
    <RegistrierlisteDruckSeite
      einsatzId={einsatzId}
      stelleId={stelleId}
      stelleBezeichnung={stelle?.bezeichnung}
      zurueck={{ pfad: zurueck, label: 'Zurück zur Stelle' }}
      breadcrumb={(einsatz) => (
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz },
            { title: <Link to={betreuungPfad(einsatzId)}>{modulName('betreuung')}</Link> },
            { title: <Link to={zurueck}>{stelle?.bezeichnung ?? 'Stelle'}</Link> },
            { title: 'Registrierliste' },
          ]}
        />
      )}
    />
  );
}
