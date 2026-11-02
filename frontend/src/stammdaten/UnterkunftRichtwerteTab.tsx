import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { globalKeys } from '../api/queryKeys';
import {
  ladeOrgUnterkunftRichtwerte,
  setzeOrgUnterkunftRichtwert,
} from '../api/unterkunftRichtwerte';
import RichtwerteListe from '../betreuung/unterkunft/RichtwerteListe';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

/**
 * Verwaltung → Stammdaten → Unterkunft (LLH-1520, design.md D2): die Richtwerte des
 * Unterkunftsrechners für die ganze Organisation. Leer gilt die Vorgabe aus dem Programm; ein
 * Einsatz kann jeden Wert noch einmal überschreiben. Nur der System-Admin ändert (der Server
 * antwortet sonst 403), jeder Angemeldete liest.
 */
export default function UnterkunftRichtwerteTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: globalKeys.unterkunftRichtwerte(),
    queryFn: ladeOrgUnterkunftRichtwerte,
  });
  const setzen = useMutation({
    mutationFn: ({ schluessel, wert }: { schluessel: string; wert: number | null }) =>
      setzeOrgUnterkunftRichtwert(schluessel, wert),
    onSuccess: (neu) => qc.setQueryData(globalKeys.unterkunftRichtwerte(), neu),
  });

  return (
    <AdminPage
      titel="Unterkunft"
      hinweis={
        <SeitenHinweise
          fehler={setzen.error ?? query.error}
          fehlerTitel={setzen.error ? 'Richtwert nicht gespeichert' : 'Richtwerte nicht geladen'}
          rechteText={STAMMDATEN_RECHTE_TEXT}
          rechteFehlt={!istAdmin}
        />
      }
    >
      <RichtwerteListe
        ebenen={query.data}
        ebene="org"
        gesperrt={!istAdmin}
        laeuft={setzen.isPending ? setzen.variables?.schluessel : null}
        onSetzen={(schluessel, wert) => setzen.mutate({ schluessel, wert })}
      />
    </AdminPage>
  );
}
