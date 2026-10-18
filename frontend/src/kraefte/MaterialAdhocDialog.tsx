import { App, Collapse, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { disponiereAdhoc, type MaterialAdhocEingabe } from '../api/einsatzMaterial';
import { MATERIAL_ADHOC_TEXT_MAX } from '../api/eingabegrenzen';
import { einsatzKeys } from '../api/queryKeys';
import type { MaterialArt } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Segmentleiste } from '../components/instrument';
import { MengenFeld } from '../components/MengenFeld';
import { Select } from '../components/Select';
import type { buildOrtOptions } from './materialOrtWahl';
import {
  ART_OPTIONEN,
  OHNE_ORT_WERT,
  ortPatch,
  ortPostFields,
  parseOrtValue,
  type MaterialOrtRef,
} from './materialPosten';

/**
 * Erfassung von Ad-hoc-Material ohne Stammeintrag (LLH-1133, design.md D4; vorher in
 * `pages/MaterialPage.tsx`, LLH-1225 D6/D7). EIN Dialog für die Materialliste und für jeden Ort,
 * der sein Material mit `MaterialAmOrt` zeigt (Spec `material-am-ort`, „Material am Ort
 * erfassen“):
 *
 * - Mit festem `ort` (Einheit, Fahrzeug, UHS, Bereitstellungsraum) fehlt das Feld „Ort“; der
 *   Posten geht mit dem Ort-Feld des Orts in EINEM `POST …/material` an, ohne zweiten Schritt.
 * - Ohne festen Ort (Materialliste) steht „Ort“ unter „Weitere Angaben“ (Feldbudget, LLH-1093
 *   D12) mit den Optionen des Aufrufers, Vorgabe „ohne Ort“.
 *
 * Die Art folgt ohne eigene Wahl der Menge (über 1 → Verbrauchsgut, sonst Gerät, wie der Server);
 * gesendet wird, was steht. „Gerät“ setzt die Menge auf 1 und sperrt sie (LLH-1224 D2).
 *
 * Feldbudget: höchstens vier sichtbare Felder. Bezeichnung und Menge zuerst (sie ändern sich je
 * Position), Kategorie und Trägerorganisation bleiben über eine Anlieferung gleich. Die
 * Bestandsnummer gibt es bei Spenden und Fremdmaterial meist nicht; sie liegt unter „Weitere
 * Angaben“. `forceRender` registriert die Felder dort ab dem ersten Bild im Formular.
 */

/** Werte des Dialogs: `art` bleibt leer, bis die Person wählt (LLH-1225 D6). */
type AdhocWerte = MaterialAdhocEingabe & { menge: number; art?: MaterialArt; ort?: string };

/** Vorgabe der Art wie am Server (LLH-1224 D1): Menge über 1 → Verbrauchsgut, sonst Gerät. */
function artVorgabe(menge: number | null | undefined): MaterialArt {
  return (menge ?? 1) > 1 ? 'verbrauchsgut' : 'geraet';
}

/** Die Segmente „Art“; ohne eigene Wahl zeigen sie die Vorgabe der Menge. */
function ArtFeld({
  value,
  onChange,
  vorgabe,
}: {
  value?: MaterialArt;
  onChange?: (art: MaterialArt) => void;
  vorgabe: MaterialArt;
}) {
  return (
    <Segmentleiste<MaterialArt>
      beschriftung="Art"
      wert={value ?? vorgabe}
      onWechsel={(art) => onChange?.(art)}
      optionen={ART_OPTIONEN}
    />
  );
}

export interface MaterialAdhocDialogProps {
  einsatzId: number;
  offen: boolean;
  onSchliessen: () => void;
  /** Fester Ort (Material am Ort): kein Feld „Ort“, der Posten geht in einem Request dorthin. */
  ort?: MaterialOrtRef;
  /** Ohne festen Ort: die Optionen des Felds „Ort“ (Materialliste). */
  ortOptionen?: ReturnType<typeof buildOrtOptions>;
}

