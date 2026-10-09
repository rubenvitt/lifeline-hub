import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import EinsatzSeite from '../components/EinsatzSeite';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import GeraetMeldungen from './GeraetMeldungen';

/**
 * Meldungen an die Einsatzleitung als eigener Bereich der Gerätehülle des Bereitstellungsraums
 * (LFH-1042). Absender sind Stelle und Gerät der Kopplung, wie bei UHS und Abschnitt.
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
  const absender = [stelle, geraet?.bezeichnung].filter(Boolean).join(' · ');
  return (
    <EinsatzSeite titel="Melden" meta={stelle} dataUpdatedAt={einsatzQuery.dataUpdatedAt}>
      <GeraetMeldungen
        einsatzId={einsatzId}
        absender={absender}
        schreibgeschuetzt={!darfImEinsatzSchreiben(einsatzQuery.data, benutzer)}
      />
    </EinsatzSeite>
  );
}
