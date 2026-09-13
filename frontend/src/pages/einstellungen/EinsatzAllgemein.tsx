import { App, AutoComplete, Button, Form, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Select } from '../../components/Select';
import SektionHeader from '../../components/SektionHeader';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { speichereEinstellungen } from '../../api/einsaetze';
import { einsatzKeys } from '../../api/queryKeys';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { RECHTE_TEXT, useEinstellungenDaten } from '../EinsatzEinstellungenPage';
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
  speicherLeisteStil,
  zuUpdate,
  type FormWerteAllgemein,
} from './einsatzEinstellungenForm';

/**
 * Sektion `…/einstellungen/allgemein` (LFH-345 · C10) — Einstieg + Anzeige-Konventionen.
 *
 * Fünf Felder, deshalb **einspaltig**: zwei Spalten sind ab neun Feldern eine Hilfe
 * (Sektion „Verhalten"), darunter ziehen sie den Blick nur auseinander.
 *
 * Der Speichern-Knopf schickt den **vollen** Payload — `zuUpdate` liefert die Basis aus dem
 * geladenen Stand, `normalisiereAllgemein` überschreibt nur die fünf eigenen Felder. Ohne
 * das nullte ein Speichern hier die Nummernkreise und die Aufbewahrungsfrist.
 */
export default function EinsatzAllgemein() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteAllgemein>();
  const { token } = theme.useToken();
  const daten = useEinstellungenDaten(einsatzId);

  // KEIN `onError`-Toast (H14): der Fehler haengt an `mutation.error` und steht als Alert
  // ueber dem Formular, bis der naechste Versuch laeuft. Der ERFOLG bleibt beim Toast — er
  // quittiert eine abgeschlossene Handlung und braucht keinen Platz auf der Seite.
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
  // Der Riegel gehoert in JEDE Sektion, nicht nur ins Layout: `Form initialValues` wird genau
  // einmal beim Mount gelesen. Eine ohne Daten montierte Sektion zeigte ein leeres Formular,
  // und der naechste Speichern-Klick schickte einen Vollersatz-PUT aus lauter null.
  if (!daten.einstellungen) {
    return (
      <SeitenFehler
        text="Einstellungen nicht ladbar oder kein Zugriff"
        onWiederholen={daten.neuLaden}
      />
    );
  }

  const orgDefaults = daten.einstellungen.org_defaults;
  // Nur fertige Module sind als Default-Modul waehlbar (Pre-Mortem: kein Sprung auf
  // geplante/WIP-Module).
  const standardModulOptionen = modulRegistry
    .filter((m) => m.status === 'fertig')
    .map((m) => ({ value: m.key, label: m.label }));

  return (
    <>
      <SeitenHinweise
        fehler={speichern.error}
        // Nur bei fehlender ROLLE. Ist der Einsatz abgeschlossen, sagt das der Alert im
        // Seitenkopf — zwei Erklaerungen fuer dieselbe Sperre waeren eine zu viel.
        rechteFehlt={daten.istAktiv && !daten.darfBearbeiten}
        rechteText={RECHTE_TEXT}
      />
      <Form<FormWerteAllgemein>
        form={form}
        layout="vertical"
        initialValues={initialAllgemein(daten.einstellungen)}
        onFinish={(werte) => speichern.mutate(werte)}
        disabled={!daten.darfBearbeiten}
      >
        <SektionHeader titel="Einstieg" />
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

        <SektionHeader
          titel="Anzeige-Konventionen"
          beschreibung="Gemeinsame Darstellung für diesen Einsatz (Lagebild). Leer = Standard."
        />
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
            showSearch={{
              filterOption: (eingabe, option) =>
                (option?.value ?? '').toLowerCase().includes(eingabe.toLowerCase()),
            }}
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

        <div style={speicherLeisteStil(token)}>
          <Button type="primary" htmlType="submit" loading={speichern.isPending}>
            Speichern
          </Button>
        </div>
      </Form>
    </>
  );
}
