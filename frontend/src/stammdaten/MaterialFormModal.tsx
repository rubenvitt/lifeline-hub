import { App, AutoComplete, Collapse, Form, Input } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereMaterial, legeMaterialAn, type MaterialEingabe } from '../api/material';
import type { Material } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';

interface FormWerte {
  bezeichnung: string;
  kategorie?: string;
  bestandsnummer?: string;
  traegerorganisation?: string;
  standort?: string;
  bemerkung?: string;
}

export default function MaterialFormModal({
  offen,
  material,
  kategorien,
  onClose,
}: {
  offen: boolean;
  material: Material | null; // null = neu
  kategorien: string[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  // VORBELEGUNG, kein Zurücksetzen — Begründung in `FahrzeugFormModal` (LFH-346/A6).
  useEffect(() => {
    if (!offen || !material) return;
    form.setFieldsValue({
      bezeichnung: material.bezeichnung,
      kategorie: material.kategorie ?? undefined,
      bestandsnummer: material.bestandsnummer ?? undefined,
      traegerorganisation: material.traegerorganisation ?? undefined,
      standort: material.standort ?? undefined,
      bemerkung: material.bemerkung ?? undefined,
    });
  }, [offen, material, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: MaterialEingabe = {
        bezeichnung: werte.bezeichnung.trim(),
        kategorie: leerZuNull(werte.kategorie),
        bestandsnummer: leerZuNull(werte.bestandsnummer),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        standort: leerZuNull(werte.standort),
        bemerkung: leerZuNull(werte.bemerkung),
      };
      return material ? aktualisiereMaterial(material.id, daten) : legeMaterialAn(daten);
    },
    // Kein `onClose()` mehr: das Schliessen macht `onFertig`. Hier stehengelassen
    // schlösse es den Dialog auch beim „Speichern und nächstes".
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.material() });
      qc.invalidateQueries({ queryKey: globalKeys.materialKategorien() });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={material ? 'Material bearbeiten' : 'Material anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      // Nur im ANLEGEN-Modus — beim Bearbeiten wäre „Speichern und nächste" ein toter Knopf.
      serie={material == null}
      // Bestandsnummer und Bezeichnung sind je Gegenstand verschieden; Träger und
      // Standort bleiben über eine Erfassungsserie hinweg gleich.
      uebernahme={['traegerorganisation', 'standort']}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen, sonst leert die Hülle
      // die Felder trotz 422 (LFH-332).
      //
      // Der Formularspeicher statt der `onFinish`-Werte (LFH-346 · A8): ohne
      // `forceRender` sind Träger, Standort und Bemerkung nicht montiert, und
      // `onFinish` liefert nur montierte Felder. `MaterialEingabe` ist Vollersatz —
      // ein bearbeitetes Material verlöre die drei bei jedem Speichern, an dem
      // niemand aufgeklappt hat. Ein Rückfall auf `material?.standort` wäre die
      // falsche Reparatur: er kann „nie montiert" nicht von „aufgeklappt und bewusst
      // geleert" unterscheiden. `getFieldsValue(true)` liest den Speicher ganz aus.
      //
      // Beachten: `getFieldsValue(true)` ist bei antd `any`-typisiert — die Feldnamen
      // prüft nicht dieser Aufruf, sondern der Parametertyp von `mutationFn`.
      onErfassen={() => mutation.mutateAsync(form.getFieldsValue(true))}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. Wolldecke, Stromerzeuger 5 kVA" />
      </Form.Item>
      <Form.Item label="Kategorie" name="kategorie">
        <AutoComplete
          options={kategorien.map((k) => ({ value: k }))}
          allowClear
          placeholder="z. B. Betreuung, Sanität, Hochwasser"
          showSearch={{
            filterOption: (input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
          }}
        />
      </Form.Item>
      <Form.Item label="Bestandsnummer" name="bestandsnummer">
        <Input placeholder="Inventarnr. (nur für einzeln verfolgte Geräte)" />
      </Form.Item>
      {/* FELDBUDGET (LFH-346 · A8, Befund N20): drei sichtbare Felder, drei eingeklappt.
          Pflicht ist allein die Bezeichnung, und die steht oben — kein Pflichtfeld
          wandert hinter den Collapse (LFH-343 · H49).

          Bewusst OHNE `forceRender` (wie `AuftragFormular`): nur wenn die
          eingeklappten Felder gar nicht im DOM stehen, ist „im Ausgangszustand drei
          Felder" prüfbar. Den Preis dafür — unmontierte Felder fehlen in `onFinish` —
          zahlt das `onErfassen` oben, nicht `forceRender`.

          Träger und Standort sind zugleich die Wiederholfelder des Serienlaufs
          (`uebernahme`). Das passt zusammen: wer sie in einer Serie stehen lassen
          will, hat sie im ersten Datensatz eingetragen — und dafür aufgeklappt.
          Danach bleibt der Bereich offen, ein `resetFields` schliesst ihn nicht. */}
      <Collapse
        ghost
        style={{ marginInline: -8 }}
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            children: (
              <>
                <Form.Item label="Trägerorganisation" name="traegerorganisation">
                  <Input />
                </Form.Item>
                <Form.Item label="Standort" name="standort">
                  <Input placeholder="z. B. Lagerhalle 2" />
                </Form.Item>
                <Form.Item label="Bemerkung" name="bemerkung">
                  <Input.TextArea rows={2} />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
