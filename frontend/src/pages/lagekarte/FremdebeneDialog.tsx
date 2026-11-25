/**
 * „Fremdebene hinzufügen …“ der Lagekarte (Spec `fremdebenen`, Abschnitt „Oberfläche → Anlegen“):
 * fremde Daten als GeoJSON, KML oder KMZ, entweder als Datei oder als https-Adresse, die der Server
 * abruft und danach alle 60 s nachführt.
 *
 * Der Dialog ist die Erfassungshülle (`ErfassungsModal`, Maske gesperrt, Rückfrage vor dem Verwerfen).
 * Die Größe der Datei wird vorab im Client geprüft (`DateiFeld`, Grenze 10 MiB wie der Server).
 * Eine Ablehnung des Servers trägt einen `grund`; sein Text (`FREMDEBENE_FEHLERTEXT`) steht im
 * Dialog, der offen bleibt, mit allen Eingaben. Ohne Netz wird nichts vorgemerkt: der Weg ist
 * dann schon im Menü gesperrt, und ein Abbruch im Lauf meldet `NetzFehler` an derselben Stelle.
 */
import { useRef } from 'react';
import { Alert, App, Form, Input, Radio, type UploadFile } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import {
  FREMDEBENE_FEHLERTEXT,
  FREMDEBENE_GRENZEN,
  legeFremdebeneAn,
  type FremdebeneFehler,
} from '../../api/fremdebenen';
import { WEBHOOK_URL_MAX } from '../../api/eingabegrenzen';
import { einsatzKeys } from '../../api/queryKeys';
import { ErfassungsModal } from '../../components/Erfassung';
import DateiFeld from '../../components/DateiFeld';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import UploadFortschrittAnzeige from '../../components/UploadFortschritt';
import { ablageFehlerKopf, useUploadFortschritt } from '../../components/useUploadFortschritt';
import Feld from '../../components/instrument/Feld';
import { pflicht } from '../../components/pflichtRegel';
import type { Nebenweg } from '../../components/EinsatzSeite';

/** Wortlaut des Nebenwegs. */
export const FREMDEBENE_HINZUFUEGEN = 'Fremdebene hinzufügen …';

/**
 * Der Nebenweg „Fremdebene hinzufügen …“ im Kopf der Lagekarte: nur mit Schreibrecht, ohne Netz
 * gesperrt, der Grund steht im Label (nie nur als Tooltip). Ohne Schreibrecht gibt es ihn nicht.
 */
export function fremdebeneNebenweg({
  darfSchreiben,
  ohneVerbindung,
  onWahl,
}: {
  darfSchreiben: boolean;
  ohneVerbindung: boolean;
  onWahl: () => void;
}): Nebenweg | null {
  if (!darfSchreiben) return null;
  return {
    key: 'fremdebene',
    label: ohneVerbindung ? `${FREMDEBENE_HINZUFUEGEN} (ohne Verbindung)` : FREMDEBENE_HINZUFUEGEN,
    ...(ohneVerbindung ? { gesperrt: true as const } : {}),
    onWahl,
  };
}

/** Dateiwahl vorfiltern; erkannt wird serverseitig am Inhalt. */
export const FREMDEBENE_ACCEPT = '.geojson,.json,.kml,.kmz';

/**
 * Längste Adresse, die der Server annimmt: der Abruf prüft sie mit dem Ziel-Check der Webhooks
 * (`public_api::webhook::URL_MAX`). Kein natives `maxLength` am Feld: es kürzte eine eingefügte
 * Adresse still (`frontend/AGENTS.md`, „Freitext nie länger als der Server erlaubt“, nie kürzen);
 * die Prüfung am Feld sperrt das Senden.
 */
export const FREMDEBENE_URL_MAX = WEBHOOK_URL_MAX;

/** Das Schema darf groß geschrieben sein (aus einer Mail kopiert). */
const HTTPS = /^https:\/\//i;

type Quelle = 'datei' | 'url';

interface Formular {
  quelle: Quelle;
  datei?: UploadFile[];
  url?: string;
  name?: string;
}

/** Der Text zum `grund` einer Ablehnung, sonst `null`. */
function grundText(fehler: unknown): string | null {
  if (!(fehler instanceof ApiError) || fehler.grund == null) return null;
  return fehler.grund in FREMDEBENE_FEHLERTEXT
    ? FREMDEBENE_FEHLERTEXT[fehler.grund as FremdebeneFehler]
    : null;
}

