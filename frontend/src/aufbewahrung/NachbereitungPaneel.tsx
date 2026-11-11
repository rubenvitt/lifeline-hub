import { App, Button, Flex, Form, Switch, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { setzeNachbereitung } from '../api/aufbewahrung';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzAnzeige, NachbereitungSetzenBody } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { useAuth } from '../auth/AuthContext';
import { ErfassungsModal } from '../components/Erfassung';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { Datenfeld, Datenraster, Paneel } from '../components/instrument';
import { darfFristSetzen, fristSperrGrund, liegtInDerVergangenheit } from './fristModell';

/**
 * Paneel „Nachbereitung" der Einsatz-Einstellungen (LLH-1494, design.md D8), ab dem Abschluss.
 *
 * Bis zum Ende der Nachbereitung bleibt ein abgeschlossener Einsatz an dieser Instanz; danach
 * übergibt eine meldende Instanz ihn der verwahrenden. Wartet die Gegenstelle noch (Stand,
 * Anhänge), steht ihr Grund aus der letzten Quittung hier.
 *
 * Wie die Aufbewahrungsfrist außerhalb des Vollersatz-`<Form>` der Einstellungen: der PUT trägt
 * nur den Zeitpunkt. Rechte wie die Frist (Einsatzleitung oder System-Admin der Einsatz-Org, nie
 * am Spiegel). Ändern und Aufheben sind umkehrbar und fragen nicht zurück.
 */

type NachbereitungEinsatz = Pick<
  EinsatzAnzeige,
  'status' | 'meine_rolle' | 'org_id' | 'spiegel' | 'nachbereitung_bis' | 'verwahrung'
>;

interface FormWerte {
  bis?: Dayjs | null;
  /** „Ohne Nachbereitung": hebt die Frist auf, statt einen Zeitpunkt zu setzen. */
  ohne?: boolean;
}

interface Props {
  einsatzId: number;
  einsatz: NachbereitungEinsatz;
}

export default function NachbereitungPaneel({ einsatzId, einsatz }: Props) {
  const { token } = theme.useToken();
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [offen, setOffen] = useState(false);
  const darf = darfFristSetzen(einsatz, benutzer);
  const bis = einsatz.nachbereitung_bis ?? null;

  const mutation = useMutation({
    mutationFn: (body: NachbereitungSetzenBody) => setzeNachbereitung(einsatzId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      void qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success('Nachbereitung gespeichert');
    },
  });

  // Vorbelegen beim Öffnen (wie `FristPaneel`): rc-field-form behielte sonst den Wert der
  // vorigen Öffnung.
  useEffect(() => {
    if (offen) form.setFieldsValue({ bis: alsZeitpunkt(bis) ?? null, ohne: false });
  }, [offen, bis, form]);
  const ohne = Form.useWatch('ohne', form) === true;

  const schliessen = () => {
    mutation.reset();
    setOffen(false);
  };

  const wartet = einsatz.verwahrung != null && bis != null && liegtInDerVergangenheit(bis, dayjs());

  return (
    <Paneel titel="Nachbereitung" koerperPolster style={{ marginBottom: token.marginLG }}>
      <Flex vertical gap={token.marginSM}>
        <RechteHinweis sichtbar={!darf} text={fristSperrGrund(einsatz)} />
        <SpeicherFehler fehler={offen ? null : mutation.error} />
        <Datenraster spalten={1} beschriftung="Nachbereitung">
          <Datenfeld label="Ende" mono={bis != null}>
            {bis ? <ZeitAnzeige wert={bis} /> : 'Keine Nachbereitungsfrist'}
          </Datenfeld>
          {wartet && einsatz.verwahrung && (
            <Datenfeld label="Verwahrung">
              {`Wartet auf ${einsatz.verwahrung.gegenstelle}`}
              {einsatz.verwahrung.grund && ` · ${einsatz.verwahrung.grund}`}
            </Datenfeld>
          )}
        </Datenraster>
        <Flex gap={token.marginSM} wrap>
          <Button
            disabled={!darf}
            onClick={() => {
              mutation.reset();
              setOffen(true);
            }}
          >
            Nachbereitung ändern
          </Button>
        </Flex>
      </Flex>
      <ErfassungsModal<FormWerte>
        offen={offen}
        titel="Nachbereitung ändern"
        form={form}
        initialValues={{ bis: alsZeitpunkt(bis) ?? null, ohne: false }}
        erfassenText={ohne ? 'Frist aufheben' : 'Frist setzen'}
        laeuft={mutation.isPending}
        onErfassen={async (werte) => {
          if (werte.ohne) {
            await mutation.mutateAsync({ nachbereitung_bis: null });
            return;
          }
          if (!werte.bis) throw new Error('keine Frist');
          await mutation.mutateAsync({ nachbereitung_bis: alsBackendZeit(werte.bis) });
        }}
        onFertig={schliessen}
        onAbbrechen={schliessen}
      >
        <Form.Item
          label="Ende der Nachbereitung"
          name="bis"
          rules={[{ required: !ohne, message: 'Zeitpunkt wählen' }]}
          dependencies={['ohne']}
        >
          <ZeitpunktEingabe art="frist" disabled={ohne} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Ohne Nachbereitung" name="ohne" valuePropName="checked">
          <Switch />
        </Form.Item>
        <SpeicherFehler fehler={offen ? mutation.error : null} />
      </ErfassungsModal>
    </Paneel>
  );
}
