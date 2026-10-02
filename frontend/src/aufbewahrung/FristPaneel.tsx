import { App, Button, Flex, Form, Modal, Typography, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState, type ReactNode } from 'react';
import { setzeAufbewahrungsfrist } from '../api/aufbewahrung';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzAnzeige, FristSetzenBody } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { useAuth } from '../auth/AuthContext';
import { ErfassungsModal } from '../components/Erfassung';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { Datenfeld, Datenraster, Paneel } from '../components/instrument';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import {
  darfFristSetzen,
  fristAusEingabe,
  istFristverkuerzung,
  liegtInDerVergangenheit,
} from './fristModell';

/**
 * Aufbewahrungsfrist am Einsatz anzeigen und ändern.
 *
 * Die Frist gehört NICHT zu den eingefrorenen Einstellungen: sie wird auch nach dem Abschluss
 * über `PUT …/aufbewahrungsfrist` gesetzt. Deshalb steht das Paneel ÜBER und AUSSERHALB des
 * Vollersatz-`<Form>` der Einstellungen.
 *
 * **Umkehrbarkeit entscheidet die Rückfrage:** Verlängern und Aufheben fragen nicht. Eine
 * Verkürzung (auch das erstmalige Setzen) verlegt die Sperre vor; vor ihr steht eine
 * `danger`-Rückfrage mit altem und neuem Zeitpunkt, erst dann geht `bestaetigt: true` hinaus.
 * Die 409 des Servers bleibt Sicherheitsnetz.
 *
 * **Fehler dort, wo die Person steht:** im Dialog, solange er offen ist, sonst am Paneel. Kein
 * Fehler-Toast; der Erfolg quittiert per Toast.
 */

type FristEinsatz = Pick<EinsatzAnzeige, 'status' | 'meine_rolle' | 'retention_bis' | 'org_id'>;

interface FristFormWerte {
  frist?: Dayjs | null;
}

interface Rueckfrage {
  neu: string;
  bestaetigen: () => void;
  abbrechen: () => void;
}

/** Text des Rechte-Hinweises — eine Stelle für Paneel und Akte. */
const FRIST_RECHTE_TEXT =
  'Nur die Einsatzleitung oder ein System-Admin der Organisation des Einsatzes darf die Aufbewahrungsfrist ändern — die Frist steht hier zum Nachlesen.';

interface FristAenderung {
  /** Öffnet den Dialog „Frist ändern". */
  oeffnen: () => void;
  /** Hebt die Frist ohne Rückfrage auf (umkehrbar). */
  aufheben: () => void;
  laeuft: boolean;
  /** Fehler des letzten Versuchs, solange KEIN Dialog offen ist (sonst steht er dort). */
  fehlerAussen: unknown;
  /** Dialog und Rückfrage — der Aufrufer rendert das Element einmal. */
  dialoge: ReactNode;
}

/**
 * Mutation, Dialog und Rückfrage der Friständerung als Hook — das Paneel der Einstellungen
 * trägt die Knöpfe selbst, die Archivakte stellt „Frist ändern" in ihren Kopf-Slot.
 */
