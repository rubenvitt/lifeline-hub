import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import EinsatzSeite from '../components/EinsatzSeite';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { ANSICHT_LABEL } from '../pages/einstellungen/geraeteKern';
import { parseMeldungInhalt } from '../routing/deeplinks';
import GeraetMeldungen from './GeraetMeldungen';

/**
 * Meldungen an die Einsatzleitung als eigener Bereich der Gerätehülle des Bereitstellungsraums
 * (LFH-1042) und der Verpflegung (LFH-1044). Absender sind Stelle und Gerät der Kopplung, wie bei
 * UHS und Abschnitt; ohne Stelle (Verpflegung) steht die Ansicht an ihrer Stelle.
 *
 * `?inhalt=` füllt die Meldung vor (Fehlmenge aus der Verpflegung). Erst übernehmen, dann aus
 * der Adresse räumen (`replace`): ein stehengebliebener Auftrag füllte bei jedem Neuladen.
 */
export default function GeraetMeldungenPage() {
  const { geraet, benutzer } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const [suche, setSuche] = useSearchParams();
  const [vorbelegung, setVorbelegung] = useState<string | null>(null);
  useEffect(() => {
    if (!suche.has('inhalt')) return;
    setVorbelegung(parseMeldungInhalt(suche));
    const naechste = new URLSearchParams(suche);
    naechste.delete('inhalt');
    setSuche(naechste, { replace: true });
  }, [suche, setSuche]);
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const stelle = geraet?.stelle || (geraet ? ANSICHT_LABEL[geraet.ansicht] : '');
  const absender = [stelle, geraet?.bezeichnung].filter(Boolean).join(' · ');
  return (
    <EinsatzSeite titel="Melden" meta={stelle} dataUpdatedAt={einsatzQuery.dataUpdatedAt}>
      <GeraetMeldungen
        einsatzId={einsatzId}
        absender={absender}
        schreibgeschuetzt={!darfImEinsatzSchreiben(einsatzQuery.data, benutzer)}
        vorbelegung={vorbelegung}
      />
    </EinsatzSeite>
  );
}
