import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import EinsatzSeite from '../components/EinsatzSeite';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import GeraetMeldungen from './GeraetMeldungen';

/**
 * Meldungen an die Einsatzleitung als eigener Bereich der Gerätehülle, für stellengebundene
 * Ansichten ohne Stellenbereich (Bereitstellungsraum, LFH-1042). Absender ist die Stelle der
 * Kopplung.
 */
export default function GeraetMeldungenPage() {
  const { geraet, benutzer } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const stelle = geraet?.stelle ?? '';
  return (
    <EinsatzSeite titel="Meldungen" meta={stelle} dataUpdatedAt={einsatzQuery.dataUpdatedAt}>
      <GeraetMeldungen
        einsatzId={einsatzId}
        stelle={stelle}
        schreibgeschuetzt={!darfImEinsatzSchreiben(einsatzQuery.data, benutzer)}
      />
    </EinsatzSeite>
  );
}
