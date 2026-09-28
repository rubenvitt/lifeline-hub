import { Collapse, Flex, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { einsatzKeys } from '../api/queryKeys';
import { ladeLagebesprechungen } from '../api/stab';
import type { Lagebesprechung } from '../api/types';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import { etbPfad } from '../routing/deeplinks';
import { stabZeilenzielStil } from './zeilenziel';

/**
 * Sichtbare Einträge, der Rest liegt eingeklappt im Expander: die Historie steht ÜBER der
 * Besetzung, ohne Grenze schöbe jeder Abschluss sie nach unten.
 */
const SICHTBAR = 3;

/**
 * Historie der Lagebesprechungen: gelesen, nicht verglichen — also `Liste`. Je Eintrag Titel
 * „Nr. 3 · <Zeit>", drei Sekundärangaben, keine Aktion.
 *
 * „Nächste Lagebesprechung" ist der SNAPSHOT beim Abschluss: wurde der Termin nicht angefasst,
 * übernahm der Server den geltenden (`src/stab/repo.rs`).
 * Neue Einträge erscheinen OBEN; dass darunter nichts springt, trägt die Begrenzung auf
 * {@link SICHTBAR} Einträge plus eingeklappten Expander (aus derselben Query).
 */
export default function LagebesprechungHistorie({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const query = useQuery({
    queryKey: einsatzKeys.stabLagebesprechungen(einsatzId),
    queryFn: () => ladeLagebesprechungen(einsatzId),
  });

  // Fehler ≠ leer, entschieden über die LÄNGE, nicht den Wahrheitswert: `[]` ist truthy, und
  // „Stand veraltet" über „Noch keine Lagebesprechung abgeschlossen" wäre eine Aussage über eine
  // unbekannte Menge.
  const anzahl = query.data?.length ?? 0;
  const gescheitert = query.isError && anzahl === 0;
  const standVeraltet = query.isError && anzahl > 0;

  if (gescheitert) {
    return (
      <SeitenFehler
        text="Frühere Lagebesprechungen konnten nicht geladen werden"
        ursache={query.error}
        onWiederholen={() => void query.refetch()}
      />
    );
  }

  const eintrag = (l: Lagebesprechung) => (
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
  );
  const frueher = query.data?.slice(SICHTBAR) ?? [];

  return (
    <>
      {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void query.refetch()} />}
      <Liste
        dataSource={query.data?.slice(0, SICHTBAR)}
        rowKey={(l) => l.id}
        loading={query.isLoading}
        emptyText="Noch keine Lagebesprechung abgeschlossen"
        renderItem={eintrag}
      />
      {frueher.length > 0 && (
        <Collapse
          ghost
          items={[
            {
              key: 'frueher',
              label: `Frühere Lagebesprechungen (${frueher.length})`,
              children: <Liste dataSource={frueher} rowKey={(l) => l.id} renderItem={eintrag} />,
            },
          ]}
        />
      )}
    </>
  );
}
