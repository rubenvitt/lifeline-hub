import { Checkbox, Form, Input, Typography, theme } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { augenbraueStil, useRollen } from '../components/instrument';
import { aktualisiereEinsatzVorlage, legeEinsatzVorlageAn } from '../api/einsatzVorlagen';
import { EINSATZ_VORLAGE_BEZEICHNUNG_MAX } from '../api/eingabegrenzen';
import { globalKeys } from '../api/queryKeys';
import { fetchSchichtmodelle } from '../api/schichtmodelle';
import { mitVorgabe } from '../components/vorgabeText';
import type { Einsatzart, EinsatzVorlage, EinsatzVorlageEingabe } from '../api/types';
import { EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import { istModulAusblendbar, kategorien, moduleNachKategorie } from '../einsatz/modulRegistry';
import { ausgeblendetAus, sichtbarAus } from './einsatzVorlageModule';

interface FormWerte {
  bezeichnung: string;
  einsatzart?: Einsatzart | null;
  /** Schichtmodell der Organisation, das ein neuer Einsatz bekommt; leer = Vorgabe der Org. */
  schichtmodell_id?: number | null;
  /** Häkchen = sichtbar; gespeichert wird das Komplement (`ausgeblendetAus`). */
  sichtbar: string[];
}

/** Kurzwort an einem gesperrten Häkchen (LFH-1078: der Grund steht am Element, kein Tooltip). */
const IMMER_SICHTBAR = 'immer sichtbar';

/**
 * Häkchenliste der Module, gruppiert nach den Kategorien der Navigation (`kategorien`, dieselbe
 * Quelle wie die Icon-Rail). Ein `fieldset` je Kategorie, damit ein Screenreader die Gruppe nennt.
 * Nicht ausblendbare Module stehen angehakt und gesperrt, mit dem Grund als Kurzwort.
 */
function ModulHaekchen({
  id,
  value,
  onChange,
}: {
  id?: string;
  value?: string[];
  onChange?: (wert: string[]) => void;
}) {
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  return (
    // Die Hülle trägt die `id` des Form.Item (Ziel des Etiketts) und benennt die Gruppe.
    <div id={id} role="group" aria-label="Sichtbare Module">
      <Checkbox.Group
        value={value}
        onChange={(wert) => onChange?.(wert as string[])}
        style={{ display: 'block' }}
      >
        {kategorien.map((k) => (
          <fieldset
            key={k.key}
            data-kategorie={k.key}
            style={{ border: 0, margin: 0, padding: 0, marginBlockEnd: token.marginSM }}
          >
            <legend
              style={{ ...augenbraueStil(rollen), padding: 0, marginBlockEnd: token.marginXXS }}
            >
              {k.label}
            </legend>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                columnGap: token.marginSM,
              }}
            >
              {moduleNachKategorie(k.key).map((m) => {
                const ausblendbar = istModulAusblendbar(m.key);
                return (
                  <Checkbox key={m.key} value={m.key} disabled={!ausblendbar}>
                    <span>{m.label}</span>
                    {!ausblendbar && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: token.fontSizeSM, marginInlineStart: token.marginXS }}
                      >
                        {IMMER_SICHTBAR}
                      </Typography.Text>
                    )}
                  </Checkbox>
                );
              })}
            </div>
          </fieldset>
        ))}
      </Checkbox.Group>
    </div>
  );
}

/**
 * Anlegen und Bearbeiten einer Einsatz-Vorlage (LLH-1375, design.md D3a): Bezeichnung, Einsatzart
 * und die sichtbaren Module, drei Zeilen (Feldbudget eines Modals, LFH-19). Das Schichtmodell
 * (LLH-1313, design.md D6) steht als zweite Vorbelegung in der Zeile der Einsatzart, damit das
 * Budget hält; ohne Schichtmodelle in der Organisation fehlt es. Gespeichert wird als Vollersatz
 * mit dem Komplement der Häkchen als `ausgeblendet`.
 */
export default function EinsatzVorlageFormModal({
  offen,
  vorlage,
  onClose,
}: {
  offen: boolean;
  /** Die bearbeitete Vorlage; `null` legt an. */
  vorlage: EinsatzVorlage | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const { data: schichtmodelle = [] } = useQuery({
    queryKey: globalKeys.schichtmodelle(),
    queryFn: fetchSchichtmodelle,
    enabled: offen,
  });
  const orgVorgabe = schichtmodelle.find((m) => m.ist_vorgabe);

  // VORBELEGUNG, kein Zurücksetzen (Begründung in `FahrzeugFormModal`); die Werte einer neuen
  // Vorlage stehen als `initialValues` an der Hülle.
  useEffect(() => {
    if (!offen || !vorlage) return;
    form.setFieldsValue({
      bezeichnung: vorlage.bezeichnung,
      einsatzart: vorlage.einsatzart ?? undefined,
      schichtmodell_id: vorlage.schichtmodell_id ?? undefined,
      sichtbar: sichtbarAus(vorlage.ausgeblendet),
    });
  }, [offen, vorlage, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: EinsatzVorlageEingabe = {
        bezeichnung: werte.bezeichnung.trim(),
        einsatzart: werte.einsatzart ?? null,
        schichtmodell_id: werte.schichtmodell_id ?? null,
        ausgeblendet: ausgeblendetAus(werte.sichtbar ?? []),
      };
      return vorlage ? aktualisiereEinsatzVorlage(vorlage.id, daten) : legeEinsatzVorlageAn(daten);
    },
    // Kein `onClose()`: das Schließen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einsatzVorlagen() }),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={vorlage ? 'Einsatz-Vorlage bearbeiten' : 'Einsatz-Vorlage anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      // Kein `onError`-Toast: die Hülle nennt den Grund einer Ablehnung im Dialog (LFH-1077).
      speicherung={mutation}
      speicherFehlerTitel="Nicht gespeichert"
      initialValues={{ sichtbar: sichtbarAus([]) }}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen (LFH-332).
      onErfassen={(werte) => mutation.mutateAsync(werte)}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. Großbrand" maxLength={EINSATZ_VORLAGE_BEZEICHNUNG_MAX} />
      </Form.Item>
      <div
        data-lfh="vorlage-vorbelegung"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          columnGap: token.marginSM,
        }}
      >
        <Form.Item label="Einsatzart" name="einsatzart">
          <Select<Einsatzart>
            aria-label="Einsatzart"
            allowClear
            placeholder="keine"
            options={EINSATZART_OPTIONEN}
          />
        </Form.Item>
        {/* Immer registriert, nur ohne Modelle verborgen: solange die Liste lädt oder fehlt,
            behält der Vollersatz so den gespeicherten Wert, statt ihn still auf `null` zu setzen. */}
        <Form.Item
          label="Schichtmodell"
          name="schichtmodell_id"
          hidden={schichtmodelle.length === 0}
        >
          <Select<number>
            aria-label="Schichtmodell"
            allowClear
            placeholder={orgVorgabe ? mitVorgabe(orgVorgabe.bezeichnung) : 'keins'}
            options={schichtmodelle.map((m) => ({ value: m.id, label: m.bezeichnung }))}
          />
        </Form.Item>
      </div>
      <Form.Item label="Sichtbare Module" name="sichtbar">
        <ModulHaekchen />
      </Form.Item>
    </ErfassungsModal>
  );
}
