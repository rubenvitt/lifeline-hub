import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Breadcrumb } from 'antd';
import { ladeBetreuung } from '../api/betreuung';
import { einsatzKeys } from '../api/queryKeys';
import StelleNichtGefunden from '../betreuung/StelleNichtGefunden';
import RegistrierlisteDruckSeite from '../betreuung/registrierung/RegistrierlisteDruckSeite';
import { modulName } from '../einsatz/modulRegistry';
import { betreuungPfad, betreuungsstellePfad, parseRouteId } from '../routing/deeplinks';
import { ListenRueckweg } from '../components/ListenRueckweg';

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

  // Unlesbare Kennung: das Muster „gibt es nicht (mehr)“, keine stille Weiterleitung (LLH-1960).
  if (stelleId == null) return <StelleNichtGefunden einsatzId={einsatzId} />;
  const stelle = betreuungQuery.data?.stellen.find((s) => s.id === stelleId);
  const zurueck = betreuungsstellePfad(einsatzId, stelleId);

  return (
    <RegistrierlisteDruckSeite
      einsatzId={einsatzId}
      stelleId={stelleId}
      stelleBezeichnung={stelle?.bezeichnung}
      zurueck={{ pfad: zurueck, label: 'Zurück zur Stelle' }}
      liste={{ label: 'Zur Betreuung', pfad: betreuungPfad(einsatzId) }}
      breadcrumb={(einsatz) => (
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz },
            {
              title: (
                <ListenRueckweg to={betreuungPfad(einsatzId)}>
                  {modulName('betreuung')}
                </ListenRueckweg>
              ),
            },
            {
              title: (
                <ListenRueckweg to={zurueck}>{stelle?.bezeichnung ?? 'Stelle'}</ListenRueckweg>
              ),
            },
            { title: 'Registrierliste' },
          ]}
        />
      )}
    />
  );
}
