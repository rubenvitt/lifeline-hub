import { App, Form, Input } from 'antd';
import { EinsatzOrtsfeld } from '../../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../../anzeige/Ortsfeld';
import { ortFelder, ortsfeldAusGespeichert } from '../../anzeige/ortsfeldFormular';
import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../../components/Erfassung';
import { aktualisiereUhs, type UhsPatch } from '../../api/einsatzUhs';
import { leerZuNull } from '../../api/patchTriState';
import { einsatzKeys } from '../../api/queryKeys';
import type { Uhs } from '../../api/types';

interface FormWerte {
  bezeichnung: string;
  /** Ortsfeld (LLH-1114): Text und Koordinate des Standorts. */
  standort?: OrtsfeldWert;
  notiz?: string;
}

/**
 * Nur die geänderten Felder (LLH-1407, Muster `brPatchAus`), gemessen am Stand beim ÖFFNEN
 * (`basis`): der PATCH ist ein Teil-Patch, fehlender Key = unverändert. Leer heißt löschen
 * (`null`); der Server trimmt ebenso. Die Koordinate des Standorts geht nur als Paar und nur bei
 * einer Änderung hinaus; ein geleerter Standort leert sie mit (`ortFelder`).
 */
export function uhsPatchAus(basis: Uhs, werte: FormWerte): UhsPatch {
  const patch: UhsPatch = {};
  const bezeichnung = werte.bezeichnung.trim();
  if (bezeichnung !== basis.bezeichnung) patch.bezeichnung = bezeichnung;
  const ort = ortFelder(werte.standort);
  if (ort.text !== (basis.standort ?? null)) patch.standort = ort.text;
  if (ort.lat !== (basis.lat ?? null) || ort.lon !== (basis.lon ?? null)) {
    patch.lat = ort.lat;
    patch.lon = ort.lon;
  }
  const notiz = leerZuNull(werte.notiz);
  if (notiz !== (basis.notiz ?? null)) patch.notiz = notiz;
  return patch;
}

/**
 * Stammdaten einer Unfallhilfsstelle ändern: Bezeichnung, Standort, Notiz (LLH-1407). Drei
 * Felder, also Modal (`frontend/AGENTS.md`, „UI-Form-Leitlinie“), dieselben Felder wie
 * `UhsAnlegenDrawer` ohne den Typ. Der Abschnitt bleibt außen vor: auch das Anlegen bietet ihn
 * nicht an.
 */
export default function UhsBearbeitenModal({
  einsatzId,
  uhs,
  offen,
  onClose,
}: {
  einsatzId: number;
  uhs: Uhs;
  offen: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  /*
   * VORBELEGUNG nur beim Öffnen, kein Zurücksetzen: das Leeren macht `ErfassungsModal` auf allen
   * vier Auswegen. `uhs` kommt live (SSE): jede Belegung lädt das Detail neu. Ein zweites
   * `setFieldsValue` überschriebe still, was hier gerade getippt wird.
   */
  const basis = useRef<Uhs | null>(null);
  useEffect(() => {
    if (!offen) {
      basis.current = null;
      return;
    }
    if (basis.current != null) return;
    basis.current = uhs;
    form.setFieldsValue({
      bezeichnung: uhs.bezeichnung,
      standort: ortsfeldAusGespeichert(uhs.standort, uhs.lat, uhs.lon),
      notiz: uhs.notiz ?? undefined,
    });
  }, [offen, uhs, form]);

  // Kein `onError`-Toast: den Grund nennt die Hülle im Dialog (`speicherung`, LFH-1077).
  const mutation = useMutation({
    mutationFn: (patch: UhsPatch) => aktualisiereUhs(einsatzId, uhs.id, patch),
    onSuccess: () => {
      message.success('Unfallhilfsstelle gespeichert');
      qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) });
      // Der Lagemonitor nennt die UHS mit Namen und Punkt.
      qc.invalidateQueries({ queryKey: einsatzKeys.lagemonitor(einsatzId) });
    },
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Unfallhilfsstelle bearbeiten"
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      speicherung={mutation}
      // `mutateAsync`: bei Ablehnung bricht die Zusage, die Felder bleiben stehen. Ohne Änderung
      // geht nichts an den Server.
      onErfassen={async (w) => {
        const patch = uhsPatchAus(basis.current ?? uhs, w);
        if (Object.keys(patch).length > 0) await mutation.mutateAsync(patch);
      }}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung erforderlich' }]}
      >
        <Input placeholder="z. B. BHP 50" />
      </Form.Item>
      <Form.Item label="Standort (optional)" name="standort">
        <EinsatzOrtsfeld einsatzId={einsatzId} etikett="Standort" exclude={`uhs:${uhs.id}`} />
      </Form.Item>
      <Form.Item label="Notiz (optional)" name="notiz">
        <Input.TextArea rows={3} />
      </Form.Item>
    </ErfassungsModal>
  );
}
