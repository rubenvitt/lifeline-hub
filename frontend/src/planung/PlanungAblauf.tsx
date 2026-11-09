import { useQueryClient } from '@tanstack/react-query';
import {
  aenderePlanungProgrammpunkt,
  legePlanungProgrammpunktAn,
  loeschePlanungProgrammpunkt,
} from '../api/planungen';
import { globalKeys } from '../api/queryKeys';
import type { Planung } from '../api/types';
import { AblaufListe, type AblaufSchreiben } from '../programmpunkt/AblaufPaneel';

/**
 * Reiter „Ablauf“ einer Planung (LLH-1583): das Programm der Veranstaltung, dasselbe Paneel wie in
 * den Einsatzdaten. Die Programmpunkte kommen mit der Planung; nach einem Schreibweg lädt sie neu
 * (live ohnehin über das Org-Ereignis `planung`). Die Übernahme legt sie im Einsatz an, danach ist
 * der Reiter nur lesbar.
 */
export default function PlanungAblauf({
  planung,
  readOnly,
}: {
  planung: Planung;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const id = planung.kopf.id;
  const auffrischen = () => qc.invalidateQueries({ queryKey: globalKeys.planung(id), exact: true });
  const schreiben: AblaufSchreiben = {
    anlegen: (daten) => legePlanungProgrammpunktAn(id, daten).then(auffrischen),
    aendern: (punktId, daten) =>
      aenderePlanungProgrammpunkt(id, punktId, daten).then((p) => {
        void auffrischen();
        return p;
      }),
    loeschen: (punktId) => loeschePlanungProgrammpunkt(id, punktId).then(auffrischen),
  };
  const punkte = planung.programmpunkte;
  return (
    <AblaufListe
      punkte={punkte}
      zustand={punkte.length === 0 ? 'leer' : 'daten'}
      onNeuladen={() => void auffrischen()}
      darfSchreiben={!readOnly}
      schreiben={schreiben}
    />
  );
}
