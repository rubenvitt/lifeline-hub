import { Alert, App, Button, DatePicker, Form, InputNumber } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeVorhersage, pegelSchreibScope, setzePrognose } from '../../api/pegel';
import { einsatzKeys } from '../../api/queryKeys';
import type { PegelAnzeige } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { ErfassungsModal } from '../../components/Erfassung';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useRollen } from '../../components/instrument';
import {
  prognoseBody,
  prognoseVorbelegung,
  vorhersageAlsWerte,
  vorhersageSatz,
  type PrognoseFormWerte,
} from './pegelPrognoseKern';

const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

interface PegelPrognoseModalProps {
  einsatzId: number;
  /** Der Pegel, dessen Prognose gepflegt wird — Stand beim Öffnen. */
  pegel: PegelAnzeige;
  onSchliessen: () => void;
}

/**
 * Erwarteten Höchststand an einem maßgeblichen Pegel erfassen oder ändern (LFH-628).
 *
 * Zwei Felder (Modal-Budget LFH-19): Höchststand in Metern und Zeitpunkt. Montiert = offen
 * (Muster `LagebesprechungModal`): die Vorbelegung friert beim Öffnen ein, jede Öffnung hat
 * eine frische Mutation ohne alten Fehler.
 *
 * ── VORSCHLAG AUS DER REIHE `WV` ───────────────────────────────────────────────────
 * Führt die Station eine PEGELONLINE-Vorhersage (gemessen: 43 Stationen), steht ihr
 * höchster künftiger Wert als Hinweis über den Feldern, mit „Übernehmen". Er wird NICHT
 * still eingesetzt: die Prognose ist eine Angabe des Stabs, und die Vorhersagezentrale eines
 * Landes kann eine andere Zahl nennen als die BfG — übernommen wird ausdrücklich. Ohne Reihe
 * steht ein Satz, der das sagt; ist die Quelle nicht erreichbar, ebenso — der Dialog bleibt
 * in beiden Fällen voll bedienbar. Kein Wiederholen (`retry: false`): ein 502 dreimal
 * nachzufragen hielte den Hinweis nur länger auf „wird abgerufen".
 *
 * Fehler des PUT stehen IM Dialog (`SpeicherFehler`, H14), die Hülle lässt die Felder stehen.
 */
export default function PegelPrognoseModal({
  einsatzId,
  pegel,
  onSchliessen,
}: PegelPrognoseModalProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [form] = Form.useForm<PrognoseFormWerte>();
  const [vorbelegung] = useState(() => prognoseVorbelegung(pegel.prognose));
  const [jetzt] = useState(() => Date.now());

  const vorhersageQ = useQuery({
    queryKey: einsatzKeys.pegelVorhersage(einsatzId, pegel.id),
    queryFn: () => ladeVorhersage(einsatzId, pegel.id),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const speichern = useMutation({
    scope: pegelSchreibScope(einsatzId),
    mutationFn: (werte: PrognoseFormWerte) => {
      const body = prognoseBody(werte);
      if (!body) throw new Error('Höchststand und Zeitpunkt angeben');
      return setzePrognose(einsatzId, pegel.id, body);
    },
    onSuccess: (liste) => {
      qc.setQueryData(einsatzKeys.pegel(einsatzId), liste);
      message.success('Prognose gespeichert');
    },
  });

  const vorhersage = vorhersageQ.data?.vorhersage;
  const hinweis = vorhersageQ.isLoading ? (
    <Alert type="info" title="PEGELONLINE-Vorhersage wird abgerufen …" />
  ) : vorhersageQ.isError ? (
    <Alert
      type="warning"
      showIcon
      title="Die PEGELONLINE-Vorhersage ist gerade nicht erreichbar — bitte von Hand erfassen."
    />
  ) : vorhersage ? (
    <Alert
      type="info"
      showIcon
      data-lfh="pegel-vorhersage"
      title={vorhersageSatz(vorhersage, jetzt, konv)}
      action={
        <Button onClick={() => form.setFieldsValue(vorhersageAlsWerte(vorhersage))}>
          Übernehmen
        </Button>
      }
    />
  ) : (
    <Alert
      type="info"
      data-lfh="pegel-keine-vorhersage"
      title="Für diese Station liefert PEGELONLINE keine Vorhersage."
    />
  );

  return (
    <ErfassungsModal<PrognoseFormWerte>
      offen
      titel={`Prognose — ${pegel.name}`}
      form={form}
      initialValues={vorbelegung}
      erfassenText="Speichern"
      laeuft={speichern.isPending}
      onErfassen={(werte) => speichern.mutateAsync(werte)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <div style={{ marginBlockEnd: token.margin }}>{hinweis}</div>
      <Form.Item
        label="Erwarteter Höchststand (m)"
        name="hoechststand_m"
        rules={[{ required: true, message: 'Höchststand angeben' }]}
      >
        <InputNumber
          min={-10}
          max={50}
          step={0.01}
          precision={2}
          decimalSeparator=","
          style={{ width: '100%' }}
          placeholder="z. B. 7,10"
        />
      </Form.Item>
      <Form.Item
        label="Zeitpunkt"
        name="zeitpunkt"
        rules={[{ required: true, message: 'Zeitpunkt angeben' }]}
      >
        <DatePicker showTime format={ZEITFORMAT} style={{ width: '100%' }} />
      </Form.Item>
      <SpeicherFehler fehler={speichern.error} titel="Prognose nicht gespeichert" />
    </ErfassungsModal>
  );
}
