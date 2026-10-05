import { App, AutoComplete, Button, Form } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Select } from '../../components/Select';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { speichereEinstellungen } from '../../api/einsaetze';
import { einsatzKeys } from '../../api/queryKeys';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { RECHTE_TEXT, useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import { Formularpaneel } from '../../components/instrument';
import {
  EINHEITEN_OPTIONEN,
  KOORDINATEN_OPTIONEN,
  ZEITFORMAT_OPTIONEN,
  ZEITZONEN_OPTIONEN,
} from './optionen';
import {
  initialAllgemein,
  normalisiereAllgemein,
  orgHinweisSelect,
  orgHinweisWert,
  zuUpdate,
  type FormWerteAllgemein,
} from './einsatzEinstellungenForm';
import { useSpeicherLeiste } from '../../components/speicherLeiste';
import VerlassenRueckfrage from '../../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../../components/useFormularVerlassenSchutz';
import { teilwortSuche } from '../../components/teilwortSuche';

/**
 * Sektion `…/einstellungen/allgemein` — Einstieg + Anzeige-Konventionen. Fünf Felder, deshalb
 * einspaltig.
 *
 * Der Speichern-Knopf schickt den vollen Payload: `zuUpdate` liefert die Basis aus dem geladenen
 * Stand, `normalisiereAllgemein` überschreibt nur die eigenen Felder. Ohne das nullte ein Speichern
 * hier Nummernkreise und Aufbewahrungsfrist.
 */
export default function EinsatzAllgemein() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteAllgemein>();
  const speicherLeiste = useSpeicherLeiste();
  const daten = useEinstellungenDaten(einsatzId);
  // Verlassen-Schutz (LFH-979, `frontend/AGENTS.md` „Formularseiten“): die Reiter sind eigene
  // Routen, ein Wechsel baut die Sektion ab und verwürfe die Eingabe still.
  const schutz = useFormularVerlassenSchutz({
    aktiv: daten.darfBearbeiten,
    schluessel: einsatzId,
  });

  // Kein `onError`-Toast: der Fehler steht als Alert über dem Formular, bis der nächste Versuch
  // läuft. Der Erfolg bleibt beim Toast.
  const speichern = useMutation({
    mutationFn: (werte: FormWerteAllgemein) =>
      speichereEinstellungen(einsatzId, {
        ...zuUpdate(daten.einstellungen!),
        ...normalisiereAllgemein(werte),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einstellungen(einsatzId) });
      message.success('Einstellungen gespeichert');
    },
  });

  if (daten.laedt) return <SeitenSkeleton />;
  // Der Riegel gehört in jede Sektion: `Form initialValues` wird nur beim Mount gelesen. Ohne Daten
  // montiert, schickte der nächste Speichern-Klick einen Vollersatz-PUT aus lauter null.
  if (!daten.einstellungen) {
    return (
      <SeitenFehler
        text="Einstellungen nicht ladbar oder kein Zugriff"
        onWiederholen={daten.neuLaden}
      />
    );
  }

  const orgDefaults = daten.einstellungen.org_defaults;
  // Nur fertige Module sind als Default-Modul wählbar.
  const standardModulOptionen = modulRegistry
    .filter((m) => m.status === 'fertig')
    .map((m) => ({ value: m.key, label: m.label }));

  return (
    <>
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <SeitenHinweise
        fehler={speichern.error}
        // Nur bei fehlender Rolle. Einen abgeschlossenen Einsatz nennt schon der Alert im
        // Seitenkopf.
        rechteFehlt={daten.istAktiv && !daten.darfBearbeiten}
        rechteText={RECHTE_TEXT}
      />
      <Form<FormWerteAllgemein>
        form={form}
        layout="vertical"
        initialValues={initialAllgemein(daten.einstellungen)}
        onValuesChange={schutz.geaendert}
        onFinish={(werte) => {
          const fassung = schutz.fassung();
          speichern.mutate(werte, { onSuccess: () => schutz.gespeichert(fassung) });
        }}
        disabled={!daten.darfBearbeiten}
      >
        <Formularpaneel titel="Einstieg">
          <Form.Item
            label="Standard-Modul (Einstieg)"
            name="standard_modul"
            tooltip="Modul, das beim Öffnen des Einsatzes angezeigt wird. Leer = Standard (Lage-Dashboard bzw. ETB)."
          >
            <Select
              allowClear
              placeholder="Standard (Lage-Dashboard bzw. ETB)"
              options={standardModulOptionen}
            />
          </Form.Item>
        </Formularpaneel>

        <Formularpaneel
          titel="Anzeige-Konventionen"
          beschreibung="Gemeinsame Darstellung für diesen Einsatz (Lagebild). Leer = Standard."
        >
          <Form.Item
            label="Zeitzone"
            name="zeitzone"
            tooltip="IANA-Zeitzone (z. B. Europe/Berlin). Leer = lokale Zeit des Geräts."
            extra={orgHinweisWert(orgDefaults?.zeitzone)}
          >
            <AutoComplete
              allowClear
              options={ZEITZONEN_OPTIONEN}
              placeholder="Europe/Berlin (Standard)"
              showSearch={teilwortSuche}
            />
          </Form.Item>
          <Form.Item
            label="Zeitformat"
            name="zeitformat"
            extra={orgHinweisSelect(orgDefaults?.zeitformat, ZEITFORMAT_OPTIONEN)}
          >
            <Select allowClear placeholder="24 Stunden (Standard)" options={ZEITFORMAT_OPTIONEN} />
          </Form.Item>
          <Form.Item
            label="Einheiten"
            name="einheiten"
            extra={orgHinweisSelect(orgDefaults?.einheiten, EINHEITEN_OPTIONEN)}
          >
            <Select allowClear placeholder="Metrisch (Standard)" options={EINHEITEN_OPTIONEN} />
          </Form.Item>
          <Form.Item
            label="Koordinatenformat"
            name="koordinatenformat"
            extra={orgHinweisSelect(orgDefaults?.koordinatenformat, KOORDINATEN_OPTIONEN)}
          >
            <Select
              allowClear
              placeholder="WGS84 dezimal (Standard)"
              options={KOORDINATEN_OPTIONEN}
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
