import { App, Button, Flex, Form, Input, Modal, Typography, theme } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Dayjs } from 'dayjs';
import { ladeKategorieAufbewahrung, setzeKategorieFrist } from '../api/aufbewahrung';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Datenkategorie, KategorieAufbewahrung, KategorieFristBody } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import { Datenfeld, Datenraster } from '../components/instrument';
import { aufbewahrungZustand } from '../theme/statusFarben';
import { fristAusEingabe, istFristverkuerzung } from './fristModell';
import { KATEGORIE_TEXT, vorgabeSatz } from './kategorieText';

/**
 * Aufbewahrung je Datenkategorie (LFH-749, Spec `aufbewahrung-kategorien` und
 * `aufbewahrung-archiv`, „Frist am Einsatz anzeigen und ändern“): je Kategorie Zustand als
 * Statusetikett mit Wort, Frist und Rechtsgrundlage; an einem aktiven Einsatz der Satz aus der
 * Org-Vorgabe.
 *
 * **Ändern nur am abgeschlossenen Einsatz** (vorher entsteht die Frist erst beim Abschluss) und nur
 * solange die Kategorie nicht geschwärzt ist und ihre Karenz läuft. Dieselbe Rückfrage-Regel wie
 * die Einsatz-Frist: Verlängern und Aufheben fragen nicht, eine Verkürzung (auch das erstmalige
 * Setzen) fragt mit altem und neuem Zeitpunkt. In der Karenz nimmt eine künftige Frist die
 * Vormerkung zurück — das ist eine Verlängerung, keine Rückfrage. Die erste Frist einer Kategorie
 * braucht eine Rechtsgrundlage (Server sonst 422).
 */

interface Props {
  einsatzId: number;
  status: 'aktiv' | 'abgeschlossen';
  /** Einsatzleitung oder System-Admin. */
  darf: boolean;
}

interface FormWerte {
  frist?: Dayjs | null;
  rechtsgrundlage?: string;
}

/** Ob die Frist einer Kategorie noch änderbar ist (Server: sonst 409). */
function aenderbar(k: KategorieAufbewahrung): boolean {
  return k.zustand !== 'geschwaerzt' && k.zustand !== 'schwaerzung_ausstehend';
}

export function KategorieWert({
  eintrag,
  aktiv,
}: {
  eintrag: KategorieAufbewahrung;
  aktiv: boolean;
}) {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={token.marginXXS}>
      <Flex gap={token.marginXS} wrap align="center">
        {eintrag.zustand && <StatusTag darstellung={aufbewahrungZustand[eintrag.zustand]} />}
        {aktiv ? (
          <span>{vorgabeSatz(eintrag.dauer_tage_vorgabe)}</span>
        ) : eintrag.geschwaerzt_at ? (
          <span>
            geschwärzt am <ZeitAnzeige wert={eintrag.geschwaerzt_at} />
          </span>
        ) : eintrag.frist_bis ? (
          <span>
            Frist <ZeitAnzeige wert={eintrag.frist_bis} />
            {eintrag.karenz_ende && (
              <>
                {' '}
                · Karenz bis <ZeitAnzeige wert={eintrag.karenz_ende} />
              </>
            )}
          </span>
        ) : (
          <span>folgt der Frist des Einsatzes</span>
        )}
      </Flex>
      {eintrag.rechtsgrundlage && (
        <Typography.Text type="secondary">
          Rechtsgrundlage: {eintrag.rechtsgrundlage}
        </Typography.Text>
      )}
    </Flex>
  );
}