export function useFristAenderung(
  einsatzId: number,
  alt: string | null | undefined,
): FristAenderung {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FristFormWerte>();
  const [offen, setOffen] = useState(false);
  const [rueckfrage, setRueckfrage] = useState<Rueckfrage | null>(null);
  // Die Vergleichsbasis wird beim ÖFFNEN eingefroren: ein Refetch verschöbe sonst still, was
  // als Verkürzung gilt.
  const [basis, setBasis] = useState<string | null | undefined>(alt);

  const mutation = useMutation({
    mutationFn: (body: FristSetzenBody) => setzeAufbewahrungsfrist(einsatzId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: globalKeys.aufbewahrung() });
      void qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Aufbewahrungsfrist gespeichert');
    },
  });

  const oeffnen = () => {
    mutation.reset();
    setBasis(alt);
    setOffen(true);
  };
  const schliessen = () => {
    // Ein Fehler, den der Dialog schon gezeigt hat, soll nach dem Schließen nicht noch
    // einmal am Paneel auftauchen.
    mutation.reset();
    setOffen(false);
  };

  // Vorbelegen per `setFieldsValue` beim Öffnen, nicht über `initialValues`: rc-field-form
  // behält seinen Speicher über das Abhängen des Dialogs hinweg, und der Wert der VORIGEN
  // Öffnung nähme eine inzwischen bestätigte Verkürzung still zurück.
  useEffect(() => {
    if (offen) form.setFieldsValue({ frist: alsZeitpunkt(basis) ?? null });
  }, [offen, basis, form]);

  /** Fragt bei einer Verkürzung zurück; bei Abbruch lehnt die Zusage ab, die Hülle lässt die
      Felder stehen und sendet nichts. */
  const bestaetigt = (neu: string) =>
    new Promise<boolean>((resolve, reject) => {
      if (!istFristverkuerzung(basis, neu)) {
        resolve(false);
        return;
      }
      setRueckfrage({
        neu,
        bestaetigen: () => {
          setRueckfrage(null);
          resolve(true);
        },
        abbrechen: () => {
          setRueckfrage(null);
          reject(new Error('abgebrochen'));
        },
      });
    });

  const dialoge = (
    <>
      <ErfassungsModal<FristFormWerte>
        offen={offen}
        titel="Aufbewahrungsfrist ändern"
        form={form}
        initialValues={{ frist: alsZeitpunkt(basis) ?? null }}
        erfassenText="Frist setzen"
        laeuft={mutation.isPending}
        onErfassen={async (werte) => {
          if (!werte.frist) throw new Error('keine Frist');
          const neu = fristAusEingabe(alsBackendZeit(werte.frist), basis);
          const mitBestaetigung = await bestaetigt(neu);
          await mutation.mutateAsync(
            mitBestaetigung ? { retention_bis: neu, bestaetigt: true } : { retention_bis: neu },
          );
        }}
        onFertig={schliessen}
        onAbbrechen={schliessen}
      >
        <Form.Item
          label="Neue Aufbewahrungsfrist"
          name="frist"
          rules={[{ required: true, message: 'Zeitpunkt wählen' }]}
          extra="Ab diesem Zeitpunkt ist der abgeschlossene Einsatz für alle gesperrt und wird zur Löschung vorgemerkt."
        >
          <ZeitpunktEingabe format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <SpeicherFehler fehler={offen ? mutation.error : null} />
      </ErfassungsModal>
      <Modal
        open={rueckfrage != null}
        title="Aufbewahrungsfrist verkürzen?"
        okText="Verkürzen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        onOk={() => rueckfrage?.bestaetigen()}
        onCancel={() => rueckfrage?.abbrechen()}
        destroyOnHidden
      >
        {rueckfrage && (
          <Typography.Paragraph>
            Die Frist wird von{' '}
            <strong>{basis ? <ZeitAnzeige wert={basis} /> : 'unbegrenzt'}</strong> auf{' '}
            <strong>
              <ZeitAnzeige wert={rueckfrage.neu} />
            </strong>{' '}
            vorverlegt.{' '}
            {liegtInDerVergangenheit(rueckfrage.neu, dayjs())
              ? 'Der Zeitpunkt liegt in der Vergangenheit — ein abgeschlossener Einsatz ist damit sofort für alle gesperrt, auch für Sie, und wird mit dem nächsten Purge-Lauf zur Löschung vorgemerkt.'
              : 'Ab dann ist der abgeschlossene Einsatz für alle gesperrt und wird zur Löschung vorgemerkt.'}
          </Typography.Paragraph>
        )}
      </Modal>
    </>
  );

  return {
    oeffnen,
    aufheben: () => mutation.mutate({ retention_bis: null }),
    laeuft: mutation.isPending,
    fehlerAussen: offen ? null : mutation.error,
    dialoge,
  };
}

/** Anzeige der Frist: Zeitpunkt, „keine Frist" oder der Hinweis am laufenden Einsatz. */
export function FristWert({
  einsatz,
}: {
  einsatz: Pick<EinsatzAnzeige, 'status' | 'retention_bis'>;
}) {
  if (einsatz.retention_bis) return <ZeitAnzeige wert={einsatz.retention_bis} />;
  if (einsatz.status === 'aktiv') {
    return <>keine Frist — sie entsteht beim Abschluss aus der Aufbewahrungs-Dauer</>;
  }
  return <>keine Frist</>;
}

interface FristPaneelProps {
  einsatzId: number;
  einsatz: FristEinsatz;
}

/** Paneel „Aufbewahrungsfrist" der Einsatz-Einstellungen. */
export default function FristPaneel({ einsatzId, einsatz }: FristPaneelProps) {
  const { token } = theme.useToken();
  const { benutzer } = useAuth();
  const darf = darfFristSetzen(einsatz, benutzer);
  const aenderung = useFristAenderung(einsatzId, einsatz.retention_bis);

  return (
    <Paneel titel="Aufbewahrungsfrist" koerperPolster style={{ marginBottom: token.marginLG }}>
      <Flex vertical gap={token.marginSM}>
        <RechteHinweis sichtbar={!darf} text={FRIST_RECHTE_TEXT} />
        <SpeicherFehler fehler={aenderung.fehlerAussen} />
        <Datenraster spalten={1} beschriftung="Aufbewahrungsfrist">
          <Datenfeld label="Frist" mono={einsatz.retention_bis != null}>
            <FristWert einsatz={einsatz} />
          </Datenfeld>
        </Datenraster>
        {einsatz.status === 'aktiv' && einsatz.retention_bis && (
          <Typography.Text type="secondary">
            Die Frist greift erst nach dem Abschluss — einen laufenden Einsatz sperrt sie nie.
          </Typography.Text>
        )}
        <Flex gap={token.marginSM} wrap>
          <Button disabled={!darf} onClick={aenderung.oeffnen}>
            Frist ändern
          </Button>
          {einsatz.retention_bis && (
            <Button disabled={!darf || aenderung.laeuft} onClick={aenderung.aufheben}>
              Frist aufheben
            </Button>
          )}
        </Flex>
      </Flex>
      {aenderung.dialoge}
    </Paneel>
  );
}
