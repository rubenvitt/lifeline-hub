import { App, Form, Input, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Select } from '../../components/Select';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useViewport } from '../../components/useViewport';
import { speichereEinstellungen } from '../../api/einsaetze';
import { einsatzKeys } from '../../api/queryKeys';
import { useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import {
  feldrasterStil,
  initialVerhalten,
  normalisiereVerhalten,
  orgHinweisAutoEtb,
  orgHinweisWert,
  platzhalterVorgabe,
  zuUpdate,
  type FormWerteVerhalten,
} from './einsatzEinstellungenForm';
import { useSpeicherLeiste } from '../../components/speicherLeiste';
import SpeicherKnopf from '../../components/SpeicherKnopf';
import {
  AenderungsstandProvider,
  useAenderungsstandMerken,
} from '../../components/aenderungsstand';
import VerlassenRueckfrage from '../../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../../components/useFormularVerlassenSchutz';
import { Feld, Formularpaneel, Stapel } from '../../components/instrument';
import { mitVorgabe } from '../../components/vorgabeText';
import { ZahlFeld } from '../../components/ZahlFeld';

/** Tristate-Optionen für automatische ETB-Einträge (leer = erbt Org, true = An, false = Aus).
 *  Bleibt bewusst hier: diese Liste gibt es nur auf der Einsatz-Ebene. */
const AUTO_ETB_OPTIONEN: { value: boolean; label: string }[] = [
  { value: true, label: 'An' },
  { value: false, label: 'Aus' },
];

/**
 * Sektion `…/einstellungen/verhalten` — Nummernkreise, Fristen, Auto-ETB. Die einzige zweispaltige
 * Sektion (neun Felder). Die Schwelle `lg` kommt aus `useViewport`, das Raster liegt als reine
 * Funktion in `einsatzEinstellungenForm`.
 */
export default function EinsatzVerhalten() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteVerhalten>();
  const { token } = theme.useToken();
  const speicherLeiste = useSpeicherLeiste();
  const stand = useAenderungsstandMerken();
  const { abBreite } = useViewport();
  const daten = useEinstellungenDaten(einsatzId);
  // Verlassen-Schutz (LFH-979, `frontend/AGENTS.md` „Formularseiten“): die Reiter sind eigene
  // Routen, ein Wechsel baut die Sektion ab und verwürfe die Eingabe still.
  const schutz = useFormularVerlassenSchutz({ aktiv: daten.darfBearbeiten });

  // Kein `onError`-Toast — der Fehler steht als Alert über dem Formular.
  const speichern = useMutation({
    mutationFn: (werte: FormWerteVerhalten) =>
      speichereEinstellungen(einsatzId, {
        ...zuUpdate(daten.einstellungen!),
        ...normalisiereVerhalten(werte),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einstellungen(einsatzId) });
      // Die Rückmeldefrist steckt im `faellig_at` der Rückmeldungen.
      qc.invalidateQueries({ queryKey: einsatzKeys.meldungenRueckmeldungen(einsatzId) });
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

  const einstellungen = daten.einstellungen;
  const orgDefaults = einstellungen.org_defaults;

  return (
    <>
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <SeitenHinweise
        fehler={speichern.error}
        rechteFehlt={daten.istAktiv && !daten.darfBearbeiten}
        rechteText={daten.rechteGrund()}
      />
      <Form<FormWerteVerhalten>
        form={form}
        layout="vertical"
        initialValues={initialVerhalten(einstellungen)}
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
          ausgangswerte={initialVerhalten(einstellungen)}
          merkeRef={stand.merkeRef}
        >
          <Formularpaneel titel="Verhalten & Automatik">
            <div style={feldrasterStil(abBreite('lg'), token.margin)}>
              {(
                [
                  {
                    key: 'etb',
                    label: 'ETB',
                    beispiel: 'EB-',
                    eingefroren: einstellungen.etb_nummer_eingefroren,
                    orgPraefix: orgDefaults?.etb_nummer_praefix,
                  },
                  {
                    key: 'meldung',
                    label: 'Meldungen',
                    beispiel: 'M-',
                    eingefroren: einstellungen.meldung_nummer_eingefroren,
                    orgPraefix: orgDefaults?.meldung_nummer_praefix,
                  },
                  {
                    key: 'auftrag',
                    label: 'Aufträge',
                    beispiel: 'A-',
                    eingefroren: einstellungen.auftrag_nummer_eingefroren,
                    orgPraefix: orgDefaults?.auftrag_nummer_praefix,
                  },
                ] as const
              ).map((nk) => (
                // Präfix und Startwert eines Kreises bleiben ein Rasterfeld, sonst stünden sie in
                // verschiedenen Spalten.
                <Stapel key={nk.key} richtung="zeile" abstand="md" ausrichten="start">
                  <Stapel wachsen>
                    <Feld
                      label={`Präfix ${nk.label}`}
                      name={`${nk.key}_nummer_praefix`}
                      extra={
                        nk.eingefroren
                          ? 'Erste Nummer bereits vergeben — nicht mehr änderbar'
                          : orgHinweisWert(nk.orgPraefix)
                      }
                    >
                      <Input
                        maxLength={8}
                        placeholder={`z. B. ${nk.beispiel}`}
                        disabled={nk.eingefroren}
                      />
                    </Feld>
                  </Stapel>
                  {/* `flex: 0 1 160px` statt `width: 160`: eine feste Pixelbreite ragte am schmalen
                    Schirm über den Rand (`components/feld.guard.test.ts`). `Feld` nimmt keinen
                    Stil, darum trägt die Hülle die Spur. */}
                  <div style={{ flex: '0 1 160px', minWidth: 0 }}>
                    <Feld label={`Startwert ${nk.label}`} name={`${nk.key}_nummer_start`}>
                      <ZahlFeld
                        min={1}
                        max={999999}
                        placeholder={mitVorgabe('1')}
                        disabled={nk.eingefroren}
                      />
                    </Feld>
                  </div>
                </Stapel>
              ))}

              <Feld
                breite="schmal"
                label="Bestätigungsfrist Meldungen (Minuten)"
                name="meldung_bestaetigung_frist_min"
                extra={orgHinweisWert(orgDefaults?.meldung_bestaetigung_frist_min, 'Min.')}
              >
                <ZahlFeld
                  min={1}
                  max={10080}
                  placeholder={platzhalterVorgabe(orgDefaults?.meldung_bestaetigung_frist_min, '5')}
                />
              </Feld>
              <Feld
                breite="schmal"
                label="Quittierfrist Aufträge (Minuten)"
                name="auftrag_quittierung_frist_min"
                extra={orgHinweisWert(orgDefaults?.auftrag_quittierung_frist_min, 'Min.')}
              >
                <ZahlFeld
                  min={1}
                  max={10080}
                  placeholder={platzhalterVorgabe(
                    orgDefaults?.auftrag_quittierung_frist_min,
                    'keine Frist',
                  )}
                />
              </Feld>
              <Feld
                breite="schmal"
                label="Rückmeldefrist Einheiten (Minuten)"
                name="rueckmeldung_frist_min"
                extra={orgHinweisWert(orgDefaults?.rueckmeldung_frist_min, 'Min.')}
              >
                <ZahlFeld
                  min={1}
                  max={10080}
                  placeholder={platzhalterVorgabe(orgDefaults?.rueckmeldung_frist_min, '60')}
                />
              </Feld>
              <Feld
                breite="schmal"
                label="Automatische ETB-Einträge"
                name="auto_etb_eintraege"
                extra={orgHinweisAutoEtb(orgDefaults?.auto_etb_eintraege)}
              >
                <Select
                  allowClear
                  placeholder={platzhalterVorgabe(
                    orgDefaults?.auto_etb_eintraege == null
                      ? null
                      : orgDefaults.auto_etb_eintraege === 0
                        ? 'Aus'
                        : 'An',
                    'An',
                  )}
                  options={AUTO_ETB_OPTIONEN}
                />
              </Feld>
            </div>
          </Formularpaneel>

          <div {...speicherLeiste}>
            <SpeicherKnopf loading={speichern.isPending} disabled={!daten.darfBearbeiten} />
          </div>
        </AenderungsstandProvider>
      </Form>
    </>
  );
}
