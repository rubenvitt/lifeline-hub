import { App, AutoComplete, Form } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Select } from '../../components/Select';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { speichereEinstellungen } from '../../api/incidents';
import { einsatzKeys } from '../../api/queryKeys';
import { modulRegistry, modulZuRoute, redirectZiel } from '../../einsatz/modulRegistry';
import { useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import { Feld, Formularpaneel } from '../../components/instrument';
import {
  EINHEITEN_OPTIONEN,
  KOORDINATEN_OPTIONEN,
  ZEITDARSTELLUNG_OPTIONEN,
  ZEITDARSTELLUNG_VORGABE,
  ZEITZONEN_OPTIONEN,
} from './optionen';
import {
  initialAllgemein,
  normalisiereAllgemein,
  orgHinweisSelect,
  orgHinweisWert,
  platzhalterVorgabe,
  platzhalterVorgabeSelect,
  zuUpdate,
  type FormWerteAllgemein,
} from './einsatzEinstellungenForm';
import { useSpeicherLeiste } from '../../components/speicherLeiste';
import SpeicherKnopf from '../../components/SpeicherKnopf';
import {
  AenderungsstandProvider,
  useAenderungsstandMerken,
} from '../../components/aenderungsstand';
import VerlassenRueckfrage from '../../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../../components/useFormularVerlassenSchutz';
import { teilwortSuche } from '../../components/teilwortSuche';
import { mitVorgabe } from '../../components/vorgabeText';

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
  const stand = useAenderungsstandMerken();
  const daten = useEinstellungenDaten(einsatzId);
  // Verlassen-Schutz (LFH-979, `frontend/AGENTS.md` „Formularseiten“): die Reiter sind eigene
  // Routen, ein Wechsel baut die Sektion ab und verwürfe die Eingabe still.
  const schutz = useFormularVerlassenSchutz({ aktiv: daten.darfBearbeiten });

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
  // Leer öffnet der Einsatz das Modul aus `redirectZiel` (LFH-944: der Platzhalter nennt es).
  const einstiegVorgabe = modulZuRoute(redirectZiel())?.label ?? 'ETB';
  const standardModulOptionen = modulRegistry
    .filter((m) => m.status === 'fertig')
    .map((m) => ({ value: m.key, label: m.label }));

  return (
    <>
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <SeitenHinweise
        fehler={speichern.error}
        // Nur bei fehlender Rolle. Einen abgeschlossenen Einsatz nennt schon der Seitenkopf.
        rechteFehlt={daten.istAktiv && !daten.darfBearbeiten}
        rechteText={daten.rechteGrund()}
      />
      <Form<FormWerteAllgemein>
        form={form}
        layout="vertical"
        initialValues={initialAllgemein(daten.einstellungen)}
        onValuesChange={schutz.geaendert}
        onFinish={(werte) => {
          const fassung = schutz.fassung();
          speichern.mutate(werte, {
            onSuccess: () => {
              schutz.gespeichert(fassung);
              stand.merke(werte);
            },
          });
        }}
        disabled={!daten.darfBearbeiten}
      >
        <AenderungsstandProvider
          ausgangswerte={initialAllgemein(daten.einstellungen)}
          merkeRef={stand.merkeRef}
        >
          <Formularpaneel titel="Einstieg">
            <Feld label="Einstiegsmodul" name="standard_modul">
              <Select
                allowClear
                placeholder={mitVorgabe(einstiegVorgabe)}
                options={standardModulOptionen}
              />
            </Feld>
          </Formularpaneel>

          <Formularpaneel titel="Anzeige-Konventionen">
            <Feld label="Zeitzone" name="zeitzone" extra={orgHinweisWert(orgDefaults?.zeitzone)}>
              <AutoComplete
                allowClear
                options={ZEITZONEN_OPTIONEN}
                placeholder={platzhalterVorgabe(orgDefaults?.zeitzone, 'Gerätezeit')}
                showSearch={teilwortSuche}
              />
            </Feld>
            <Feld
              label="Zeitdarstellung"
              name="zeitdarstellung"
              extra={orgHinweisSelect(orgDefaults?.zeitdarstellung, ZEITDARSTELLUNG_OPTIONEN)}
            >
              <Select
                allowClear
                placeholder={platzhalterVorgabeSelect(
                  orgDefaults?.zeitdarstellung,
                  ZEITDARSTELLUNG_OPTIONEN,
                  ZEITDARSTELLUNG_VORGABE,
                )}
                options={ZEITDARSTELLUNG_OPTIONEN}
              />
            </Feld>
            <Feld
              label="Einheiten"
              name="einheiten"
              extra={orgHinweisSelect(orgDefaults?.einheiten, EINHEITEN_OPTIONEN)}
            >
              <Select
                allowClear
                placeholder={platzhalterVorgabeSelect(
                  orgDefaults?.einheiten,
                  EINHEITEN_OPTIONEN,
                  'Metrisch',
                )}
                options={EINHEITEN_OPTIONEN}
              />
            </Feld>
            <Feld
              label="Koordinatenformat"
              name="koordinatenformat"
              extra={orgHinweisSelect(orgDefaults?.koordinatenformat, KOORDINATEN_OPTIONEN)}
            >
              <Select
                allowClear
                placeholder={platzhalterVorgabeSelect(
                  orgDefaults?.koordinatenformat,
                  KOORDINATEN_OPTIONEN,
                  'WGS84 dezimal',
                )}
                options={KOORDINATEN_OPTIONEN}
              />
            </Feld>
          </Formularpaneel>

          <div {...speicherLeiste}>
            <SpeicherKnopf loading={speichern.isPending} disabled={!daten.darfBearbeiten} />
          </div>
        </AenderungsstandProvider>
      </Form>
    </>
  );
}
