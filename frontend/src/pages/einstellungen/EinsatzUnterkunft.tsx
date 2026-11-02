import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { einsatzKeys } from '../../api/queryKeys';
import {
  ladeEinsatzUnterkunftRichtwerte,
  setzeEinsatzUnterkunftRichtwert,
} from '../../api/unterkunftRichtwerte';
import RichtwerteListe from '../../betreuung/unterkunft/RichtwerteListe';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { RECHTE_TEXT, useEinstellungenDaten } from '../EinsatzEinstellungenPage';

/**
 * Sektion `…/einstellungen/unterkunft` (LLH-1520, design.md D2): die Richtwerte des
 * Unterkunftsrechners für diesen Einsatz. Leer erbt ein Wert von der Organisation, dort leer von
 * der Vorgabe; jede Zeile nennt beides. Jedes Feld speichert beim Verlassen (wie „Pegel“, keine
 * Speichern-Leiste). Rechte wie die übrigen Einstellungen (`EinsatzVerwaltungszugriff`).
 */
export default function EinsatzUnterkunft() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const daten = useEinstellungenDaten(einsatzId);
  const query = useQuery({
    queryKey: einsatzKeys.unterkunftRichtwerte(einsatzId),
    queryFn: () => ladeEinsatzUnterkunftRichtwerte(einsatzId),
  });
  const setzen = useMutation({
    mutationFn: ({ schluessel, wert }: { schluessel: string; wert: number | null }) =>
      setzeEinsatzUnterkunftRichtwert(einsatzId, schluessel, wert),
    onSuccess: (neu) => qc.setQueryData(einsatzKeys.unterkunftRichtwerte(einsatzId), neu),
  });

  if (daten.laedt || query.isLoading) return <SeitenSkeleton />;
  if (query.isError || !query.data) {
    return (
      <SeitenFehler
        text="Richtwerte nicht ladbar"
        ursache={query.error}
        onWiederholen={() => void query.refetch()}
      />
    );
  }

  return (
    <>
      <SeitenHinweise
        fehler={setzen.error}
        fehlerTitel="Richtwert nicht gespeichert"
        rechteFehlt={daten.istAktiv && !daten.darfBearbeiten}
        rechteText={RECHTE_TEXT}
      />
      <RichtwerteListe
        ebenen={query.data}
        ebene="einsatz"
        gesperrt={!daten.darfBearbeiten}
        laeuft={setzen.isPending ? setzen.variables?.schluessel : null}
        onSetzen={(schluessel, wert) => setzen.mutate({ schluessel, wert })}
      />
    </>
  );
}
