import { Collapse, Form, Input } from 'antd';
import { useState } from 'react';
import { Ortsfeld, type OrtsfeldWert } from '../anzeige/Ortsfeld';
import {
  VERPFLEGUNG_STANDORT_MAX,
  VERPFLEGUNG_STELLE_BEZEICHNUNG_MAX,
} from '../api/eingabegrenzen';
import { sucheOrtImEinsatz } from '../api/ortSuche';
import { einsatzKeys } from '../api/queryKeys';
import type {
  Verpflegungsstelle,
  VerpflegungsstelleArt,
  VerpflegungsstelleEingabe,
  VerpflegungsstellePatch,
} from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { grenzeText, istZuLang, zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { STELLE_ART_LABEL } from './verpflegungText';

/**
 * Maske der Verpflegungsstelle, Anlegen und Bearbeiten (LLH-1040, design.md D13 Punkt 3).
 *
 * FELDBUDGET: drei sichtbare Felder (Bezeichnung, Art, Standort); der Abschnitt liegt im Klappteil
 * „Weitere Angaben“, dessen Kopf die Wahl nennt. Ohne Abschnitte im Einsatz gibt es ihn nicht.
 *
 * STANDORT: über das Ortsfeld (Spec `ortsfeld`): ein Treffer setzt Text und Koordinate, jede
 * Textänderung nimmt die Koordinate weg. Hinaus gehen `standort`, `lat` und `lon` deshalb immer
 * zusammen; ein geänderter Text ohne Treffer leert beim Bearbeiten die alte Koordinate.
 *
 * PATCH: nur Geändertes gegen den Stand beim Öffnen; `null` leert Standort, Koordinate und
 * Abschnitt. Ein leerer PATCH wird nicht gesendet. Gründe des Servers (409 doppelte Bezeichnung,
 * 422) stehen IM Dialog.
 */

export interface StelleWerte {
  bezeichnung: string;
  art: VerpflegungsstelleArt;
  standort?: OrtsfeldWert;
  abschnitt_id?: number | null;
}

export interface AbschnittOption {
  value: number;
  label: string;
}

/** Getrimmter Text oder `null` — ein Feld aus Leerzeichen ist leer. */
function text(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/** Standort und Koordinate als Wire-Felder; die Koordinate nur mit Text und Treffer. */
function ortFelder(w: OrtsfeldWert | undefined): {
  standort: string | null;
  lat: number | null;
  lon: number | null;
} {
  const standort = text(w?.text);
  const k = standort != null ? w?.koordinate : null;
  return { standort, lat: k?.lat ?? null, lon: k?.lon ?? null };
}

export function createStelleBody(w: StelleWerte): VerpflegungsstelleEingabe {
  const ort = ortFelder(w.standort);
  return {
    bezeichnung: w.bezeichnung.trim(),
    art: w.art,
    ...(ort.standort != null ? { standort: ort.standort } : {}),
    ...(ort.lat != null && ort.lon != null ? { lat: ort.lat, lon: ort.lon } : {}),
    ...(w.abschnitt_id != null ? { abschnitt_id: w.abschnitt_id } : {}),
  };
}

export function stellePatch(vorher: Verpflegungsstelle, w: StelleWerte): VerpflegungsstellePatch {
  const patch: VerpflegungsstellePatch = {};
  const bezeichnung = text(w.bezeichnung);
  if (bezeichnung != null && bezeichnung !== vorher.bezeichnung) patch.bezeichnung = bezeichnung;
  if (w.art !== vorher.art) patch.art = w.art;
  const ort = ortFelder(w.standort);
  if (ort.standort !== (vorher.standort ?? null)) patch.standort = ort.standort;
  // Paarweise: der Server nimmt `lat` und `lon` nur zusammen (422 sonst).
  if (ort.lat !== (vorher.lat ?? null) || ort.lon !== (vorher.lon ?? null)) {
    patch.lat = ort.lat;
    patch.lon = ort.lon;
  }
  // `undefined` wird zu `null`: ein geleertes Auswahlfeld fiele beim Serialisieren sonst weg.
  if ((w.abschnitt_id ?? null) !== (vorher.abschnitt_id ?? null)) {
    patch.abschnitt_id = w.abschnitt_id ?? null;
  }
  return patch;
}

const ART_OPTIONEN = (Object.keys(STELLE_ART_LABEL) as VerpflegungsstelleArt[]).map((a) => ({
  value: a,
  label: STELLE_ART_LABEL[a],
}));

/** Längenregel am Text des Ortsfelds (sein Wert ist ein Objekt, `zeichenRegel` prüft Strings). */
const standortRegel = {
  validator: (_: unknown, wert: OrtsfeldWert | undefined) =>
    istZuLang(wert?.text, VERPFLEGUNG_STANDORT_MAX)
      ? Promise.reject(
          new Error(
            `Standort darf höchstens ${grenzeText(VERPFLEGUNG_STANDORT_MAX)} Zeichen lang sein`,
          ),
        )
      : Promise.resolve(),
};

export type StelleModus =
  | { art: 'anlegen'; onErfassen: (body: VerpflegungsstelleEingabe) => Promise<unknown> }
  | {
      art: 'bearbeiten';
      stelle: Verpflegungsstelle;
      onErfassen: (patch: VerpflegungsstellePatch) => Promise<unknown>;
    };

export interface StelleDialogProps {
  modus: StelleModus;
  einsatzId: number;
  /** Abschnitte des Einsatzes; `null` (nicht lesbar) oder leer: kein Feld. */
  abschnitte: readonly AbschnittOption[] | null;
  laeuft: boolean;
  /** `mutation.error` — steht IM Dialog, bis zum nächsten Absenden. */
  fehler: unknown;
  onSchliessen: () => void;
}

export function StelleDialog({
  modus,
  einsatzId,
  abschnitte,
  laeuft,
  fehler,
  onSchliessen,
}: StelleDialogProps) {
  const [form] = Form.useForm<StelleWerte>();
  // Der Stand beim Öffnen: ein Live-Update während der Eingabe verschiebt die Vorlage nicht.
  const [vorher] = useState(modus.art === 'bearbeiten' ? modus.stelle : null);
  const hasAbschnitte = abschnitte != null && abschnitte.length > 0;
  const abschnittId = Form.useWatch('abschnitt_id', form) as number | null | undefined;
  const abschnittName = abschnitte?.find((a) => a.value === abschnittId)?.label;

  const initialValues: Partial<StelleWerte> | undefined = vorher
    ? {
        bezeichnung: vorher.bezeichnung,
        art: vorher.art,
        standort: {
          text: vorher.standort ?? '',
          koordinate:
            vorher.lat != null && vorher.lon != null ? { lat: vorher.lat, lon: vorher.lon } : null,
        },
        abschnitt_id: vorher.abschnitt_id ?? undefined,
      }
    : undefined;

  return (
    <ErfassungsModal<StelleWerte>
      offen
      titel={vorher ? `Stelle bearbeiten: ${vorher.bezeichnung}` : 'Stelle anlegen'}
      form={form}
      erfassenText={vorher ? 'Speichern' : 'Anlegen'}
      laeuft={laeuft}
      initialValues={initialValues}
      onErfassen={(w) => {
        if (modus.art === 'anlegen') return modus.onErfassen(createStelleBody(w));
        const basis = vorher ?? modus.stelle;
        // Ohne Feld bleibt der Abschnitt, wie er ist (sonst hieße „kein Wert“ leeren).
        const werte = hasAbschnitte ? w : { ...w, abschnitt_id: basis.abschnitt_id };
        const patch = stellePatch(basis, werte);
        return Object.keys(patch).length === 0 ? Promise.resolve() : modus.onErfassen(patch);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<StelleWerte>
        name="bezeichnung"
        label="Bezeichnung"
        rules={[
          { required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' },
          zeichenRegel(VERPFLEGUNG_STELLE_BEZEICHNUNG_MAX, 'Bezeichnung'),
        ]}
      >
        <Input
          placeholder="z. B. Feldküche BR Sportplatz"
          count={zeichenGrenze(VERPFLEGUNG_STELLE_BEZEICHNUNG_MAX)}
        />
      </Form.Item>
      <Form.Item<StelleWerte>
        name="art"
        label="Art"
        rules={[{ required: true, message: 'Bitte eine Art wählen' }]}
      >
        <Select options={ART_OPTIONEN} />
      </Form.Item>
      <Form.Item<StelleWerte> name="standort" label="Standort" rules={[standortRegel]}>
        <Ortsfeld
          suchen={(begriff) => sucheOrtImEinsatz(einsatzId, begriff)}
          suchSchluessel={(begriff) => einsatzKeys.einsatzortSuche(einsatzId, begriff)}
          count={zeichenGrenze(VERPFLEGUNG_STANDORT_MAX)}
        />
      </Form.Item>
      {hasAbschnitte && (
        // `forceRender` ist TRAGEND: sonst fehlt der Abschnitt in `onFinish`.
        <Collapse
          ghost
          items={[
            {
              key: 'weitere',
              label: ['Weitere Angaben', abschnittName].filter(Boolean).join(' · '),
              forceRender: true,
              children: (
                <Form.Item<StelleWerte>
                  name="abschnitt_id"
                  label="Einsatzabschnitt"
                  style={{ marginBottom: 0 }}
                >
                  <Select
                    allowClear
                    placeholder="ohne Abschnitt"
                    options={[...abschnitte]}
                    notFoundContent="Keine Einsatzabschnitte angelegt"
                  />
                </Form.Item>
              ),
            },
          ]}
        />
      )}
      <SpeicherFehler
        fehler={fehler}
        titel={vorher ? 'Stelle nicht gespeichert' : 'Stelle nicht angelegt'}
      />
    </ErfassungsModal>
  );
}
