import { App, Button, Flex, Typography } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { fetchSchichtplan, setzeSchichtplanGrenzwerte } from '../../api/schichtplan';
import type { Schichtplan, SchichtplanGrenzwerteBody } from '../../api/types';
import GrenzwerteModal from '../../abloesung/GrenzwerteModal';
import { grenzwertText, rueckgaengigBody, vorgabenBody } from '../../abloesung/grenzwerte';
import { Datenfeld, Datenraster, Formularpaneel, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { zeigeRueckgaengig } from '../../kommunikation/rueckgaengig';

const { Text } = Typography;

/**
 * Paneel „Dienst und Ruhe“ der Sektion Ablösung (LLH-1603, Change
 * `z11srqhq-grenzwerte-bedienstelle`): Höchstdienst und Mindestruhe des Einsatzes. Das ist die
 * einzige Bedienstelle; der Schichtplan nennt die Werte nur.
 *
 * Gelesen wird über den Schichtplan-GET unter dem Key `schichtplan`, denselben wie in der
 * Ablösung (D2). Das Paneel nimmt nur `grenzwerte`. Die Antwort des PATCH ersetzt den Plan im
 * Cache, und die Grenzwerte der Einstufung (Meldebild, Personal) werden neu geholt (D3). Andere
 * Sitzungen erreicht der Wert über die Live-Ereignisse `abloesung`, `einheit` und `personal`, die
 * der Server sendet.
 *
 * „Vorgaben wiederherstellen“ fragt nicht nach und bietet „Rückgängig“ an, wie „Vorgabe entfernen“
 * am Schichtmodell (D5). Rechte und Modulsperre gibt die Sektion vor.
 */

interface EinsatzGrenzwerteProps {
  einsatzId: number;
  darf: boolean;
}

/** `rueckgaengig` markiert den Weg zurück; er bietet selbst kein Rückgängig an. */
interface Setzen {
  body: SchichtplanGrenzwerteBody;
  rueckgaengig?: boolean;
}

export default function EinsatzGrenzwerte({ einsatzId, darf }: EinsatzGrenzwerteProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = useRollen();
  const [offen, setOffen] = useState(false);
  const planKey = einsatzKeys.schichtplan(einsatzId);

  const planQ = useQuery({ queryKey: planKey, queryFn: () => fetchSchichtplan(einsatzId) });

  const uebernimm = (plan: Schichtplan) => {
    qc.setQueryData(planKey, plan);
    for (const modul of ['einheiten', 'personal'] as const) {
      void qc.invalidateQueries({
        queryKey: einsatzKeys.kraefteZeitachseGrenzwerte(einsatzId, modul),
      });
    }
  };

  // Fehler über dem Raster; der Fehler des Dialogs steht im Dialog.
  const wiederherstellen = useMutation({
    mutationFn: ({ body }: Setzen) => setzeSchichtplanGrenzwerte(einsatzId, body),
    onMutate: () => qc.getQueryData<Schichtplan>(planKey)?.grenzwerte,
    onSuccess: (plan, { rueckgaengig }, alt) => {
      uebernimm(plan);
      if (rueckgaengig || !alt) {
        message.success('Dienst und Ruhe gespeichert');
        return;
      }
      zeigeRueckgaengig(message, 'Vorgaben wiederhergestellt', () =>
        wiederherstellen.mutate({ body: rueckgaengigBody(alt), rueckgaengig: true }),
      );
    },
  });
  const aendern = useMutation({
    mutationFn: (body: SchichtplanGrenzwerteBody) => setzeSchichtplanGrenzwerte(einsatzId, body),
    onSuccess: (plan) => {
      uebernimm(plan);
      message.success('Dienst und Ruhe gespeichert');
    },
  });

  const g = planQ.data?.grenzwerte;
  const zuruecksetzen = g ? vorgabenBody(g) : null;
  const laeuft = aendern.isPending || wiederherstellen.isPending;

  return (
    <>
      <Formularpaneel
        titel="Dienst und Ruhe"
        dataUpdatedAt={planQ.dataUpdatedAt}
        aktion={
          darf && g ? (
            <Button
              disabled={laeuft}
              onClick={() => {
                aendern.reset();
                setOffen(true);
              }}
            >
              Werte ändern
            </Button>
          ) : undefined
        }
      >
        {wiederherstellen.error != null && (
          <div style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler
              fehler={wiederherstellen.error}
              titel="Dienst und Ruhe nicht geändert"
            />
          </div>
        )}
        {g ? (
          <Datenraster beschriftung="Dienst und Ruhe">
            <Datenfeld label="Höchstdienst" mono>
              {grenzwertText(g.max_dienst_minuten, g.max_dienst_eigen)}
            </Datenfeld>
            <Datenfeld label="Mindestruhe" mono>
              {grenzwertText(g.min_ruhe_minuten, g.min_ruhe_eigen)}
            </Datenfeld>
          </Datenraster>
        ) : (
          <Flex align="center" gap={token.marginSM} style={{ padding: token.paddingSM }}>
            <Text type="secondary">
              {planQ.isError ? 'Dienst und Ruhe nicht ladbar' : 'Dienst und Ruhe werden geladen'}
            </Text>
            {planQ.isError && <Button onClick={() => void planQ.refetch()}>Erneut abrufen</Button>}
          </Flex>
        )}
        {darf && zuruecksetzen && (
          <Flex justify="flex-end" style={{ marginBlockStart: token.margin }}>
            <Button
              disabled={laeuft}
              loading={wiederherstellen.isPending}
              onClick={() => wiederherstellen.mutate({ body: zuruecksetzen })}
            >
              Vorgaben wiederherstellen
            </Button>
          </Flex>
        )}
      </Formularpaneel>

      {offen && g && (
        <GrenzwerteModal
          grenzwerte={g}
          speicherung={aendern}
          onSpeichern={(body) => aendern.mutateAsync(body)}
          onSchliessen={() => setOffen(false)}
        />
      )}
    </>
  );
}
