import { App, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { oeffneEinsatzWieder } from '../../api/einsaetze';
import { ETB_INHALT_MAX } from '../../api/eingabegrenzen';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import { ErfassungsModal } from '../../components/Erfassung';
import { Feld, schriftStil, useRollen } from '../../components/instrument';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import { SOFORT_ODER_NIE } from './EinsatzAbschlussDialog';

/**
 * Dialog „Einsatz wieder öffnen“ (LLH-1814, Spec `einsatz-abschluss`, design.md D6): Pflichtfeld
 * „Grund“, das unverändert ins ETB geht (Grenze wie ein ETB-Inhalt), und der Satz, dass Kopplungen
 * und Maschinenzugänge beendet bleiben (D5). Der Knopf ist nicht rot: das Wiederöffnen beendet
 * nichts. Ablehnungen (422 Frist oder Aufbewahrung, 409 Spiegel) stehen im Dialog, kein Toast.
 * Ohne Netz gesperrt und nie angehalten, wie der Abschluss (`SOFORT_ODER_NIE`): ein angehaltener
 * Grund ginge sonst bei der Rückkehr des Netzes unbemerkt ins ETB.
 */

/** Fester Satz zu dem, was das Wiederöffnen nicht zurückholt (D5). */
export const WIEDEREROEFFNEN_SATZ =
  'Gekoppelte Geräte und Maschinenzugänge bleiben getrennt und werden bei Bedarf neu gekoppelt oder freigegeben.';

interface WiedereroeffnenWerte {
  grund?: string;
}

export default function EinsatzWiedereroeffnenDialog({
  einsatzId,
  onSchliessen,
}: {
  einsatzId: number;
  onSchliessen: () => void;
}) {
  const { rollen } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<WiedereroeffnenWerte>();
  const ohneNetz = useOhneVerbindung();

  const mutation = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (grund: string) => oeffneEinsatzWieder(einsatzId, grund),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      void qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      // Das Wiederöffnen schreibt ins ETB (Grund, Rücknahme der Fristen).
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Einsatz wieder geöffnet');
    },
  });

  return (
    <ErfassungsModal<WiedereroeffnenWerte>
      offen
      titel="Einsatz wieder öffnen"
      form={form}
      initialValues={{ grund: '' }}
      erfassenText="Einsatz wieder öffnen"
      gesperrt={ohneNetz}
      zusammenfassung={ohneNetz ? OHNE_VERBINDUNG_NICHT_AENDERBAR : undefined}
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Nicht wieder geöffnet"
      speicherFehlerFallback="Wiederöffnen fehlgeschlagen"
      onErfassen={async (werte) => {
        await mutation.mutateAsync((werte.grund ?? '').trim());
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <p
        data-lfh="wiedereroeffnen-satz"
        style={{ ...schriftStil('text'), color: rollen.text, marginTop: 0 }}
      >
        {WIEDEREROEFFNEN_SATZ}
      </p>
      <Feld
        label="Grund"
        name="grund"
        rules={[
          { required: true, whitespace: true, message: 'Grund angeben' },
          { max: ETB_INHALT_MAX, message: `Höchstens ${ETB_INHALT_MAX} Zeichen` },
        ]}
      >
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
      </Feld>
    </ErfassungsModal>
  );
}
