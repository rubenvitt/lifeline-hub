import { Button, Flex, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { fetchLagebesprechungen } from '../api/lagebesprechung';
import { einsatzKeys } from '../api/queryKeys';
import type { Lagebesprechung } from '../api/types';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import { etbPfad } from '../routing/deeplinks';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { kuerzeEntschluss } from './lagebesprechungAbschluss';

/** Ab dieser Länge steht der Entschluss gekürzt da, mit „ganz zeigen“. */
const ENTSCHLUSS_KURZ = 160;

/** Entschluss gekürzt, mit Umschalter auf den vollen Wortlaut (Spec `lagebesprechung`, Verlauf). */
function Entschluss({ text, nr }: { text: string; nr: number }) {
  const [ganz, setGanz] = useState(false);
  const kurz = kuerzeEntschluss(text, ENTSCHLUSS_KURZ);
  const gekuerzt = kurz !== text.replace(/\s+/g, ' ').trim();
  return (
    <Flex vertical align="start">
      <span style={{ whiteSpace: ganz ? 'pre-wrap' : undefined }}>{ganz ? text : kurz}</span>
      {gekuerzt && (
        <Button
          type="link"
          aria-expanded={ganz}
          aria-label={`Entschluss von Lagebesprechung Nr. ${nr} ${ganz ? 'kürzen' : 'ganz zeigen'}`}
          onClick={() => setGanz((g) => !g)}
          style={{ paddingInline: 0 }}
        >
          {ganz ? 'kürzen' : 'ganz zeigen'}
        </Button>
      )}
    </Flex>
  );
}

/**
 * Verlauf der Lagebesprechungen (LLH-1111): alle, neueste zuerst. Gelesen, nicht verglichen —
 * also `Liste`. Je Eintrag Titel „Nr. 3 · <Zeit>“, Entschluss (gekürzt, ganz abrufbar), der beim
 * Abschluss gesetzte Termin und der ETB-Sprung.
 *
 * „Nächste Lagebesprechung“ ist der SNAPSHOT beim Abschluss: wurde der Termin nicht angefasst,
 * übernahm der Server den geltenden (`src/lagebesprechung/repo.rs`). Auf der Stab-Seite stand der
 * Verlauf über der Besetzung und war deshalb auf drei Einträge begrenzt; hier gehört die Seite
 * ihm, die Begrenzung fällt (design.md D7).
 */
export default function LagebesprechungHistorie({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const query = useQuery({
    queryKey: einsatzKeys.lagebesprechungen(einsatzId),
    queryFn: () => fetchLagebesprechungen(einsatzId),
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
        text="Verlauf der Lagebesprechungen konnte nicht geladen werden"
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
            <Entschluss text={l.entschluss} nr={l.lfd_nr} />
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

  return (
    <>
      {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void query.refetch()} />}
      {/* Einbauort ist das Paneel „Verlauf“ (h2): jede Lagebesprechung ein Gegenstand mit
          Entschluss und Termin darunter, ihr Titel h3 (LFH-826). */}
      <Liste
        unterEbene={2}
        dataSource={query.data}
        rowKey={(l) => l.id}
        loading={query.isLoading}
        emptyText="Noch keine Lagebesprechung abgeschlossen"
        renderItem={eintrag}
      />
    </>
  );
}
