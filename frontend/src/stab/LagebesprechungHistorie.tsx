import { Flex, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { einsatzKeys } from '../api/queryKeys';
import { ladeLagebesprechungen } from '../api/stab';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import { etbPfad } from '../routing/deeplinks';
import { stabZeilenzielStil } from './zeilenziel';

/**
 * Historie der Lagebesprechungen (Spec 10): gelesen, nicht verglichen — also `Liste`, keine
 * Tabelle (LFH-330/B2). Je Eintrag Titel „Nr. 3 · <Zeit>", drei Sekundärangaben, keine Aktion.
 *
 * „Nächste Lagebesprechung" ist der SNAPSHOT beim Abschluss: wurde der Termin damals nicht
 * angefasst, übernahm der Server den geltenden Termin — die Zeile zeigt dann einen, obwohl die
 * Maske keinen geschickt hat (`src/stab/repo.rs:203-214`).
 *
 * Live: das `stab`-Ereignis invalidiert den Prefix, der Sub-Key zieht mit. Neue Einträge
 * erscheinen OBEN (absteigend), unter dem Cursor springt nichts, weil die Liste ganz unten auf
 * der Sektion steht und nur liest.
 */
export default function LagebesprechungHistorie({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const query = useQuery({
    queryKey: einsatzKeys.stabLagebesprechungen(einsatzId),
    queryFn: () => ladeLagebesprechungen(einsatzId),
  });

  // Fehler ≠ leer (LFH-331 · B3).
  if (query.isError && !query.data) {
    return (
      <SeitenFehler
        text="Frühere Lagebesprechungen konnten nicht geladen werden"
        ursache={query.error}
        onWiederholen={() => void query.refetch()}
      />
    );
  }

  return (
    <>
      {query.isError && query.data && (
        <SeitenStandVeraltet onWiederholen={() => void query.refetch()} />
      )}
      <Liste
        dataSource={query.data}
        rowKey={(l) => l.id}
        loading={query.isLoading}
        emptyText="Noch keine Lagebesprechung abgeschlossen"
        renderItem={(l) => (
          <ListenEintrag>
            <ListenEintragMeta
              title={
                <>
                  Nr. {l.lfd_nr} · <ZeitAnzeige wert={l.abgehalten_at} format="kurz" />
                </>
              }
              description={
                <Flex vertical gap={token.marginXXS}>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{l.entschluss}</span>
                  <span>
                    Nächste Lagebesprechung:{' '}
                    {l.naechste_at ? <ZeitAnzeige wert={l.naechste_at} /> : 'kein Termin'}
                  </span>
                  <Link
                    to={etbPfad(einsatzId, { eintrag: l.etb_eintrag_id })}
                    style={stabZeilenzielStil(token)}
                    aria-label={`ETB-Eintrag zu Lagebesprechung Nr. ${l.lfd_nr}`}
                  >
                    ETB-Eintrag
                  </Link>
                </Flex>
              }
            />
          </ListenEintrag>
        )}
      />
    </>
  );
}
