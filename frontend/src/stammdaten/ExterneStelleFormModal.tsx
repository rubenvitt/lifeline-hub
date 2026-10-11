import { Checkbox, Collapse, Form, Input } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { aendereExterneStelle, legeExterneStelleAn } from '../api/externeStellen';
import type { ExterneStelle, ExterneStelleArt } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import { EXTERNE_STELLE_BEZEICHNUNG_MAX, EXTERNE_STELLE_KURZ_MAX } from '../api/eingabegrenzen';
import { EXTERNE_STELLE_ARTEN, EXTERNE_STELLE_ART_LABEL } from './externeStellenVorschlaege';

interface FormWerte {
  bezeichnung: string;
  art: ExterneStelleArt;
  zustaendig?: boolean;
  rufnummer?: string;
  funkrufname?: string;
}

const ART_OPTIONEN = EXTERNE_STELLE_ARTEN.map((art) => ({
  value: art,
  label: EXTERNE_STELLE_ART_LABEL[art],
}));

/**
 * Ein nicht montiertes Feld (Klappteil zu) fehlt in den Werten: `undefined` heißt „nicht
 * angefasst“ und bleibt im PATCH weg, statt den Bestand zu leeren.
 */
function kurzfeld(wert: string | undefined): string | null | undefined {
  return wert === undefined ? undefined : leerZuNull(wert);
}

/** Anlegen und Bearbeiten einer externen Stelle (LFH-1194, design.md D10). */
export default function ExterneStelleFormModal({
  offen,
  stelle,
  onClose,
}: {
  offen: boolean;
  stelle: ExterneStelle | null; // null = neu
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const art = Form.useWatch('art', form);

  // VORBELEGUNG, kein Zurücksetzen — Begründung in `FahrzeugFormModal` (LFH-346/A6).
  useEffect(() => {
    if (!offen || !stelle) return;
    form.setFieldsValue({
      bezeichnung: stelle.bezeichnung,
      art: stelle.art,
      zustaendig: stelle.zustaendig,
      rufnummer: stelle.rufnummer ?? undefined,
      funkrufname: stelle.funkrufname ?? undefined,
    });
  }, [offen, stelle, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      // Die Checkbox steht nur bei Art Leitstelle; bei jeder anderen Art ist die Stelle nie
      // zuständig, auch wenn sie es vor dem Artwechsel war.
      const zustaendig = werte.art === 'leitstelle' && werte.zustaendig === true;
      const daten = {
        bezeichnung: werte.bezeichnung.trim(),
        art: werte.art,
        zustaendig,
        rufnummer: kurzfeld(werte.rufnummer),
        funkrufname: kurzfeld(werte.funkrufname),
      };
      return stelle ? aendereExterneStelle(stelle.id, daten) : legeExterneStelleAn(daten);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.externeStellen() }),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={stelle ? 'Externe Stelle bearbeiten' : 'Externe Stelle anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      speicherung={mutation}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen (LFH-332).
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. ILS Musterkreis" maxLength={EXTERNE_STELLE_BEZEICHNUNG_MAX} />
      </Form.Item>
      <Form.Item
        label="Art"
        name="art"
        rules={[{ required: true, message: 'Art ist erforderlich' }]}
      >
        <Select<ExterneStelleArt> aria-label="Art" options={ART_OPTIONEN} />
      </Form.Item>
      {art === 'leitstelle' && (
        <Form.Item
          name="zustaendig"
          valuePropName="checked"
          extra="Vorgabe für den Adressaten einer Nachforderung. Ist schon eine andere Leitstelle zuständig, verliert sie die Markierung."
        >
          <Checkbox>Zuständige Leitstelle</Checkbox>
        </Form.Item>
      )}
      {/* Feldbudget (LFH-19): Bezeichnung und Art offen (bei Leitstelle dazu die Markierung),
         Rufnummer und Funkrufname zugeklappt. Trägt die Stelle schon eines davon, steht der
         Bereich offen (je Stelle neu montiert, `key`). Nicht montierte Felder bleiben im PATCH
         weg (`kurzfeld`). Kurze Felder: natives `maxLength` aus dem Grenzspiegel. */}
      <Collapse
        key={stelle?.id ?? 'neu'}
        ghost
        style={{ marginInline: -8 }}
        defaultActiveKey={stelle?.rufnummer || stelle?.funkrufname ? ['kontakt'] : []}
        items={[
          {
            key: 'kontakt',
            label: 'Rufnummer und Funkrufname',
            children: (
              <>
                <Form.Item label="Rufnummer" name="rufnummer">
                  <Input maxLength={EXTERNE_STELLE_KURZ_MAX} />
                </Form.Item>
                <Form.Item label="Funkrufname" name="funkrufname">
                  <Input
                    placeholder="z. B. Leitstelle Musterkreis"
                    maxLength={EXTERNE_STELLE_KURZ_MAX}
                  />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