interface Props {
  offen: boolean;
  einsatzId: number;
  onSchliessen: () => void;
}

export default function FremdebeneDialog({ offen, einsatzId, onSchliessen }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<Formular>();
  const quelle = Form.useWatch('quelle', form) ?? 'datei';
  /** Der zuletzt AUTOMATISCH gesetzte Name: nur solange das Feld ihn trägt, ersetzt ihn eine neue
   *  Dateiwahl; ein getippter Name bleibt immer stehen. */
  const autoName = useRef<string | null>(null);
  const fortschritt = useUploadFortschritt();

  const mutation = useMutation({
    mutationFn: (werte: Formular) =>
      fortschritt.begleite((onFortschritt) =>
        legeFremdebeneAn(
          einsatzId,
          {
            name: (werte.name ?? '').trim(),
            ...(werte.quelle === 'url'
              ? { url: (werte.url ?? '').trim() }
              : { datei: werte.datei?.[0]?.originFileObj as File }),
          },
          onFortschritt,
        ),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.fremdebenen(einsatzId) });
      message.success('Fremdebene hinzugefügt');
    },
  });

  function schliessen() {
    autoName.current = null;
    mutation.reset();
    onSchliessen();
  }

  const gruendeText = grundText(mutation.error);
  return (
    <ErfassungsModal<Formular>
      offen={offen}
      titel="Fremdebene hinzufügen"
      form={form}
      initialValues={{ quelle: 'datei' }}
      onErfassen={(werte) => mutation.mutateAsync(werte)}
      onFertig={schliessen}
      onAbbrechen={schliessen}
      laeuft={mutation.isPending}
      erfassenText="Anlegen"
    >
      {gruendeText != null ? (
        <Alert type="error" showIcon title="Nicht hinzugefügt" description={gruendeText} />
      ) : (
        <SpeicherFehler fehler={mutation.error} {...ablageFehlerKopf(mutation.error)} />
      )}
      <UploadFortschrittAnzeige
        stand={mutation.isPending ? fortschritt.stand : null}
        pruefenText="Fremdebene wird gelesen"
      />
      <Feld name="quelle" label="Quelle">
        <Radio.Group
          options={[
            { value: 'datei', label: 'Datei' },
            { value: 'url', label: 'Adresse' },
          ]}
        />
      </Feld>
      {quelle === 'datei' ? (
        <DateiFeld
          accept={FREMDEBENE_ACCEPT}
          maxBytes={FREMDEBENE_GRENZEN.dateiBytes}
          zuGrossText={FREMDEBENE_FEHLERTEXT.zu_gross}
          onDateiWahl={(file) => {
            const aktuell: string | undefined = form.getFieldValue('name');
            if (!aktuell || aktuell === autoName.current) {
              const neu = file.name.replace(/\.[^.]+$/, '').slice(0, FREMDEBENE_GRENZEN.nameMax);
              autoName.current = neu;
              form.setFieldValue('name', neu);
            }
          }}
        />
      ) : (
        <Feld
          name="url"
          label="Adresse"
          rules={[
            pflicht('Adresse', { whitespace: true }),
            {
              validator: (_, wert?: string) => {
                const url = (wert ?? '').trim();
                if (url === '') return Promise.resolve();
                if (!HTTPS.test(url))
                  return Promise.reject(new Error('Die Adresse muss mit https:// beginnen'));
                if (url.length > FREMDEBENE_URL_MAX)
                  return Promise.reject(
                    new Error(`Die Adresse darf höchstens ${FREMDEBENE_URL_MAX} Zeichen haben`),
                  );
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="https://…" inputMode="url" data-erfassung-fokus="" />
        </Feld>
      )}
      {/* Der Platzhalter zeigt, woher der Name kommt, wenn das Feld leer bleibt. */}
      <Feld name="name" label="Name" abstand="ohne">
        <Input
          maxLength={FREMDEBENE_GRENZEN.nameMax}
          placeholder={quelle === 'url' ? 'aus der Adresse' : 'aus der Datei'}
        />
      </Feld>
    </ErfassungsModal>
  );
}
