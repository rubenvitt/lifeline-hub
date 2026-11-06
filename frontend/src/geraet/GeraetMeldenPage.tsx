import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys } from '../api/queryKeys';
import EinsatzSeite from '../components/EinsatzSeite';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import GeraetMeldungen from './GeraetMeldungen';

/**
 * Meldungen des Abschnittsgeräts an die Einsatzleitung (LFH-1043, Spec `funktionsansichten`).
 * Absender ist der gebundene Abschnitt: der Server setzt ihn, ein fremder wäre 403. Der Freitext
 * nennt Abschnitt und Gerät, wie bei der UHS.
 *
 * Das Einheitengerät (LLH-1579) meldet ebenso, Absender ist die eigene Einheit (Rückmeldung der
 * Einheit), dazu wahlweise der Standort auf Knopfdruck (F9).
 */
export default function GeraetMeldenPage() {
  const { geraet } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const istEinheit = geraet?.ansicht === 'einheit';
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: geraet != null && !istEinheit,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: geraet != null && istEinheit,
  });
  const stelle = istEinheit
    ? einheitenQuery.data?.find((e) => e.id === geraet?.stelle_id)
    : abschnitteQuery.data?.find((a) => a.id === geraet?.stelle_id);
  const absender = [stelle?.name ?? geraet?.stelle, geraet?.bezeichnung]
    .filter(Boolean)
    .join(' · ');

  return (
    <EinsatzSeite titel="Melden">
      <GeraetMeldungen
        einsatzId={einsatzId}
        absender={absender}
        schreibgeschuetzt={!darfImEinsatzSchreiben(einsatzQuery.data) || !stelle}
        standort={istEinheit}
      />
    </EinsatzSeite>
  );
}
