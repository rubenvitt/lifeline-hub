import { AutoComplete, Collapse, Form, Input } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereMaterial, legeMaterialAn, type MaterialEingabe } from '../api/material';
import type { Material, MaterialArt } from '../api/types';
import { Segmentleiste } from '../components/instrument';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import { teilwortSuche } from '../components/teilwortSuche';
import { ART_OPTIONEN } from '../kraefte/materialPosten';
import { MATERIAL_STAMM_BEMERKUNG_MAX, MATERIAL_STAMM_TEXT_MAX } from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';

interface FormWerte {
  bezeichnung: string;
  art?: MaterialArt;
  kategorie?: string;
  bestandsnummer?: string;
  traegerorganisation?: string;
  standort?: string;
  bemerkung?: string;
}

/**
 * Grenze eines kurzen Felds wie beim Server (Spec `eingabegrenzen`, LLH-1258): `maxLength` beim
 * Tippen, die Regel für einen vorbelegten Wert, der schon darüber steht — er wird nie gekürzt
 * (`frontend/AGENTS.md`, „Freitext nie länger als der Server erlaubt“).
 */
const kurzRegel = (feld: string) => zeichenRegel(MATERIAL_STAMM_TEXT_MAX, feld);

/** Vorgabe der Art: ein einzeln verfolgtes Gerät (D1). */
const ART_VORGABE: MaterialArt = 'geraet';

/** Die Segmentleiste als Formularfeld: `Form.Item` reicht `value`/`onChange` hinein. */
function ArtFeld({
  value,
  onChange,
}: {
  value?: MaterialArt;
  onChange?: (art: MaterialArt) => void;
}) {
  return (
    <Segmentleiste<MaterialArt>
      beschriftung="Art"
      wert={value ?? ART_VORGABE}
      onWechsel={(art) => onChange?.(art)}
      optionen={ART_OPTIONEN}
    />
  );
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

  // VORBELEGUNG, kein Zurücksetzen — Begründung in `FahrzeugFormModal`.
  useEffect(() => {
    if (!offen || !material) return;
    form.setFieldsValue({
      bezeichnung: material.bezeichnung,
      art: material.art,
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
        art: werte.art ?? ART_VORGABE,
        kategorie: leerZuNull(werte.kategorie),
        bestandsnummer: leerZuNull(werte.bestandsnummer),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        standort: leerZuNull(werte.standort),
        bemerkung: leerZuNull(werte.bemerkung),
      };
      return material ? aktualisiereMaterial(material.id, daten) : legeMaterialAn(daten);
    },
    // Kein `onClose()`: das Schließen macht `onFertig`. Hier schlösse es den Dialog auch bei
    // „Speichern und nächstes".
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.material() });
      qc.invalidateQueries({ queryKey: globalKeys.materialKategorien() });
    },
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={material ? 'Material bearbeiten' : 'Material anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      // Kein `onError`-Toast: die Hülle nennt den Grund einer Ablehnung im Dialog
      // (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077).
      speicherung={mutation}
      // Nur im ANLEGEN-Modus — beim Bearbeiten wäre „Speichern und nächste" ein toter Knopf.
      serie={material == null}
      // Bestandsnummer und Bezeichnung sind je Gegenstand verschieden; Art, Träger und
      // Standort bleiben über eine Erfassungsserie hinweg gleich.
      uebernahme={['art', 'traegerorganisation', 'standort']}
      initialValues={{ art: ART_VORGABE }}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen, sonst leert die Hülle die Felder
      // trotz 422.
      //
      // Der Formularspeicher statt der `onFinish`-Werte: ohne `forceRender` sind Träger, Standort
      // und Bemerkung nicht montiert, und `onFinish` liefert nur montierte Felder. `MaterialEingabe`
      // ist Vollersatz — ein bearbeitetes Material verlöre die drei bei jedem Speichern ohne
      // Aufklappen. Ein Rückfall auf `material?.standort` wäre die falsche Reparatur: er kann „nie
      // montiert" nicht von „bewusst geleert" unterscheiden.
      //
      // `getFieldsValue(true)` ist bei antd `any`-typisiert — die Feldnamen prüft der Parametertyp
      // von `mutationFn`.
      onErfassen={() => mutation.mutateAsync(form.getFieldsValue(true))}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[
          { required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' },
          kurzRegel('Bezeichnung'),
        ]}
      >
        <Input
          placeholder="z. B. Wolldecke, Stromerzeuger 5 kVA"
          maxLength={MATERIAL_STAMM_TEXT_MAX}
        />
      </Form.Item>
      {/* Die Art entscheidet, wie der Posten im Einsatz steht (LLH-1224 D1/D16): sie gilt für neue
          Dispositionen, nie rückwirkend. Ohne das Feld ließe sich kein Verbrauchsgut anlegen. */}
      <Form.Item label="Art" name="art">
        <ArtFeld />
      </Form.Item>
      <Form.Item label="Kategorie" name="kategorie" rules={[kurzRegel('Kategorie')]}>
        <AutoComplete
          options={kategorien.map((k) => ({ value: k }))}
          allowClear
          maxLength={MATERIAL_STAMM_TEXT_MAX}
          placeholder="z. B. Betreuung, Sanität, Hochwasser"
          showSearch={teilwortSuche}
        />
      </Form.Item>
      <Form.Item label="Bestandsnummer" name="bestandsnummer" rules={[kurzRegel('Bestandsnummer')]}>
        <Input placeholder="Inventarnr. (optional)" maxLength={MATERIAL_STAMM_TEXT_MAX} />
      </Form.Item>
      {/* FELDBUDGET: vier sichtbare Felder (mit der Art, LLH-1224), drei eingeklappt. Pflicht ist allein die Bezeichnung,
         und die steht oben — kein Pflichtfeld wandert hinter den Collapse (LFH-343).

         Bewusst OHNE `forceRender` (wie `AuftragFormular`): nur so ist „im Ausgangszustand drei
         Felder" prüfbar. Der Preis — unmontierte Felder fehlen in `onFinish` — ist am `onErfassen`
         oben bezahlt.

         Träger und Standort sind zugleich die Wiederholfelder des Serienlaufs: wer sie stehen lassen
         will, hat sie im ersten Datensatz eingetragen und dafür aufgeklappt. Danach bleibt der
         Bereich offen, ein `resetFields` schließt ihn nicht. */}
      <Collapse
        ghost
        style={{ marginInline: -8 }}
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            children: (
              <>
                <Form.Item
                  label="Trägerorganisation"
                  name="traegerorganisation"
                  rules={[kurzRegel('Trägerorganisation')]}
                >
                  <Input maxLength={MATERIAL_STAMM_TEXT_MAX} />
                </Form.Item>
                <Form.Item label="Standort" name="standort" rules={[kurzRegel('Standort')]}>
                  <Input placeholder="z. B. Lagerhalle 2" maxLength={MATERIAL_STAMM_TEXT_MAX} />
                </Form.Item>
                <Form.Item
                  label="Bemerkung"
                  name="bemerkung"
                  rules={[zeichenRegel(MATERIAL_STAMM_BEMERKUNG_MAX, 'Bemerkung')]}
                >
                  <Input.TextArea rows={2} count={zeichenGrenze(MATERIAL_STAMM_BEMERKUNG_MAX)} />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
