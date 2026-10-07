import { App, Button, Form, InputNumber } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { speichereEinstellungen } from '../../api/einsaetze';
import { einsatzKeys } from '../../api/queryKeys';
import { RECHTE_TEXT, useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import {
  initialAufbewahrung,
  normalisiereAufbewahrung,
  orgHinweisWert,
  platzhalterVorgabe,
  zuUpdate,
  type FormWerteAufbewahrung,
} from './einsatzEinstellungenForm';
import { useSpeicherLeiste } from '../../components/speicherLeiste';
import VerlassenRueckfrage from '../../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../../components/useFormularVerlassenSchutz';
import { Formularpaneel } from '../../components/instrument';
import FristPaneel from '../../aufbewahrung/FristPaneel';
import { EINSATZ_ABGESCHLOSSEN } from '../../components/nurAnsicht';

/**
 * Sektion `…/einstellungen/aufbewahrung` — die Aufbewahrungs-Dauer. Ein Feld, siebzehn mitfahrende:
 * ohne `zuUpdate` löschte ein Speichern hier Nummernkreise, Anzeige-Konventionen und
 * Karten-Defaults mit.
 *
 * Die Frist steht daneben, nicht darin: die Dauer ist eine Einstellung und friert mit dem Abschluss
 * ein, die Frist ist ein Zeitpunkt am Einsatz, den Einsatzleitung und System-Admin der
 * Einsatz-Org auch danach setzen. `FristPaneel` steht deshalb außerhalb des Vollersatz-`<Form>` — sein PUT trägt keinen
 * Einstellungs-Payload, und `disabled` des Formulars sperrt es nicht mit.
 */
export default function EinsatzAufbewahrung() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteAufbewahrung>();
  const speicherLeiste = useSpeicherLeiste();
  const daten = useEinstellungenDaten(einsatzId);
  // Verlassen-Schutz (LFH-979, `frontend/AGENTS.md` „Formularseiten“): die Reiter sind eigene
  // Routen, ein Wechsel baut die Sektion ab und verwürfe die Eingabe still.
  const schutz = useFormularVerlassenSchutz({ aktiv: daten.darfBearbeiten });

  // Kein `onError`-Toast — der Fehler steht als Alert über dem Formular.
  const speichern = useMutation({
    mutationFn: (werte: FormWerteAufbewahrung) =>
      speichereEinstellungen(einsatzId, {
        ...zuUpdate(daten.einstellungen!),
        ...normalisiereAufbewahrung(werte),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einstellungen(einsatzId) });
      message.success('Einstellungen gespeichert');
    },
  });

  if (daten.laedt) return <SeitenSkeleton />;
  if (!daten.einstellungen) {
    return (
      <SeitenFehler
        text="Einstellungen nicht ladbar oder kein Zugriff"
        onWiederholen={daten.neuLaden}
      />
    );
  }

  const orgDauer = daten.einstellungen.org_defaults?.retention_dauer_tage;
  const orgHinweis = orgHinweisWert(orgDauer, 'Tage');

  return (
    <>
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <SeitenHinweise
        fehler={speichern.error}
        rechteFehlt={daten.istAktiv && !daten.darfBearbeiten}
        rechteText={RECHTE_TEXT}
      />
      {daten.einsatz && <FristPaneel einsatzId={einsatzId} einsatz={daten.einsatz} />}
      <Form<FormWerteAufbewahrung>
        form={form}
        layout="vertical"
        initialValues={initialAufbewahrung(daten.einstellungen)}
        onValuesChange={schutz.geaendert}
        onFinish={(werte) => {
          const fassung = schutz.fassung();
          speichern.mutate(werte, { onSuccess: () => schutz.gespeichert(fassung) });
        }}
        disabled={!daten.darfBearbeiten}
      >
        <Formularpaneel titel="Aufbewahrung & Archiv">
          <Form.Item
            label="Aufbewahrungs-Dauer (Tage)"
            name="retention_dauer_tage"
            // Abgeschlossen steht kein „Nur Ansicht“ im Seitenkopf (die Frist oben bleibt
            // änderbar); der Grund der Sperre steht deshalb hier am Feld, unter der Vorgabe der
            // Organisation (Spec `bedien-begriffe`).
            extra={
              daten.istAktiv ? (
                orgHinweis
              ) : (
                <>
                  {orgHinweis && <span style={{ display: 'block' }}>{orgHinweis}</span>}
                  {EINSATZ_ABGESCHLOSSEN}
                </>
              )
            }
          >
            <InputNumber
              min={1}
              max={3650}
              style={{ width: '100%', maxWidth: 200 }}
              // Einsatz ?? Org (`einsatz/effektiv.rs`): der Platzhalter nennt den wirksamen Wert.
              placeholder={platzhalterVorgabe(orgDauer, 'keine')}
            />
          </Form.Item>
        </Formularpaneel>

        <div {...speicherLeiste}>
          <Button type="primary" htmlType="submit" loading={speichern.isPending}>
            Speichern
          </Button>
        </div>
      </Form>
    </>
  );
}
