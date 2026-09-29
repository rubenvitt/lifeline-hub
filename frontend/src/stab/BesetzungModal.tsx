import { Form, Input } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import { entferneBesetzung, setzeBesetzung } from '../api/stab';
import type { EinsatzPersonal, Stabsfunktion } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import AdhocPersonModal from '../kraefte/AdhocPersonModal';
import {
  BESETZUNG_OPTIONEN,
  besetzungAktion,
  besetzungFormWerte,
  type BesetzungAktion,
  type BesetzungFormWerte,
} from './besetzung';
import type { SachgebietEintrag } from './sachgebiete';

/** Wert des letzten Personen-Eintrags; keine gültige `einsatz_personal.id` (positiv). */
const ADHOC = -1;

interface BesetzungModalProps {
  einsatzId: number;
  eintrag: SachgebietEintrag;
  zeile: Stabsfunktion | undefined;
  onSchliessen: () => void;
}

/**
 * „Besetzung ändern" — zwei Felder: Art und je nach Art Person oder Bezeichnung.
 * Die Seite montiert die Maske nur, solange sie offen ist, mit `key={sachgebiet}`: jede Öffnung
 * bekommt einen frischen Formularspeicher (der rc-field-form-Store überlebte sonst das
 * Schließen). Umkehrbar → keine Rückfrage. Kein Serienmodus.
 */
export default function BesetzungModal({
  einsatzId,
  eintrag,
  zeile,
  onSchliessen,
}: BesetzungModalProps) {
  const qc = useQueryClient();
  // Stand beim ÖFFNEN einfrieren: `zeile` kommt live aus der Query. Gegen den Live-Stand
  // verglichen löschte ein unverändertes „Übernehmen" eine fremd gesetzte Besetzung oder setzte
  // eine fremd geänderte zurück. Montieren = Öffnen.
  const [basis] = useState(zeile);
  const [form] = Form.useForm<BesetzungFormWerte>();
  const art = Form.useWatch('art', form);
  const [adhocOffen, setAdhocOffen] = useState(false);
  // Bis die Invalidierung die Personalliste nachlädt, stünde im Select sonst die rohe ID.
  const [angelegt, setAngelegt] = useState<EinsatzPersonal | null>(null);

  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });

  const personenOptionen = useMemo(() => {
    const liste = personalQuery.data ?? [];
    const mitAngelegt =
      angelegt && !liste.some((p) => p.id === angelegt.id) ? [...liste, angelegt] : liste;
    return [
      // Gleichnamige Personen bleiben über die Funktion unterscheidbar.
      ...mitAngelegt.map((p) => ({
        value: p.id,
        label: p.funktion ? `${p.name} · ${p.funktion}` : p.name,
      })),
      { value: ADHOC, label: 'Ad-hoc-Person anlegen …' },
    ];
  }, [personalQuery.data, angelegt]);

  const mutation = useMutation({
    mutationFn: async (aktion: BesetzungAktion) => {
      if (aktion.typ === 'entfernen') await entferneBesetzung(einsatzId, eintrag.sachgebiet);
      if (aktion.typ === 'setzen')
        await setzeBesetzung(einsatzId, eintrag.sachgebiet, aktion.daten);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.stab(einsatzId) }),
  });

  return (
    <>
      <ErfassungsModal<BesetzungFormWerte>
        offen
        titel={`Besetzung ${eintrag.kuerzel} · ${eintrag.label}`}
        form={form}
        initialValues={besetzungFormWerte(basis)}
        erfassenText="Übernehmen"
        laeuft={mutation.isPending}
        onErfassen={async (werte) => {
          const aktion = besetzungAktion(basis, werte);
          if (aktion.typ !== 'keine') await mutation.mutateAsync(aktion);
        }}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
      >
        <Form.Item label="Besetzung" name="art" rules={[{ required: true }]}>
          <Select options={[...BESETZUNG_OPTIONEN]} />
        </Form.Item>
        {art === 'personal' && (
          <Form.Item
            label="Person"
            name="personal_id"
            rules={[{ required: true, message: 'Person wählen' }]}
          >
            <Select
              placeholder="disponierte Person"
              options={personenOptionen}
              loading={personalQuery.isLoading}
              onChange={(wert) => {
                if (wert === ADHOC) {
                  // `null`, nicht `undefined`: rc-select fiele bei `undefined` auf seinen inneren Wert zurück und
                  // zeigte „Ad-hoc-Person anlegen …" weiter an. `null` zeigt den Platzhalter; `required` weist beide ab.
                  form.setFieldValue('personal_id', null);
                  setAdhocOffen(true);
                }
              }}
            />
          </Form.Item>
        )}
        {(art === 'extern' || art === 'rueckwaertig') && (
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[
              { required: true, whitespace: true, message: 'Bezeichnung angeben' },
              { max: 200, message: 'Höchstens 200 Zeichen' },
            ]}
          >
            <Input placeholder={art === 'extern' ? 'Name' : 'z. B. Leitstelle'} />
          </Form.Item>
        )}
        {/* Ein abgelehnter PUT/DELETE steht IN der Maske; die Hülle lässt die Felder stehen, weil
           `mutateAsync` ablehnt. */}
        <SpeicherFehler fehler={mutation.error} />
      </ErfassungsModal>
      <AdhocPersonModal
        offen={adhocOffen}
        einsatzId={einsatzId}
        onSchliessen={() => setAdhocOffen(false)}
        onAngelegt={(ep) => {
          setAngelegt(ep);
          form.setFieldValue('personal_id', ep.id);
        }}
      />
    </>
  );
}
