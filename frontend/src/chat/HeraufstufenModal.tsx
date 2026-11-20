import { Checkbox, Form, Input, Typography } from 'antd';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { MODUL_MELDUNGEN_GESPERRT } from '../components/nurAnsicht';
import { ETB_ANHAENGE_MAX } from '../api/etb';
import { formatGroesse } from '../karten/formatGroesse';
import type { ChatNachricht, EtbTyp } from '../api/types';
import { Feld } from '../components/instrument';
import { pflicht } from '../components/pflichtRegel';

/** Für die Heraufstufung zulässige ETB-Typen (Server erzwingt dieselbe Allowlist). */
const TYP_OPTIONEN: { value: EtbTyp; label: string }[] = [
  { value: 'meldung', label: 'Meldung' },
  { value: 'anordnung', label: 'Anordnung' },
  { value: 'lage', label: 'Lage' },
  { value: 'entscheidung', label: 'Entscheidung' },
];

interface FormWerte {
  typ: EtbTyp;
  inhalt: string;
  anhang_ids: number[];
  in_meldungseingang: boolean;
}

/** ETB-Typen, die eine Meldung im Meldungseingang mit anlegen können (y3zh5ymv D8). */
const MIT_MELDUNG: readonly EtbTyp[] = ['meldung', 'lage'];

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  senden: boolean;
  /**
   * Ist das Modul Meldungen für die Person frei? Nur dann bietet der Dialog an, die Meldung im
   * Meldungseingang mit anzulegen; sonst sagt er, dass nur ins ETB übernommen wird (Spec
   * `meldungseingang`, „Die Chat-Heraufstufung in den Meldungseingang verlangt das Recht der
   * Meldungen“).
   */
  meldungenFrei: boolean;
  onAbbrechen: () => void;
  /** Heraufstufen. Muss bei Ablehnung ablehnen (`mutateAsync`), sonst leert die Hülle. */
  onHeraufstufen: (
    typ: EtbTyp,
    inhalt: string,
    anhangIds: number[],
    inMeldungseingang: boolean,
  ) => Promise<unknown>;
  /**
   * Die Speicher-Mutation (LFH-1077), an die Erfassungshülle durchgereicht: ihr Grund steht im
   * Dialog, bis zum nächsten Absenden; Öffnen und Abbrechen räumen ihn.
   */
  speicherung?: Speicherung;
}

/**
 * Heraufstufung Chat-Nachricht → ETB-Eintrag, auf der Erfassungshülle (`frontend/AGENTS.md`,
 * Erfassungs-Norm).
 *
 * LFH-700: Trägt die Nachricht Anhänge, wählt die Person, welche als Kopie ins Tagebuch gehen.
 * Vorgewählt sind die ersten {@link ETB_ANHAENGE_MAX} nach id, mehr nimmt der Server nicht. Die
 * Auswahl ist nötig, weil das ETB unveränderlich ist: Eine falsch übernommene Datei bleibt bis zur
 * Schwärzung am Eintrag (`openspec/changes/archive/2026-10-01-lfh-700-heraufstufen-anhaenge/design.md` D2/D6).
 */
export default function HeraufstufenModal({
  offen,
  nachricht,
  senden,
  meldungenFrei,
  onAbbrechen,
  onHeraufstufen,
  speicherung,
}: Props) {
  const [form] = Form.useForm<FormWerte>();
  // Vor dem ersten Setzen liefert `useWatch` nichts; vorbelegt ist „Meldung“ (unten).
  const typ = Form.useWatch('typ', form) ?? 'meldung';
  const mitMeldung = MIT_MELDUNG.includes(typ);
  const anhaenge = [...(nachricht?.anhaenge ?? [])].sort((a, b) => a.id - b.id);
  const gewaehlt = Form.useWatch('anhang_ids', form) ?? [];
  const voll = gewaehlt.length >= ETB_ANHAENGE_MAX;

  // VORBELEGUNG, kein Zurücksetzen: Zurückgesetzt wird von der Hülle auf jedem Weg hinaus.
  useEffect(() => {
    if (!offen || !nachricht) return;
    form.setFieldsValue({
      typ: 'meldung',
      inhalt: nachricht.inhalt ?? '',
      in_meldungseingang: true,
      anhang_ids: [...nachricht.anhaenge]
        .map((a) => a.id)
        .sort((a, b) => a - b)
        .slice(0, ETB_ANHAENGE_MAX),
    });
  }, [offen, nachricht, form]);

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Zu ETB heraufstufen"
      form={form}
      erfassenText="Heraufstufen"
      laeuft={senden}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht heraufgestuft"
      speicherFehlerFallback="Heraufstufen fehlgeschlagen"
      onErfassen={(w) =>
        onHeraufstufen(
          w.typ,
          w.inhalt.trim(),
          w.anhang_ids ?? [],
          // Wie die ETB-Schnellerfassung (LLH-1037): „Auch in den Meldungseingang“ ist vorgewählt,
          // gilt aber nur bei Meldung/Lage und freigegebenen Meldungen.
          meldungenFrei && MIT_MELDUNG.includes(w.typ) && w.in_meldungseingang !== false,
        )
      }
      onFertig={onAbbrechen}
      onAbbrechen={onAbbrechen}
    >
      <Feld label="ETB-Typ" name="typ" rules={[pflicht('ETB-Typ')]}>
        <Select options={TYP_OPTIONEN} />
      </Feld>
      {mitMeldung && meldungenFrei && (
        <Feld name="in_meldungseingang" valuePropName="checked">
          <Checkbox>Auch in den Meldungseingang</Checkbox>
        </Feld>
      )}
      {mitMeldung && !meldungenFrei && (
        <Typography.Paragraph type="secondary">
          Nur ins ETB: {MODUL_MELDUNGEN_GESPERRT}
        </Typography.Paragraph>
      )}
      <Feld
        label="Text"
        name="inhalt"
        rules={[
          pflicht('Text', { whitespace: true }),
          // Eine ältere, längere Nachricht wird nicht still gekürzt (LFH-937, design.md D8).
          zeichenRegel(ETB_INHALT_MAX, 'Text'),
        ]}
      >
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 6 }}
          count={zeichenGrenze(ETB_INHALT_MAX)}
        />
      </Feld>
      {anhaenge.length > 0 && (
        <Feld
          label="Anhänge übernehmen"
          name="anhang_ids"
          // EIN Folgesatz vor dem unumkehrbaren Schritt; wie kopiert wird, sagt die Seite nicht
          // (LFH-1078).
          extra="Kopie im ETB, unveränderlich."
          rules={[
            {
              type: 'array',
              max: ETB_ANHAENGE_MAX,
              message: `Höchstens ${ETB_ANHAENGE_MAX} Anhänge je Eintrag`,
            },
          ]}
        >
          <Checkbox.Group
            role="group"
            aria-label="Anhänge übernehmen"
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {anhaenge.map((a) => (
              <Checkbox
                key={a.id}
                value={a.id}
                // Die Grenze zeigt sich am Kästchen, nicht erst als Fehler beim Absenden.
                disabled={voll && !gewaehlt.includes(a.id)}
              >
                {a.dateiname}{' '}
                <Typography.Text type="secondary">· {formatGroesse(a.groesse)}</Typography.Text>
              </Checkbox>
            ))}
          </Checkbox.Group>
        </Feld>
      )}
    </ErfassungsModal>
  );
}
