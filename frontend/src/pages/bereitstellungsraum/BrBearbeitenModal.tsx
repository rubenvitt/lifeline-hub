import { App, Form, Input } from 'antd';
import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../../components/Erfassung';
import { aktualisiereBr, type BrPatch } from '../../api/einsatzBereitstellungsraum';
import { leerZuNull } from '../../api/patchTriState';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum } from '../../api/types';

interface FormWerte {
  bezeichnung: string;
  standort?: string;
  notiz?: string;
}

/**
 * Nur die geänderten Felder (LFH-1147), gemessen am Stand beim ÖFFNEN (`basis`): der PATCH ist ein
 * Teil-Patch, fehlender Key = unverändert. Wer nur die Notiz ändert, überschreibt so nicht den
 * Standort, den ein anderer Arbeitsplatz inzwischen gesetzt hat. Leer heißt löschen (`null`); der
 * Server trimmt ebenso.
 */
export function brPatchAus(basis: Bereitstellungsraum, werte: FormWerte): BrPatch {
  const patch: BrPatch = {};
  const bezeichnung = werte.bezeichnung.trim();
  if (bezeichnung !== basis.bezeichnung) patch.bezeichnung = bezeichnung;
  const standort = leerZuNull(werte.standort);
  if (standort !== (basis.standort ?? null)) patch.standort = standort;
  const notiz = leerZuNull(werte.notiz);
  if (notiz !== (basis.notiz ?? null)) patch.notiz = notiz;
  return patch;
}

/**
 * Raumdaten eines Bereitstellungsraums ändern: Bezeichnung, Standort, Notiz (LFH-1147). Drei
 * Felder, also Modal (`frontend/AGENTS.md`, „UI-Form-Leitlinie“), dieselben Felder wie
 * `BrAnlegenDrawer`. Der Abschnitt bleibt außen vor: auch das Anlegen bietet ihn nicht an.
 */
export default function BrBearbeitenModal({
  einsatzId,
  br,
  offen,
  onClose,
}: {
  einsatzId: number;
  br: Bereitstellungsraum;
  offen: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  /*
   * VORBELEGUNG nur beim Öffnen, kein Zurücksetzen: das Leeren macht `ErfassungsModal` auf allen
   * vier Auswegen. `br` kommt live (SSE): jede Belegung lädt den Raum neu. Ein zweites
   * `setFieldsValue` überschriebe still, was hier gerade getippt wird.
   */
  const basis = useRef<Bereitstellungsraum | null>(null);
  useEffect(() => {
    if (!offen) {
      basis.current = null;
      return;
    }
    if (basis.current != null) return;
    basis.current = br;
    form.setFieldsValue({
      bezeichnung: br.bezeichnung,
      standort: br.standort ?? undefined,
      notiz: br.notiz ?? undefined,
    });
  }, [offen, br, form]);

  // Kein `onError`-Toast: den Grund nennt die Hülle im Dialog (`speicherung`, LFH-1077).
  const mutation = useMutation({
    mutationFn: (patch: BrPatch) => aktualisiereBr(einsatzId, br.id, patch),
    onSuccess: () => {
      message.success('Bereitstellungsraum gespeichert');
      qc.invalidateQueries({ queryKey: einsatzKeys.br(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, br.id) });
      // Die Gerätekopplungen nennen den Raum mit Namen (Einstellungen › Geräte).
      qc.invalidateQueries({ queryKey: einsatzKeys.geraete(einsatzId) });
    },
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Bereitstellungsraum bearbeiten"
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      speicherung={mutation}
      // `mutateAsync`: bei Ablehnung bricht die Zusage, die Felder bleiben stehen. Ohne Änderung
      // geht nichts an den Server.
      onErfassen={async (w) => {
        const patch = brPatchAus(basis.current ?? br, w);
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
        <Input placeholder="z. B. BR Ost" />
      </Form.Item>
      <Form.Item label="Standort (optional)" name="standort">
        <Input placeholder="Adresse / Hinweis" />
      </Form.Item>
      <Form.Item label="Notiz (optional)" name="notiz">
        <Input.TextArea rows={3} />
      </Form.Item>
    </ErfassungsModal>
  );
}
