import { Form, Input, theme } from 'antd';
import type { Dayjs } from 'dayjs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { PLANUNG_BEZEICHNUNG_MAX, PLANUNG_ORT_MAX } from '../api/eingabegrenzen';
import { legePlanungAn } from '../api/planungen';
import { globalKeys } from '../api/queryKeys';
import type { Einsatzart, PlanungBody } from '../api/types';
import { ZeitraumEingabe, type Zeitraum } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { mitVorgabe } from '../components/vorgabeText';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import { planungPfad } from '../routing/deeplinks';
import { zeitraumRegel } from './planungRegeln';

interface Werte {
  bezeichnung: string;
  einsatzart?: Einsatzart;
  ort?: string;
  zeitraum: Zeitraum | null;
}

/** Ohne Wahl legt der Server einen Sanitätsdienst an. */
const VORGABE_ART: Einsatzart = 'sanitaetsdienst';

/**
 * „Planung anlegen“ (LLH-1586): Bezeichnung, Einsatzart und Ort, Zeitraum. Die Grenzwerte stehen
 * danach im Kopf der Planung (Vorgabe 12 h / 8 h). Nach dem Anlegen öffnet die neue Planung.
 */
export default function PlanungAnlegenDialog({
  offen,
  onClose,
}: {
  offen: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<Werte>();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (w: Werte) => {
      const [von, bis] = w.zeitraum as [Dayjs, Dayjs];
      const body: PlanungBody = {
        bezeichnung: w.bezeichnung.trim(),
        von: alsBackendZeit(von),
        bis: alsBackendZeit(bis),
      };
      if (w.einsatzart) body.einsatzart = w.einsatzart;
      const ort = w.ort?.trim();
      if (ort) body.ort = ort;
      return legePlanungAn(body);
    },
    onSuccess: (p) => {
      qc.setQueryData(globalKeys.planung(p.kopf.id), p);
      void qc.invalidateQueries({ queryKey: globalKeys.planungen(), exact: true });
    },
  });

  return (
    <ErfassungsModal<Werte>
      offen={offen}
      titel="Planung anlegen"
      form={form}
      erfassenText="Planung anlegen"
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Planung nicht angelegt"
      initialValues={{ zeitraum: null }}
      onErfassen={async (w) => {
        const p = await mutation.mutateAsync(w);
        void navigate(planungPfad(p.kopf.id));
      }}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item<Werte>
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. Stadtfest 2027" maxLength={PLANUNG_BEZEICHNUNG_MAX} />
      </Form.Item>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          columnGap: token.marginSM,
        }}
      >
        <Form.Item<Werte> label="Einsatzart" name="einsatzart">
          <Select<Einsatzart>
            aria-label="Einsatzart"
            allowClear
            placeholder={mitVorgabe(EINSATZART_LABELS[VORGABE_ART])}
            options={EINSATZART_OPTIONEN}
          />
        </Form.Item>
        <Form.Item<Werte> label="Ort" name="ort">
          <Input maxLength={PLANUNG_ORT_MAX} />
        </Form.Item>
      </div>
      <Form.Item<Werte> label="Zeitraum" name="zeitraum" required rules={[zeitraumRegel]}>
        <ZeitraumEingabe art="frist" />
      </Form.Item>
    </ErfassungsModal>
  );
}
