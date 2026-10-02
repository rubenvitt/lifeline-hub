import { App, Form, type UploadFile } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../Erfassung';
import DateiFeld from '../DateiFeld';
import { SpeicherFehler } from '../SpeicherHinweis';
import { ERFASSUNG_ACCEPT } from '../../api/upload';

interface Props {
  /** Kennung des Erfassungsobjekts für den Titel („Schaden S-003“, „Person R-007“). */
  kennung: string;
  /** Legt genau eine Datei ab (die Route des Fachmoduls). */
  ablegen: (datei: File) => Promise<unknown>;
  /** Keys, die nach einer erfolgreichen Ablage neu laden (Anhangliste, ETB). */
  invalidieren: readonly (readonly unknown[])[];
  offen: boolean;
  onSchliessen: () => void;
}

interface AblageFormular {
  datei?: UploadFile[];
}

/**
 * Ablegen-Dialog der Erfassungs-Anhänge (Schaden LFH-21, Person LFH-757) auf der
 * Erfassungs-Hülle. Ein Feld, eine Datei je Ablage — mehrere Fotos über den Serienmodus, jedes mit
 * eigenem ETB-Nachweis (pseudonym: nur Registriernummer und Art).
 *
 * `mutateAsync`: eine Ablehnung (400, 409) lässt die Auswahl stehen, der Grund steht als
 * `SpeicherFehler` im Dialog.
 */
export default function AnhangAblegenModal({
  kennung,
  ablegen,
  invalidieren,
  offen,
  onSchliessen,
}: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AblageFormular>();

  const mutation = useMutation({
    mutationFn: (datei: File) => ablegen(datei),
    onSuccess: () => {
      for (const queryKey of invalidieren) void qc.invalidateQueries({ queryKey });
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
      titel={`Datei ablegen · ${kennung}`}
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
