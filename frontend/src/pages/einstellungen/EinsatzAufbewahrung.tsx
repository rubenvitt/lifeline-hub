import { App, Button, Form, InputNumber, theme } from 'antd';
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
  zuUpdate,
  type FormWerteAufbewahrung,
} from './einsatzEinstellungenForm';
import { speicherLeisteStil } from '../../components/speicherLeiste';
import { Formularpaneel } from '../../components/instrument';
import FristPaneel from '../../aufbewahrung/FristPaneel';

/**
 * Sektion `…/einstellungen/aufbewahrung` — die Aufbewahrungs-Dauer. Ein Feld, siebzehn mitfahrende:
 * ohne `zuUpdate` löschte ein Speichern hier Nummernkreise, Anzeige-Konventionen und
 * Karten-Defaults mit.
 *
 * Die Frist steht daneben, nicht darin: die Dauer ist eine Einstellung und friert mit dem Abschluss
 * ein, die Frist ist ein Zeitpunkt am Einsatz, den Einsatzleitung und System-Admin auch danach
 * setzen. `FristPaneel` steht deshalb außerhalb des Vollersatz-`<Form>` — sein PUT trägt keinen
 * Einstellungs-Payload, und `disabled` des Formulars sperrt es nicht mit.
 */
export default function EinsatzAufbewahrung() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteAufbewahrung>();
  const { token } = theme.useToken();
  const daten = useEinstellungenDaten(einsatzId);

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

  return (
    <>
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
        onFinish={(werte) => speichern.mutate(werte)}
        disabled={!daten.darfBearbeiten}
      >
        <Formularpaneel
          titel="Aufbewahrung & Archiv"
          beschreibung="Aufbewahrungs-Dauer in Tagen für diesen Einsatz. Beim Abschluss entsteht daraus die Aufbewahrungsfrist (oben), die nie auf den laufenden Einsatz wirkt. Nach Fristablauf wird der Einsatz zunächst gesperrt, zur Löschung vorgemerkt und nach 30 Tagen Karenz unwiderruflich von Personendaten bereinigt (ETB und Statistik bleiben erhalten). Leer = keine automatische Frist. Die Frist selbst ändert man oben — auch nach dem Abschluss; eine Verkürzung fragt vorher nach."
        >
          <Form.Item
            label="Aufbewahrungs-Dauer (Tage)"
            name="retention_dauer_tage"
            tooltip="1 bis 3650 Tage. Leer = keine automatische Aufbewahrungsfrist."
            extra={orgHinweisWert(daten.einstellungen.org_defaults?.retention_dauer_tage, 'Tage')}
          >
            <InputNumber
              min={1}
              max={3650}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder="keine"
            />
          </Form.Item>
        </Formularpaneel>

        <div style={speicherLeisteStil(token)}>
          <Button type="primary" htmlType="submit" loading={speichern.isPending}>
            Speichern
          </Button>
        </div>
      </Form>
    </>
  );
}
