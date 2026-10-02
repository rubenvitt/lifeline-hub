import type { ReactNode } from 'react';
import { App, Form, Typography, type UploadFile } from 'antd';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ErfassungsModal } from '../Erfassung';
import DateiFeld from '../DateiFeld';
import { SpeicherFehler } from '../SpeicherHinweis';
import { einsatzKeys } from '../../api/queryKeys';
import { ERFASSUNG_ACCEPT } from '../../api/upload';

interface Props {
  einsatzId: number;
  /** „Schaden S-003“, „Tier T-007“, „UHS BHP 50“ — steht im Titel. */
  bezug: string;
  /** Anhangliste des Besitzers; wird nach jeder Ablage neu geladen. */
  queryKey: QueryKey;
  ablegen: (datei: File) => Promise<{ id: number }>;
  /** Gerufen VOR der Invalidierung: die Liste merkt die eigene Ablage vor (LFH-760). */
  onAbgelegt?: (anhang: { id: number }) => void;
  /** Zusatzzeile über dem Dateifeld (UHS: Hinweis auf das Zugriffsprotokoll). */
  hinweis?: ReactNode;
  offen: boolean;
  onSchliessen: () => void;
}

interface AblageFormular {
  datei?: UploadFile[];
}

/**
 * Ablegen-Dialog einer Erfassungs-Ablage auf der Erfassungs-Hülle (LFH-21, LFH-758). Ein Feld,
 * eine Datei je Ablage — mehrere Fotos über den Serienmodus, jedes mit eigenem pseudonymem
 * ETB-Nachweis.
 *
 * `mutateAsync`: eine Ablehnung (400, 409) lässt die Auswahl stehen, der Grund steht als
 * `SpeicherFehler` im Dialog.
 */
export default function ErfassungsAnhangAblegenModal({
  einsatzId,
  bezug,
  queryKey,
  ablegen,
  hinweis,
  offen,
  onSchliessen,
  onAbgelegt,
}: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AblageFormular>();

  const mutation = useMutation({
    mutationFn: (datei: File) => ablegen(datei),
    onSuccess: (anhang) => {
      onAbgelegt?.(anhang);
      void qc.invalidateQueries({ queryKey });
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
      titel={`Datei ablegen · ${bezug}`}
      form={form}
      onErfassen={(werte) => mutation.mutateAsync(werte.datei?.[0]?.originFileObj as File)}
      onFertig={schliessen}
      onAbbrechen={schliessen}
      laeuft={mutation.isPending}
      erfassenText="Ablegen"
      serie
    >
      <SpeicherFehler fehler={mutation.error} titel="Nicht abgelegt" />
      {hinweis && (
        <Typography.Paragraph type="secondary" data-lfh="ablage-hinweis">
          {hinweis}
        </Typography.Paragraph>
      )}
      <DateiFeld accept={ERFASSUNG_ACCEPT} />
    </ErfassungsModal>
  );
}
