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
 * Sichtbare Einträge, der Rest liegt eingeklappt im Expander (Ruling 11). Grund: die Historie
 * steht ÜBER der Sektion „Besetzung S1–S6" (Spec Entscheidung 16) — ohne Grenze schöbe jeder
 * Abschluss die Besetzung nach unten. Ab dem vierten Eintrag ändert ein Live-Abschluss nur noch
 * die Zahl im Expander-Titel, nicht die Höhe über der Besetzung.
 */
const SICHTBAR = 3;

/**
 * Historie der Lagebesprechungen (Spec 10): gelesen, nicht verglichen — also `Liste`, keine
 * Tabelle (LFH-330/B2). Je Eintrag Titel „Nr. 3 · <Zeit>", drei Sekundärangaben, keine Aktion.
 *
 * „Nächste Lagebesprechung" ist der SNAPSHOT beim Abschluss: wurde der Termin damals nicht
 * angefasst, übernahm der Server den geltenden Termin — die Zeile zeigt dann einen, obwohl die
 * Maske keinen geschickt hat (`src/stab/repo.rs:203-214`).
 *
 * Live: das `stab`-Ereignis invalidiert den Prefix, der Sub-Key zieht mit. Neue Einträge
 * erscheinen OBEN (absteigend). Die Liste steht NICHT ganz unten, sondern über der Besetzung;
 * dass darunter nichts springt, trägt die Begrenzung auf {@link SICHTBAR} Einträge plus
 * Inline-Expander (`Collapse`, eingeklappt; sein Inhalt kommt aus derselben Query).
 */
export default function LagebesprechungHistorie({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const query = useQuery({
    queryKey: einsatzKeys.stabLagebesprechungen(einsatzId),
    queryFn: () => ladeLagebesprechungen(einsatzId),
  });

  // Fehler ≠ leer (LFH-331 · B3), entschieden über die LÄNGE, nicht den Wahrheitswert: `[]` ist
  // truthy. Nach einer leeren ersten Antwort stünde „Stand veraltet" sonst über „Noch keine
  // Lagebesprechung abgeschlossen" — eine Aussage über eine Menge, die nach dem gescheiterten
  // Abruf niemand kennt (Muster `pages/MaterialPage.tsx`).
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
