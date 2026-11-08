import { App, Button, Flex, Typography } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { fetchSchichtplan, setzeSchichtplanGrenzwerte } from '../../api/schichtplan';
import type { Schichtplan, SchichtplanGrenzwerteBody } from '../../api/types';
import GrenzwerteModal from '../../abloesung/GrenzwerteModal';
import { grenzwertText, rueckgaengigBody, vorgabenBody } from '../../abloesung/grenzwerte';
import { Datenfeld, Datenraster, Formularpaneel, useRollen } from '../../components/instrument';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
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
  canWrite: boolean;
}

/** `isRueckgaengig` markiert den Weg zurück; er bietet selbst kein Rückgängig an. */
interface ResetVariables {
  body: SchichtplanGrenzwerteBody;
  isRueckgaengig?: boolean;
}

export default function EinsatzGrenzwerte({ einsatzId, canWrite }: EinsatzGrenzwerteProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = useRollen();
  const [isOpen, setIsOpen] = useState(false);
  const planKey = einsatzKeys.schichtplan(einsatzId);

  const planQ = useQuery({ queryKey: planKey, queryFn: () => fetchSchichtplan(einsatzId) });

  const applyPlan = (plan: Schichtplan) => {
    qc.setQueryData(planKey, plan);
    // Einstufung in Meldebild und Personalliste (LLH-730) liest eigene Keys.
    void qc.invalidateQueries({
      queryKey: einsatzKeys.kraefteZeitachseGrenzwerte(einsatzId, 'einheiten'),
    });
    void qc.invalidateQueries({
      queryKey: einsatzKeys.kraefteZeitachseGrenzwerte(einsatzId, 'personal'),
    });
  };

  // Fehler über dem Paneel (`SeitenHinweise`, auch für Rückgängig aus dem Toast); der Fehler des
  // Dialogs steht im Dialog.
  const reset = useMutation({
    mutationFn: ({ body }: ResetVariables) => setzeSchichtplanGrenzwerte(einsatzId, body),
    onMutate: () => qc.getQueryData<Schichtplan>(planKey)?.grenzwerte,
    onSuccess: (plan, { isRueckgaengig }, alt) => {
      applyPlan(plan);
      if (isRueckgaengig || !alt) {
        message.success('Dienst und Ruhe gespeichert');
        return;
      }
      zeigeRueckgaengig(message, 'Vorgaben wiederhergestellt', () =>
        reset.mutate({ body: rueckgaengigBody(alt), isRueckgaengig: true }),
      );
    },
  });
  const update = useMutation({
    mutationFn: (body: SchichtplanGrenzwerteBody) => setzeSchichtplanGrenzwerte(einsatzId, body),
    onSuccess: (plan) => {
      applyPlan(plan);
      message.success('Dienst und Ruhe gespeichert');
    },
  });

  const g = planQ.data?.grenzwerte;
  const resetBody = g ? vorgabenBody(g) : null;
  const isPending = update.isPending || reset.isPending;

  return (
    <>
      <SeitenHinweise fehler={reset.error} fehlerTitel="Dienst und Ruhe nicht geändert" />
      <Formularpaneel
        titel="Dienst und Ruhe"
        dataUpdatedAt={planQ.dataUpdatedAt}
        aktion={
          canWrite && g ? (
            <Button
              disabled={isPending}
              onClick={() => {
                update.reset();
                setIsOpen(true);
              }}
            >
              Werte ändern
            </Button>
          ) : undefined
        }
      >
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
        {canWrite && resetBody && (
          <Flex justify="flex-end" style={{ marginBlockStart: token.margin }}>
            <Button
              disabled={isPending}
              loading={reset.isPending}
              onClick={() => reset.mutate({ body: resetBody })}
            >
              Vorgaben wiederherstellen
            </Button>
          </Flex>
        )}
      </Formularpaneel>

      {isOpen && g && (
        <GrenzwerteModal
          grenzwerte={g}
          speicherung={update}
          onSpeichern={(body) => update.mutateAsync(body)}
          onSchliessen={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
