import { Collapse, Form, Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { MaterialPatch } from '../api/einsatzMaterial';
import { MATERIAL_ADHOC_TEXT_MAX } from '../api/eingabegrenzen';
import type { EinsatzMaterial } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';

interface Werte {
  bezeichnung: string;
  kategorie?: string;
  traegerorganisation?: string;
  bestandsnummer?: string;
}

type Posten = Pick<
  EinsatzMaterial,
  'id' | 'bezeichnung' | 'kategorie' | 'traegerorganisation' | 'bestandsnummer'
>;

/**
 * Nur die geänderten Angaben (LLH-1093, design.md D12): ein geleertes Feld geht als `null`, die
 * Bezeichnung ist Pflicht und nie `null`. Verglichen wird getrimmt, wie der Server speichert.
 */
export function geaenderteAngaben(vorher: Posten, w: Werte): MaterialPatch {
  const patch: MaterialPatch = {};
  const bezeichnung = w.bezeichnung.trim();
  if (bezeichnung !== vorher.bezeichnung) patch.bezeichnung = bezeichnung;
  const optional = (neu: string | undefined, alt: string | null | undefined) => {
    const n = neu?.trim() || null;
    return n === (alt ?? null) ? undefined : n;
  };
  const kategorie = optional(w.kategorie, vorher.kategorie);
  if (kategorie !== undefined) patch.kategorie = kategorie;
  const traeger = optional(w.traegerorganisation, vorher.traegerorganisation);
  if (traeger !== undefined) patch.traegerorganisation = traeger;
  const bestandsnummer = optional(w.bestandsnummer, vorher.bestandsnummer);
  if (bestandsnummer !== undefined) patch.bestandsnummer = bestandsnummer;
  return patch;
}

export interface MaterialAngabenModalProps {
  /** Der Ad-hoc-Posten, dessen Angaben korrigiert werden; `null` = zu. */
  posten: Posten | null;
  laeuft: boolean;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); ohne Änderung ruft der Dialog nichts. */
  onSpeichern: (patch: MaterialPatch) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * „Angaben ändern“ eines Ad-hoc-Postens (LLH-1093, design.md D6, D12) auf der Erfassungs-Hülle:
 * Bezeichnung, Kategorie und Trägerorganisation sichtbar, die Bestandsnummer unter „Weitere
 * Angaben“ (Feldbudget wie der Ad-hoc-Dialog). Vorbelegen beim Öffnen ist kein Reset; das Leeren
 * übernimmt die Hülle auf jedem Weg hinaus.
 *
 * Die Grenzen stehen im Spiegel `api/eingabegrenzen.ts`. Eine ältere, längere Angabe wird nie
 * gekürzt: sie bleibt stehen, der Zähler zeigt „zu lang“, und die Regel sperrt das Senden.
 */
export default function MaterialAngabenModal({
  posten,
  laeuft,
  speicherung,
  onSpeichern,
  onSchliessen,
}: MaterialAngabenModalProps) {
  const [form] = Form.useForm<Werte>();
  // Der Posten in einer Ref: hinge der Vorbeleg-Effekt an ihm (neue Identität bei jedem Nachladen
  // der Liste), überschriebe er mitten im Tippen (Muster `GefahrenZelleDetails`).
  const postenRef = useRef(posten);
  useEffect(() => {
    postenRef.current = posten;
  }, [posten]);
  const offenId = posten?.id ?? null;
  useEffect(() => {
    const p = postenRef.current;
    if (offenId == null || !p) return;
    form.setFieldsValue({
      bezeichnung: p.bezeichnung,
      kategorie: p.kategorie ?? '',
      traegerorganisation: p.traegerorganisation ?? '',
      bestandsnummer: p.bestandsnummer ?? '',
    });
  }, [offenId, form]);

  // Der Klappteil geht bei einem Prüffehler darin selbst auf, und sein Kopf nennt die
  // Bestandsnummer: so bleibt keine Ablehnung verborgen (`frontend/AGENTS.md`, Erfassungs-Norm).
  const [weitereOffen, setWeitereOffen] = useState(false);
  useEffect(() => {
    if (offenId == null) setWeitereOffen(false);
  }, [offenId]);
  const bestandsnummer = Form.useWatch('bestandsnummer', { form, preserve: true })?.trim();

  const grenze = zeichenGrenze(MATERIAL_ADHOC_TEXT_MAX);
  return (
    <ErfassungsModal<Werte>
      offen={posten != null}
      titel={posten ? `Angaben zu ${posten.bezeichnung} ändern` : undefined}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht gespeichert"
      speicherFehlerFallback="Speichern fehlgeschlagen"
      onErfassen={async (w) => {
        const vorher = postenRef.current;
        if (!vorher) return;
        const patch = geaenderteAngaben(vorher, w);
        if (Object.keys(patch).length > 0) await onSpeichern(patch);
      }}
      onPruefungGescheitert={(felder) => {
        if (felder.includes('bestandsnummer')) setWeitereOffen(true);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[
          { required: true, whitespace: true, message: 'Bezeichnung eintragen' },
          zeichenRegel(MATERIAL_ADHOC_TEXT_MAX, 'Bezeichnung'),
        ]}
      >
        <Input count={grenze} />
      </Form.Item>
      <Form.Item
        label="Kategorie"
        name="kategorie"
        rules={[zeichenRegel(MATERIAL_ADHOC_TEXT_MAX, 'Kategorie')]}
      >
        <Input count={grenze} />
      </Form.Item>
      <Form.Item
        label="Trägerorganisation"
        name="traegerorganisation"
        rules={[zeichenRegel(MATERIAL_ADHOC_TEXT_MAX, 'Trägerorganisation')]}
      >
        <Input count={grenze} />
      </Form.Item>
      <Collapse
        ghost
        activeKey={weitereOffen ? ['weitere'] : []}
        onChange={(keys) => setWeitereOffen(keys.includes('weitere'))}
        items={[
          {
            key: 'weitere',
            label: bestandsnummer
              ? `Weitere Angaben · Bestandsnummer ${bestandsnummer}`
              : 'Weitere Angaben',
            forceRender: true,
            children: (
              <Form.Item
                label="Bestandsnummer"
                name="bestandsnummer"
                rules={[zeichenRegel(MATERIAL_ADHOC_TEXT_MAX, 'Bestandsnummer')]}
                style={{ marginBottom: 0 }}
              >
                <Input count={grenze} />
              </Form.Item>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
