import { App, AutoComplete, Form, Input } from 'antd';
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
      onErfassen={(w) => mutation.mutateAsync(w)}
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
      <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input /></Form.Item>
      <Form.Item label="Standort" name="standort"><Input placeholder="z. B. Lagerhalle 2" /></Form.Item>
      <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
    </ErfassungsModal>
  );
}
