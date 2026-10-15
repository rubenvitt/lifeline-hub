import { useQuery } from '@tanstack/react-query';
import { ladeModulFreigaben } from '../../api/einsaetze';
import { listEinsatzMaterial } from '../../api/einsatzMaterial';
import { einsatzKeys } from '../../api/queryKeys';
import type { UhsDetail } from '../../api/types';
import { useAuthOptional } from '../../auth/AuthContext';
import { istSprungGesperrt } from '../../einsatz/modulRegistry';
import MaterialAmOrt from '../../kraefte/MaterialAmOrt';

interface Props {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
}

/**
 * Reiter „Material“ der UHS (LLH-1225, design.md D12): eine Hülle um den Baustein für Material am
 * Ort. Die Posten kommen aus dem UHS-Detail (`uhs.material`), das auch Leser ohne Materialrecht
 * bekommen (LLH-1182) und das die Live-Meldung `material` nachlädt. Das Angebot von „Material
 * zuordnen …“ kommt aus der Materialliste: nur mit Schreibrecht und Freigabe Material abgefragt,
 * nie am Gerät.
 *
 * Ein Gerät (UHS-Laptop) liest nur das Material seiner UHS: die Einsatzliste ist ihm verwehrt
 * (403), Zuordnen und Lösen ebenso (LFH-892). Bis `/me` sagt, ob ein Gerät angemeldet ist, bleibt
 * der Reiter deshalb lesend und fragt nichts ab.
 *
 * Eine aufgelöste UHS nimmt kein Material mehr an (LLH-1093 D14, Server 422): der Grund steht an
 * der Auswahl; Lösen bleibt (LLH-1224 D13).
 */
export default function MaterialTab({ einsatzId, uhs, schreibgeschuetzt }: Props) {
  const auth = useAuthOptional();
  const nurLesen = auth != null && (auth.laedt || auth.geraet != null);
  const darfSchreiben = !schreibgeschuetzt && !nurLesen;

  // Derselbe Schlüssel wie `useModulFreigaben`; der Abruf hier sagt zusätzlich, ob sie feststehen.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
    enabled: darfSchreiben,
  });
  // Unbekannt heißt offen (wie `istSprungGesperrt`); abgefragt wird erst, wenn sie feststehen.
  const materialFrei = !istSprungGesperrt('material', freigabenQuery.data);
  const freigabenFest = freigabenQuery.isSuccess || freigabenQuery.isError;
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
    enabled: darfSchreiben && freigabenFest && materialFrei,
  });

  return (
    <MaterialAmOrt
      einsatzId={einsatzId}
      ort={{ art: 'uhs', id: uhs.id }}
      posten={uhs.material}
      angebot={darfSchreiben && materialFrei ? materialQuery : undefined}
      darfSchreiben={darfSchreiben}
      materialFrei={materialFrei}
      loesenText="Lösen"
      sperrgrund={uhs.status === 'aufgeloest' ? 'UHS aufgelöst' : null}
    />
  );
}