export default function MaterialAdhocDialog({
  einsatzId,
  offen,
  onSchliessen,
  ort,
  ortOptionen = [],
}: MaterialAdhocDialogProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<AdhocWerte>();

  // Ohne eigene Wahl folgt die Art der Menge; „Gerät“ setzt die Menge auf 1 und sperrt.
  const menge = Form.useWatch('menge', form);
  const isGeraet = Form.useWatch('art', form) === 'geraet';
  useEffect(() => {
    if (isGeraet) form.setFieldValue('menge', 1);
  }, [isGeraet, form]);

  const mutation = useMutation({
    mutationFn: (w: AdhocWerte) => {
      // Gesendet wird die angezeigte Art, auch die Vorgabe (D6); ein Gerät steht je Stück.
      const art = w.art ?? artVorgabe(w.menge);
      return disponiereAdhoc(
        einsatzId,
        {
          bezeichnung: w.bezeichnung,
          kategorie: w.kategorie,
          bestandsnummer: w.bestandsnummer,
          traegerorganisation: w.traegerorganisation,
        },
        art === 'geraet' ? 1 : (w.menge ?? 1),
        { art, ort: ort ? (ortPatch(ort, null) ?? undefined) : ortPostFields(w.ort) },
      );
    },
    // Nur abgleichen und melden: geschlossen wird über `onFertig`, geleert von der Erfassungshülle
    // auf allen Wegen, auch beim Abbrechen. Der Zielort trägt sein Material im DTO bzw. Detail.
    onSuccess: (_d, w) => {
      const ziel = ort ?? (w.ort ? parseOrtValue(w.ort) : null);
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      if (ziel?.art === 'uhs') {
        void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
        void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, ziel.id) });
      } else if (ziel?.art === 'bereitstellungsraum') {
        void qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, ziel.id) });
      }
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
      message.success('Ad-hoc-Material disponiert');
    },
  });

  return (
    <ErfassungsModal<AdhocWerte>
      offen={offen}
      titel="Ad-hoc-Material ohne Stammeintrag"
      form={form}
      erfassenText="Disponieren"
      serie
      uebernahme={['kategorie', 'traegerorganisation']}
      initialValues={ort ? { menge: 1 } : { menge: 1, ort: OHNE_ORT_WERT }}
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Nicht disponiert"
      speicherFehlerFallback="Disponieren fehlgeschlagen"
      // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage lässt die Hülle die Werte
      // stehen. Den Grund zeigt die Hülle über `speicherung`.
      onErfassen={async (w) => {
        await mutation.mutateAsync(w);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true }]}
      >
        <Input placeholder="z. B. Spende-Decken" maxLength={MATERIAL_ADHOC_TEXT_MAX} />
      </Form.Item>
      <Form.Item
        label="Menge"
        name="menge"
        rules={[{ required: true }]}
        extra={isGeraet ? 'Ein Gerät steht je Stück im Einsatz' : undefined}
      >
        <MengenFeld beschriftung="Menge" style={{ width: 120 }} disabled={isGeraet} />
      </Form.Item>
      {/* Art (LLH-1225 D6): ohne eigene Wahl zeigt sie die Vorgabe der Menge, gesendet wird,
          was steht. */}
      <Form.Item label="Art" name="art">
        <ArtFeld vorgabe={artVorgabe(menge)} />
      </Form.Item>
      <Form.Item label="Kategorie" name="kategorie">
        <Input maxLength={MATERIAL_ADHOC_TEXT_MAX} />
      </Form.Item>
      <Collapse
        ghost
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            forceRender: true,
            children: (
              <>
                <Form.Item label="Trägerorganisation" name="traegerorganisation">
                  <Input placeholder="z. B. THW" maxLength={MATERIAL_ADHOC_TEXT_MAX} />
                </Form.Item>
                <Form.Item
                  label="Bestandsnummer"
                  name="bestandsnummer"
                  style={ort ? { marginBottom: 0 } : undefined}
                >
                  <Input maxLength={MATERIAL_ADHOC_TEXT_MAX} />
                </Form.Item>
                {/* Ort (D7) unter „Weitere Angaben“ (Feldbudget, 1093 D12); am Ort steht er fest. */}
                {!ort && (
                  <Form.Item label="Ort" name="ort" style={{ marginBottom: 0 }}>
                    <Select<string> options={ortOptionen} />
                  </Form.Item>
                )}
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
