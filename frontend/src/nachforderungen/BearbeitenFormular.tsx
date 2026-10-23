import { AutoComplete, Form, Input } from 'antd';
import type { Rule } from 'antd/es/form';
import { useMemo, useState } from 'react';
import type { Nachforderung, NachforderungPrioritaet, PatchNachforderung } from '../api/types';
import { NACHFORDERUNG_BEZEICHNUNG_MAX, NACHFORDERUNG_ZIEL_TEXT_MAX } from '../api/eingabegrenzen';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsZeitpunkt } from '../anzeige/zeitEingabe';
import { ErfassungsFormular, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import { Select } from '../components/Select';
import { teilwortSuche } from '../components/teilwortSuche';
import { nachforderungName } from './nachforderungName';
import { WerFeld, werRegeln } from './ZusageFormular';
import {
  zielOptionen,
  zielZeile,
  type ZielAbschnitt,
  type ZielNamen,
  type ZielRaum,
} from './zielVorschlaege';
import { aenderungBody, aenderungStart, hatZusage, type AenderungWerte } from './zusage';

const PRIORITAET_OPTIONEN: { value: NachforderungPrioritaet; label: string }[] = [
  { value: 'sofort', label: 'Sofort' },
  { value: 'dringend', label: 'Dringend' },
  { value: 'normal', label: 'Normal' },
];

const KEINE_RAEUME: readonly ZielRaum[] = [];
const KEINE_ABSCHNITTE: readonly ZielAbschnitt[] = [];

/**
 * Eine offene Nachforderung an der Karte bearbeiten (LLH-1097 D9): Anzahl, Wohin, Priorität,
 * Details, bei laufender Zusage dazu Wer und Eintreffen. Die Art bleibt. Gesendet wird nur, was
 * sich geändert hat; ohne Änderung schließt das Formular ohne Anfrage.
 * **Später auf den Baustein „Bearbeiten in der Ansicht“ (LLH-1022 f) umstellen.**
 */
export default function BearbeitenFormular({
  nachforderung: n,
  zielNamen,
  raeume = KEINE_RAEUME,
  abschnitte = KEINE_ABSCHNITTE,
  werVorschlaege,
  onSpeichern,
  onSchliessen,
  speicherung,
}: {
  nachforderung: Nachforderung;
  zielNamen?: ZielNamen | null;
  raeume?: readonly ZielRaum[];
  abschnitte?: readonly ZielAbschnitt[];
  /** Vorschläge für „Wer“ aus den Einheiten des Einsatzes (LLH-1383 D10). */
  werVorschlaege?: readonly string[];
  /** **Muss bei Ablehnung ablehnen** (`mutateAsync`). */
  onSpeichern: (aenderung: PatchNachforderung) => Promise<unknown>;
  onSchliessen: () => void;
  speicherung?: Speicherung;
}) {
  const [form] = Form.useForm<AenderungWerte>();
  const name = nachforderungName(n);
  const mitZusage = hatZusage(n);
  // Der Startwert hält den Stand beim Öffnen fest: ein Neuabruf darunter ändert die Felder nicht.
  // „Wohin“ beginnt mit dem gezeigten Namen; unverändert geht es nicht mit.
  const [start] = useState(() =>
    aenderungStart(
      n,
      zielZeile(n, zielNamen)?.replace(/^→ /, '') ?? '',
      alsZeitpunkt(n.eintreffen_erwartet_at) ?? null,
    ),
  );
  const wohinOptionen = useMemo(() => zielOptionen(raeume, abschnitte), [raeume, abschnitte]);
  // Nicht unter die verknüpften Einheiten (LLH-1387 D5): der Server lehnte mit 422 ab (LLH-1395).
  const verknuepft = n.einheit_ids.length;
  const mengenRegeln: Rule[] = [
    ...(n.anzahl != null ? [{ required: true, message: 'Anzahl ist erforderlich' }] : []),
    ...(verknuepft > 0
      ? [
          {
            validator: (_: unknown, wert: number | null | undefined) =>
              wert != null && wert < verknuepft
                ? Promise.reject(
                    new Error(`Mindestens ${verknuepft}: so viele Einheiten sind verknüpft`),
                  )
                : Promise.resolve(),
          },
        ]
      : []),
  ];

  const speichern = (w: AenderungWerte) => {
    const body = aenderungBody(n, start, w, raeume, abschnitte);
    // Nichts geändert: keine Anfrage, kein ETB-Eintrag (D9).
    return Object.keys(body).length === 0 ? Promise.resolve() : onSpeichern(body);
  };

  return (
    <section aria-label={`${name} bearbeiten`} data-lfh="nachforderung-bearbeiten">
      <ErfassungsFormular<AenderungWerte>
        form={form}
        initialValues={start}
        onErfassen={speichern}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
        laeuft={speicherung?.isPending}
        speicherung={speicherung}
        speicherFehlerTitel="Änderung nicht gespeichert"
        speicherFehlerFallback="Speichern fehlgeschlagen"
        erfassenText="Änderung speichern"
      >
        <Form.Item name="anzahl" label="Anzahl" rules={mengenRegeln}>
          <MengenFeld beschriftung="Anzahl" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="wohin" label="Wohin">
          <AutoComplete
            aria-label="Wohin"
            options={wohinOptionen}
            showSearch={teilwortSuche}
            allowClear
            maxLength={NACHFORDERUNG_ZIEL_TEXT_MAX}
          />
        </Form.Item>
        <Form.Item name="prioritaet" label="Priorität">
          <Select<NachforderungPrioritaet> aria-label="Priorität" options={PRIORITAET_OPTIONEN} />
        </Form.Item>
        <Form.Item name="bezeichnung" label="Details / Zweck">
          <Input aria-label="Details / Zweck" maxLength={NACHFORDERUNG_BEZEICHNUNG_MAX} />
        </Form.Item>
        {mitZusage && (
          <>
            <Form.Item name="wer" label="Wer" dependencies={['anzahl']} rules={werRegeln('anzahl')}>
              <WerFeld aria-label="Wer" vorschlaege={werVorschlaege} />
            </Form.Item>
            <Form.Item name="eintreffen" label="Eintreffen erwartet">
              <ZeitpunktEingabe
                art="frist"
                aria-label="Eintreffen erwartet"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </>
        )}
      </ErfassungsFormular>
    </section>
  );
}
