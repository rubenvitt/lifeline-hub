import { App, Button, DatePicker, Flex, Form, Modal, Typography, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { useEffect, useState, type ReactNode } from 'react';
import { setzeAufbewahrungsfrist } from '../api/aufbewahrung';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzAnzeige, FristSetzenBody } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAuth } from '../auth/AuthContext';
import { ErfassungsModal } from '../components/Erfassung';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { Datenfeld, Datenraster, Paneel } from '../components/instrument';
import { alsBackendZeit, alsOrtszeit } from '../etb/filterZeit';
import { darfFristSetzen, istFristverkuerzung } from './fristModell';

/**
 * Aufbewahrungsfrist am Einsatz anzeigen und ändern (LFH-23, design.md D8).
 *
 * Die Frist gehört NICHT zu den eingefrorenen Einstellungen: Einsatzleitung und System-Admin
 * setzen, verlängern und heben sie auch nach dem Abschluss auf, über ihren eigenen Endpunkt
 * (`PUT …/aufbewahrungsfrist`) und mit eigener Mutation. Deshalb steht das Paneel in der
 * Einstellungs-Sektion ÜBER und AUSSERHALB des Vollersatz-`<Form>` — ein Frist-PUT trägt
 * keinen Einstellungs-Payload, und ein Einstellungs-PUT keine Frist.
 *
 * **Umkehrbarkeit entscheidet die Rückfrage (LFH-363):** Verlängern und Aufheben schieben die
 * Sperre hinaus und fragen nicht. Eine Verkürzung — dazu zählt das erstmalige Setzen an einem
 * Einsatz ohne Frist — verlegt die Sperre vor; vor ihr steht eine Rückfrage mit `danger`, die
 * alten und neuen Zeitpunkt nennt, und erst dann geht `bestaetigt: true` hinaus. Die 409 des
 * Servers bleibt Sicherheitsnetz und erscheint als Text, sie wird nicht ausgewertet.
 *
 * **Fehler an der Stelle, an der die Person steht (LFH-345/535):** im Dialog, solange er offen
 * ist, sonst am Paneel. Kein Fehler-Toast; der Erfolg quittiert per Toast.
 */

type FristEinsatz = Pick<EinsatzAnzeige, 'status' | 'meine_rolle' | 'retention_bis'>;

interface FristFormWerte {
  frist?: Dayjs | null;
}

interface Rueckfrage {
  neu: string;
  bestaetigen: () => void;
  abbrechen: () => void;
}

/** Text des Rechte-Hinweises — eine Stelle für Paneel und Akte. */
export const FRIST_RECHTE_TEXT =
  'Nur die Einsatzleitung oder ein System-Admin darf die Aufbewahrungsfrist ändern — die Frist steht hier zum Nachlesen.';

export interface FristAenderung {
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
  // Die Vergleichsbasis wird beim ÖFFNEN eingefroren (LFH-303): ein Refetch während des
  // Dialogs verschöbe sonst still, was als Verkürzung gilt.
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

  // Vorbelegen zum Bearbeiten per `setFieldsValue` beim Öffnen (Erfassungs-Norm), nicht über
  // `initialValues`: die Formularinstanz lebt im Hook, und rc-field-form behält ihren
  // Speicher über das Abhängen des Dialogs hinweg — beim nächsten Öffnen gewönne sonst der
  // Wert der VORIGEN Öffnung, und ein Absenden nähme eine inzwischen bestätigte Verkürzung
  // still zurück (Review-Befund, `FristPaneel.test.tsx`).
  useEffect(() => {
    if (offen) form.setFieldsValue({ frist: alsOrtszeit(basis ?? undefined) ?? null });
  }, [offen, basis, form]);

  /** Fragt bei einer Verkürzung zurück; die Zusage lehnt ab, wenn abgebrochen wird — die
   *  Erfassungshülle lässt die Felder dann stehen und sendet nichts. */
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
        initialValues={{ frist: alsOrtszeit(basis ?? undefined) ?? null }}
        erfassenText="Frist setzen"
        laeuft={mutation.isPending}
        onErfassen={async (werte) => {
          if (!werte.frist) throw new Error('keine Frist');
          const neu = alsBackendZeit(werte.frist);
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
          <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
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
            vorverlegt. Ab dann ist der abgeschlossene Einsatz für alle gesperrt und wird zur
            Löschung vorgemerkt.
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