export default function KategorieFristen({ einsatzId, status, darf }: Props) {
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [auswahl, setAuswahl] = useState<KategorieAufbewahrung | null>(null);
  const [rueckfrage, setRueckfrage] = useState<{
    neu: string;
    bestaetigen: () => void;
    abbrechen: () => void;
  } | null>(null);
  const aktiv = status === 'aktiv';

  const query = useQuery({
    queryKey: einsatzKeys.aufbewahrungKategorien(einsatzId),
    queryFn: () => ladeKategorieAufbewahrung(einsatzId),
  });

  const mutation = useMutation({
    mutationFn: (v: { kategorie: Datenkategorie; body: KategorieFristBody }) =>
      setzeKategorieFrist(einsatzId, v.kategorie, v.body),
    onSuccess: (liste) => {
      qc.setQueryData(einsatzKeys.aufbewahrungKategorien(einsatzId), liste);
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      void qc.invalidateQueries({ queryKey: globalKeys.aufbewahrung() });
      message.success('Frist der Datenkategorie gespeichert');
    },
  });

  // Vorbelegen beim Öffnen (wie `FristPaneel`): rc-field-form behält sonst den Wert der vorigen
  // Öffnung.
  useEffect(() => {
    if (auswahl) {
      form.setFieldsValue({
        frist: alsZeitpunkt(auswahl.frist_bis) ?? null,
        rechtsgrundlage: auswahl.rechtsgrundlage ?? '',
      });
    }
  }, [auswahl, form]);

  const schliessen = () => {
    mutation.reset();
    setAuswahl(null);
  };

  const bestaetigt = (basis: string | null | undefined, neu: string, vorgemerkt: boolean) =>
    new Promise<boolean>((resolve, reject) => {
      if (vorgemerkt || !istFristverkuerzung(basis, neu)) {
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

  if (query.isLoading) return null;
  if (query.isError || !query.data) {
    return <SpeicherFehler fehler={query.error ?? new Error('nicht ladbar')} />;
  }

  return (
    <>
      <Datenraster spalten={1} beschriftung="Aufbewahrung je Datenkategorie">
        {query.data.map((eintrag) => {
          const text = KATEGORIE_TEXT[eintrag.kategorie];
          return (
            <Datenfeld key={eintrag.kategorie} label={text.bezeichnung} breit>
              <Flex vertical gap={token.marginXS}>
                <KategorieWert eintrag={eintrag} aktiv={aktiv} />
                {!aktiv && aenderbar(eintrag) && (
                  <Flex gap={token.marginSM} wrap>
                    <Button
                      size="small"
                      disabled={!darf}
                      aria-label={`Frist ${text.bezeichnung} ändern`}
                      onClick={() => {
                        mutation.reset();
                        setAuswahl(eintrag);
                      }}
                    >
                      Frist ändern
                    </Button>
                    {eintrag.frist_bis && (
                      <Button
                        size="small"
                        disabled={!darf || mutation.isPending}
                        aria-label={`Frist ${text.bezeichnung} aufheben`}
                        onClick={() =>
                          mutation.mutate({
                            kategorie: eintrag.kategorie,
                            body: { retention_bis: null },
                          })
                        }
                      >
                        Frist aufheben
                      </Button>
                    )}
                  </Flex>
                )}
              </Flex>
            </Datenfeld>
          );
        })}
      </Datenraster>
      <SpeicherFehler fehler={auswahl ? null : mutation.error} />
      <ErfassungsModal<FormWerte>
        offen={auswahl != null}
        titel={auswahl ? `Frist „${KATEGORIE_TEXT[auswahl.kategorie].bezeichnung}“ ändern` : ''}
        form={form}
        initialValues={{}}
        erfassenText="Frist setzen"
        laeuft={mutation.isPending}
        onErfassen={async (werte) => {
          if (!auswahl || !werte.frist) throw new Error('keine Frist');
          const basis = auswahl.frist_bis;
          const neu = fristAusEingabe(alsBackendZeit(werte.frist), basis);
          const mitBestaetigung = await bestaetigt(basis, neu, auswahl.vorgemerkt_at != null);
          const rechtsgrundlage = werte.rechtsgrundlage?.trim();
          await mutation.mutateAsync({
            kategorie: auswahl.kategorie,
            body: {
              retention_bis: neu,
              ...(mitBestaetigung ? { bestaetigt: true } : {}),
              ...(rechtsgrundlage ? { rechtsgrundlage } : {}),
            },
          });
        }}
        onFertig={schliessen}
        onAbbrechen={schliessen}
      >
        <Form.Item
          label="Neue Frist"
          name="frist"
          rules={[{ required: true, message: 'Zeitpunkt wählen' }]}
          extra={
            auswahl?.vorgemerkt_at
              ? 'Die Kategorie ist vorgemerkt — eine Frist in der Zukunft nimmt die Vormerkung zurück.'
              : 'Ab diesem Zeitpunkt wird die Kategorie vorgemerkt und nach 30 Tagen Karenz unwiderruflich geschwärzt.'
          }
        >
          <ZeitpunktEingabe format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="Rechtsgrundlage"
          name="rechtsgrundlage"
          rules={[
            { max: 500, message: 'Höchstens 500 Zeichen' },
            ...(auswahl?.rechtsgrundlage
              ? []
              : [{ required: true, whitespace: true, message: 'Rechtsgrundlage angeben' }]),
          ]}
        >
          <Input placeholder="z. B. Paragraf und Gesetz" />
        </Form.Item>
        <SpeicherFehler fehler={auswahl ? mutation.error : null} />
      </ErfassungsModal>
      <Modal
        open={rueckfrage != null}
        title="Frist der Datenkategorie verkürzen?"
        okText="Verkürzen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        onOk={() => rueckfrage?.bestaetigen()}
        onCancel={() => rueckfrage?.abbrechen()}
        destroyOnHidden
      >
        {rueckfrage && auswahl && (
          <Typography.Paragraph>
            Die Frist von „{KATEGORIE_TEXT[auswahl.kategorie].bezeichnung}“ wird von{' '}
            <strong>
              {auswahl.frist_bis ? <ZeitAnzeige wert={auswahl.frist_bis} /> : 'der Einsatz-Frist'}
            </strong>{' '}
            auf{' '}
            <strong>
              <ZeitAnzeige wert={rueckfrage.neu} />
            </strong>{' '}
            vorverlegt. Danach wird die Kategorie vorgemerkt und nach 30 Tagen Karenz unwiderruflich
            geschwärzt.
          </Typography.Paragraph>
        )}
      </Modal>
    </>
  );
}
