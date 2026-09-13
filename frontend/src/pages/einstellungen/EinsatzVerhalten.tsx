import { App, Button, Form, Input, InputNumber, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Select } from '../../components/Select';
import SektionHeader from '../../components/SektionHeader';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useViewport } from '../../components/useViewport';
import { speichereEinstellungen } from '../../api/einsaetze';
import { einsatzKeys } from '../../api/queryKeys';
import { RECHTE_TEXT, useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import {
  feldrasterStil,
  initialVerhalten,
  normalisiereVerhalten,
  orgHinweisAutoEtb,
  orgHinweisWert,
  speicherLeisteStil,
  zuUpdate,
  type FormWerteVerhalten,
} from './einsatzEinstellungenForm';

/** Tristate-Optionen für automatische ETB-Einträge (leer = erbt Org, true = An, false = Aus).
 *  Bleibt bewusst hier: diese Liste gibt es nur auf der Einsatz-Ebene. */
const AUTO_ETB_OPTIONEN: { value: boolean; label: string }[] = [
  { value: true, label: 'An' },
  { value: false, label: 'Aus' },
];

/**
 * Sektion `…/einstellungen/verhalten` (LFH-345 · C10) — Nummernkreise, Fristen, Auto-ETB.
 *
 * **Die einzige zweispaltige Sektion.** Neun Felder in einer Spalte sind eine lange Rolle;
 * „Allgemein" (5) und „Aufbewahrung" (1) bleiben einspaltig, zwei Spalten für ein Feld wären
 * Zierde. Die Schwelle ist `lg` und kommt aus `useViewport` — dem einzigen erlaubten Zugang
 * zu Breitenfragen (LFH-329 · B1). Das Raster selbst liegt als reine Funktion in
 * `einsatzEinstellungenForm`, damit die Ungleichheit über beide Breiten ohne Render prüfbar
 * ist (jsdom rechnet kein Layout).
 */
export default function EinsatzVerhalten() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteVerhalten>();
  const { token } = theme.useToken();
  const { abBreite } = useViewport();
  const daten = useEinstellungenDaten(einsatzId);

  // KEIN `onError`-Toast (H14) — der Fehler steht als Alert über dem Formular.
  const speichern = useMutation({
    mutationFn: (werte: FormWerteVerhalten) =>
      speichereEinstellungen(einsatzId, {
        ...zuUpdate(daten.einstellungen!),
        ...normalisiereVerhalten(werte),
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

  const einstellungen = daten.einstellungen;
  const orgDefaults = einstellungen.org_defaults;

  return (
    <>
      <SeitenHinweise
        fehler={speichern.error}
        rechteFehlt={daten.istAktiv && !daten.darfBearbeiten}
        rechteText={RECHTE_TEXT}
      />
      <Form<FormWerteVerhalten>
        form={form}
        layout="vertical"
        initialValues={initialVerhalten(einstellungen)}
        onFinish={(werte) => speichern.mutate(werte)}
        disabled={!daten.darfBearbeiten}
      >
        <SektionHeader
          titel="Verhalten & Automatik"
          beschreibung="Nummernkreise (Präfix + Startwert), Default-Fristen und automatische ETB-Einträge für diesen Einsatz. Präfixe sind reine Anzeige. Sobald die erste Nummer eines Kreises vergeben ist, sind Präfix und Startwert nicht mehr änderbar."
        />

        <div style={feldrasterStil(abBreite('lg'), token.margin)}>
          {(
            [
              {
                key: 'etb',
                label: 'ETB',
                eingefroren: einstellungen.etb_nummer_eingefroren,
                orgPraefix: orgDefaults?.etb_nummer_praefix,
              },
              {
                key: 'meldung',
                label: 'Meldungen',
                eingefroren: einstellungen.meldung_nummer_eingefroren,
                orgPraefix: orgDefaults?.meldung_nummer_praefix,
              },
              {
                key: 'auftrag',
                label: 'Aufträge',
                eingefroren: einstellungen.auftrag_nummer_eingefroren,
                orgPraefix: orgDefaults?.auftrag_nummer_praefix,
              },
            ] as const
          ).map((nk) => (
            // Präfix und Startwert eines Kreises gehören zusammen und bleiben deshalb auch
            // im Zweispalter EIN Rasterfeld — getrennt stünden sie in verschiedenen Spalten.
            <div
              key={nk.key}
              style={{ display: 'flex', gap: token.margin, alignItems: 'flex-start' }}
            >
              <Form.Item
                label={`Präfix ${nk.label}`}
                name={`${nk.key}_nummer_praefix`}
                style={{ flex: 1 }}
                tooltip="Wird der laufenden Nummer vorangestellt (z. B. EB-). Max. 8 Zeichen."
                extra={
                  nk.eingefroren
                    ? 'Erste Nummer bereits vergeben — nicht mehr änderbar'
                    : orgHinweisWert(nk.orgPraefix)
                }
              >
                <Input maxLength={8} placeholder="z. B. EB-" disabled={nk.eingefroren} />
              </Form.Item>
              <Form.Item
                label={`Startwert ${nk.label}`}
                name={`${nk.key}_nummer_start`}
                // `flex: 0 1 160px` statt `width: 160`: das Feld wandert mit diesem Umbau in
                // den Radius von `components/feldbreiten.guard.test.ts` (Bereich
                // `pages/einstellungen/`), und der Guard hat recht — eine feste Pixelbreite
                // ragt am schmalen Schirm über den Rand und drückt die Seite waagerecht breit.
                // Die Basis bleibt bei 160 px, aber `flex-shrink: 1` lässt sie darunter mitgehen.
                style={{ flex: '0 1 160px' }}
                tooltip="Erste laufende Nummer (Default 1)."
              >
                <InputNumber
                  min={1}
                  max={999999}
                  style={{ width: '100%' }}
                  placeholder="1"
                  disabled={nk.eingefroren}
                />
              </Form.Item>
            </div>
          ))}

          <Form.Item
            label="Default-Bestätigungsfrist Meldungen (Minuten)"
            name="meldung_bestaetigung_frist_min"
            tooltip="Frist für die Bestätigung pflichtiger Meldungen. Leer = projektweiter Standard."
            extra={orgHinweisWert(orgDefaults?.meldung_bestaetigung_frist_min, 'Min.')}
          >
            <InputNumber
              min={1}
              max={10080}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder="Standard"
            />
          </Form.Item>
          <Form.Item
            label="Default-Quittierfrist Aufträge (Minuten)"
            name="auftrag_quittierung_frist_min"
            tooltip="Frist für unquittierte Aufträge ohne explizite Frist. Leer = keine automatische Frist."
            extra={orgHinweisWert(orgDefaults?.auftrag_quittierung_frist_min, 'Min.')}
          >
            <InputNumber
              min={1}
              max={10080}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder="keine"
            />
          </Form.Item>
          <Form.Item
            label="Automatische ETB-Einträge"
            name="auto_etb_eintraege"
            tooltip="Meldungen und Aufträge erzeugen automatisch einen verknüpften ETB-Eintrag. Leer = Org-Standard erben."
            extra={orgHinweisAutoEtb(orgDefaults?.auto_etb_eintraege)}
          >
            <Select
              allowClear
              placeholder="Org-Standard"
              options={AUTO_ETB_OPTIONEN}
              style={{ width: '100%', maxWidth: 200 }}
            />
          </Form.Item>
        </div>

        <div style={speicherLeisteStil(token)}>
          <Button type="primary" htmlType="submit" loading={speichern.isPending}>
            Speichern
          </Button>
        </div>
      </Form>
    </>
  );
}
