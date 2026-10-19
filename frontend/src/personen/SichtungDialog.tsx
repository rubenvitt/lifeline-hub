import { Form, Input } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { SichtungEingabe } from '../api/einsatzPerson';
import type { Sichtungskategorie } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import BestaetigtVonFeld from '../geraet/BestaetigtVonFeld';
import SichtungsWahl from './SichtungsWahl';
import { useSavePersonEintrag, type PersonZiel } from './personEintragSpeichern';

export interface SichtungWerte {
  kategorie: Sichtungskategorie;
  notiz?: string;
  /** Nur am UHS-Gerät (LFH-1046). */
  bestaetigt_personal_id?: number;
}

/**
 * Die Felder einer Nachsichtung — ohne eigenes `<Form>`, für zwei Hüllen: diesen Dialog
 * (Grundriss, Gerät) und die Fassung in der Ansicht (Patientenkopf, LLH-1094). Für die Wahl der
 * Kategorie gibt es kein Dropdown (LLH-1083, Spec `sichtungswahl`): eine Fläche, dann „Übernehmen“.
 */
export function SichtungFelder({ einsatzId }: { einsatzId: number }) {
  return (
    <>
      <Form.Item
        label="Kategorie"
        name="kategorie"
        rules={[{ required: true, message: 'Bitte eine Sichtungskategorie wählen' }]}
      >
        <SichtungsWahl aria-label="Sichtungskategorie" />
      </Form.Item>
      <Form.Item label="Kurzbegründung (optional)" name="notiz">
        <Input />
      </Form.Item>
      <BestaetigtVonFeld einsatzId={einsatzId} />
    </>
  );
}

/**
 * Der eine Sichtungsaufruf hinter jeder Hülle (Patientenkopf, Zeilen-Sichtung, Dialog, Gerät);
 * die Hülle reicht nur ihre Werte durch. Ohne Netz merkt er vor (LLH-1138, design.md D8), die
 * Mutation dazu läuft mit `networkMode: 'always'`.
 */
export function useSaveSichtung() {
  const save = useSavePersonEintrag();
  return useCallback(
    (einsatzId: number, person: PersonZiel, v: SichtungWerte) => {
      const eingabe: SichtungEingabe = {
        kategorie: v.kategorie,
        notiz: v.notiz ?? null,
        bestaetigt_personal_id: v.bestaetigt_personal_id,
      };
      return save(einsatzId, person, 'sichtung', eingabe);
    },
    [save],
  );
}

interface SichtungDialogProps {
  einsatzId: number;
  person: PersonZiel;
  offen: boolean;
  /** Nach erfolgreichem POST (Invalidierung der Person); der Dialog schließt danach selbst. */
  onErfasst: () => void;
  /** Ohne Netz vorgemerkt (LLH-1138): kein Serverstand, die Seite quittiert am Ort. */
  onVorgemerkt?: () => void;
  onSchliessen: () => void;
}

/**
 * (Re-)Sichtung einer bereits angelegten Person, auf der Erfassungshülle (`frontend/AGENTS.md`,
 * Erfassungs-Norm; LFH-796). Die Erstsichtung beim Anlegen geht mit dem Anlegen mit
 * (`frontend/src/personen/AGENTS.md`), dieser Dialog schreibt jede weitere.
 */
export default function SichtungDialog({
  einsatzId,
  person,
  offen,
  onErfasst,
  onVorgemerkt,
  onSchliessen,
}: SichtungDialogProps) {
  const [form] = Form.useForm<SichtungWerte>();
  const saveSichtung = useSaveSichtung();
  const sichtungMutation = useMutation({
    // Die Funktion merkt ohne Netz selbst vor (`frontend/src/offline/AGENTS.md`).
    networkMode: 'always',
    mutationFn: (v: SichtungWerte) => saveSichtung(einsatzId, person, v),
    onSuccess: (ergebnis) => (ergebnis.zustand === 'gesendet' ? onErfasst() : onVorgemerkt?.()),
  });

  return (
    <ErfassungsModal<SichtungWerte>
      offen={offen}
      titel="Sichtung erfassen"
      form={form}
      erfassenText="Übernehmen"
      laeuft={sichtungMutation.isPending}
      // Grund einer Ablehnung im Dialog, bis zum nächsten Absenden (LFH-1077).
      speicherung={sichtungMutation}
      speicherFehlerTitel="Sichtung nicht gespeichert"
      onErfassen={(v) => sichtungMutation.mutateAsync(v)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <SichtungFelder einsatzId={einsatzId} />
    </ErfassungsModal>
  );
}
