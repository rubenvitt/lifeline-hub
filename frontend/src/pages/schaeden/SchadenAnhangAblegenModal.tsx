import { App, Form, type UploadFile } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../../components/Erfassung';
import DateiFeld from '../../components/DateiFeld';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { legeSchadenAnhangAb, schadenRegistrierAnzeige } from '../../api/einsatzSchaden';
import { einsatzKeys } from '../../api/queryKeys';
import { ERFASSUNG_ACCEPT } from '../../api/upload';

interface Props {
  einsatzId: number;
  schadenId: number;
  registrierNr: number;
  offen: boolean;
  onSchliessen: () => void;
}

interface AblageFormular {
  datei?: UploadFile[];
}

/**
 * Ablegen-Dialog der Schaden-Anhänge auf der Erfassungs-Hülle. Ein Feld, eine Datei je Ablage —
 * mehrere Fotos über den Serienmodus, jedes mit eigenem ETB-Nachweis (pseudonym: nur
 * Registriernummer und Art).
 *
 * `mutateAsync`: eine Ablehnung (400, 409) lässt die Auswahl stehen, der Grund steht als
 * `SpeicherFehler` im Dialog.
 */
export default function SchadenAnhangAblegenModal({
  einsatzId,
  schadenId,
  registrierNr,
  offen,
  onSchliessen,
}: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AblageFormular>();

  const mutation = useMutation({
    mutationFn: (datei: File) => legeSchadenAnhangAb(einsatzId, schadenId, datei),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.schadenAnhaenge(einsatzId, schadenId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Datei abgelegt');
    },
  });

  function schliessen() {
    mutation.reset();
    onSchliessen();
  }

  return (
    <ErfassungsModal<AblageFormular>
      offen={offen}
      titel={`Datei ablegen · Schaden ${schadenRegistrierAnzeige(registrierNr)}`}
      form={form}
      onErfassen={(werte) => mutation.mutateAsync(werte.datei?.[0]?.originFileObj as File)}
      onFertig={schliessen}
      onAbbrechen={schliessen}
      laeuft={mutation.isPending}
      erfassenText="Ablegen"
      serie
    >
      <SpeicherFehler fehler={mutation.error} titel="Nicht abgelegt" />
      <DateiFeld accept={ERFASSUNG_ACCEPT} />
    </ErfassungsModal>
  );
}
