import { useEffect, useState } from 'react';
import { Form } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateDisposition, type AdhocEingabe, type AngabenPatch } from '../api/einsatzFahrzeuge';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzFahrzeug } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import AdhocFahrzeugFelder from './AdhocFahrzeugFelder';
import { angabenVon, buildAngabenPatch, hatFehlerIn, type AdhocFeld } from './fahrzeugAngaben';

/** Im Modal stehen drei Felder sichtbar (Feldbudget LFH-19), der Rest im Klappteil. */
const WEITERE: readonly AdhocFeld[] = ['kennzeichen', 'opta'];

export interface FahrzeugAngabenDialogProps {
  einsatzId: number;
  /** Das Ad-hoc-Fahrzeug, dessen Angaben geändert werden; `null` = Dialog zu. */
  fahrzeug: EinsatzFahrzeug | null;
  onSchliessen: () => void;
}

/**
 * Dialog „Angaben ändern“ eines Ad-hoc-Fahrzeugs (LLH-1073, design.md D7): vorbelegt aus der Zeile
 * (`setFieldsValue`, kein Reset — das Leeren besitzt die Erfassungshülle), gesendet über den
 * Zeilen-PATCH nur, was sich geändert hat, leer als `null`. Ohne Änderung schließt der Dialog ohne
 * Anfrage. Eine Ablehnung steht im Dialog (`speicherung`); der Server schreibt den ETB-Eintrag.
 */
export default function FahrzeugAngabenDialog({
  einsatzId,
  fahrzeug,
  onSchliessen,
}: FahrzeugAngabenDialogProps) {
  const qc = useQueryClient();
  const [form] = Form.useForm<AdhocEingabe>();
  const [weitereOffen, setWeitereOffen] = useState(false);
  const offen = fahrzeug !== null;

  useEffect(() => {
    if (!fahrzeug) return;
    form.setFieldsValue(angabenVon(fahrzeug));
    setWeitereOffen(false);
  }, [fahrzeug, form]);

  const mutation = useMutation({
    mutationFn: (v: { efId: number; patch: AngabenPatch }) =>
      updateDisposition(einsatzId, v.efId, v.patch),
    onSuccess: (neu) => {
      qc.setQueryData<EinsatzFahrzeug[]>(einsatzKeys.fahrzeuge(einsatzId), (liste) =>
        liste?.map((ef) => (ef.id === neu.id ? neu : ef)),
      );
      // Der Funkrufname steht auch in Einheiten, Meldebild und ETB.
      void qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
  });

  return (
    <ErfassungsModal<AdhocEingabe>
      offen={offen}
      titel={fahrzeug ? `Angaben zu ${fahrzeug.funkrufname} ändern` : 'Angaben ändern'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Nicht geändert"
      speicherFehlerFallback="Ändern fehlgeschlagen"
      onPruefungGescheitert={(felder) => {
        if (hatFehlerIn(WEITERE, felder)) setWeitereOffen(true);
      }}
      onErfassen={async (werte) => {
        if (!fahrzeug) return;
        const patch = buildAngabenPatch(fahrzeug, werte);
        if (Object.keys(patch).length === 0) return;
        await mutation.mutateAsync({ efId: fahrzeug.id, patch });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <AdhocFahrzeugFelder
        weitere={WEITERE}
        weitereOffen={weitereOffen}
        onWeitereOffen={setWeitereOffen}
      />
    </ErfassungsModal>
  );
}
