import { App, Button, DatePicker, Form, Input, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { legeErinnerungAn } from '../api/erinnerungen';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { ErfassungsModal } from '../components/Erfassung';
import { abstand } from '../theme/tokens';
import type { EtbEintragAnzeige } from '../api/types';

const { TextArea } = Input;

/** Kürzt den ETB-Eintragstext zu einem brauchbaren Erinnerungs-Titel. */
function titelAusEintrag(inhalt: string): string {
  const eineZeile = inhalt.replace(/\s+/g, ' ').trim();
  const kurz = eineZeile.length > 80 ? `${eineZeile.slice(0, 77)}…` : eineZeile;
  return `Wiedervorlage: ${kurz}`;
}

interface FormWerte {
  titel: string;
  faellig: dayjs.Dayjs;
  beschreibung?: string;
}

/**
 * Vorgabe der Fälligkeit (LFH-342 · C7, Befund N22).
 *
 * Der Bestand stand auf `dayjs()` — dem einzigen Wert, den niemand meint: eine
 * Wiedervorlage auf „jetzt" ist im Moment des Anlegens schon fällig. Dreißig Minuten
 * sind die Vorgabe, die Reihe darüber deckt den Rest des üblichen Bandes ab.
 */
const VORGABE_MINUTEN = 30;

/**
 * Schnellwahl der Fälligkeit. Bewusst echte antd-`Button` ohne `size`: so erben sie
 * `controlHeight` aus der Dichte-Staffel (30 / 48 / 72 px). Ein gestyltes
 * `<span onClick>` schuldete stattdessen die zwei Angaben aus LFH-365 samt eigener
 * Dichte-Zusicherung — für etwas, das ein Knopf ohnehin mitbringt.
 *
 * „Nächste Lagebesprechung" aus dem Ticket fehlt mit Absicht: das Frontend kennt keine
 * Quelle für den nächsten Besprechungstermin. Ein Chip, der raten müsste, wäre in einer
 * beweissichernden Anwendung eine falsche Tatsachenbehauptung — der Punkt liegt als
 * eigener Nachzug auf dem Board.
 */
const SCHNELLWAHL = [
  { label: '+15 min', minuten: 15 },
  { label: '+30 min', minuten: 30 },
  { label: '+1 h', minuten: 60 },
  { label: '+2 h', minuten: 120 },
] as const;

/**
 * Legt aus einem ETB-Eintrag eine terminierte Erinnerung/Wiedervorlage an (LFH-106).
 * Hält den Bezug auf den Quell-Eintrag fest (bezug_typ='etb'/bezug_id); die
 * Erinnerungsliste verweist darüber zurück.
 *
 * Läuft seit LFH-342 über `components/Erfassung.tsx` statt über ein handgebautes
 * `<Modal onOk>` + `<Form>`: der Absende-Knopf liegt damit IM Formular, Enter sendet über
 * die eingebaute Übermittlung des Browsers, und zurückgesetzt wird auf allen vier
 * Auswegen. Die Maske wurde für N22 ohnehin angefasst — und die Erfassungs-Norm gilt
 * genau dann (LFH-332 · B4).
 */
export default function WiedervorlageModal({ einsatzId, eintrag, onClose }: {
  einsatzId: number;
  eintrag: EtbEintragAnzeige | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormWerte>();

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) =>
      legeErinnerungAn(einsatzId, {
        titel: werte.titel.trim(),
        faellig_at: werte.faellig.utc().format('YYYY-MM-DD HH:mm:ss'),
        beschreibung: werte.beschreibung?.trim() || undefined,
        bezug_typ: 'etb',
        bezug_id: eintrag!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.erinnerungen(einsatzId) });
      message.success('Wiedervorlage angelegt');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={eintrag !== null}
      titel="Wiedervorlage anlegen"
      form={form}
      erfassenText="Anlegen"
      laeuft={mutation.isPending}
      // `mutateAsync`, nicht `mutate`: bei Ablehnung muss die Zusage brechen, sonst
      // räumt die Hülle die Felder trotz Fehler-Toast (Norm aus LFH-332 · B4).
      onErfassen={(werte) => mutation.mutateAsync(werte)}
      onFertig={onClose}
      onAbbrechen={onClose}
      initialValues={
        eintrag
          ? {
              titel: titelAusEintrag(eintrag.inhalt),
              faellig: dayjs().add(VORGABE_MINUTEN, 'minute'),
            }
          : undefined
      }
    >
      <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel ist erforderlich' }]}>
        <Input />
      </Form.Item>
      <Form.Item label="Fällig am" required style={{ marginBottom: abstand.md }}>
        {/*
          Die Schnellwahl steht ÜBER dem Feld, in demselben `Form.Item`: sie ist eine
          Vorbelegung desselben Wertes, kein eigenes Feld — das Budget bleibt bei drei
          (LFH-19). Der DatePicker darunter trägt weiter den freien Fall.
        */}
        <Space wrap style={{ marginBottom: abstand.sm }}>
          <Typography.Text type="secondary">Fällig in</Typography.Text>
          {SCHNELLWAHL.map((s) => (
            <Button
              key={s.label}
              onClick={() => form.setFieldValue('faellig', dayjs().add(s.minuten, 'minute'))}
            >
              {s.label}
            </Button>
          ))}
        </Space>
        <Form.Item name="faellig" noStyle rules={[{ required: true, message: 'Fälligkeit ist erforderlich' }]}>
          <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
        </Form.Item>
      </Form.Item>
      <Form.Item label="Beschreibung (optional)" name="beschreibung">
        <TextArea rows={2} />
      </Form.Item>
    </ErfassungsModal>
  );
}
