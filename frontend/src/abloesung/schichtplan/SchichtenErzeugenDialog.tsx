import { Alert, Form, Input } from 'antd';
import { Select } from '../../components/Select';
import type { Dayjs } from 'dayjs';
import { ApiError } from '../../api/client';
import type { SchichtplanErzeugenBody } from '../../api/types';
import { ZeitraumEingabe, type Zeitraum } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../../anzeige/zeitEingabe';
import { ErfassungsModal, type Speicherung } from '../../components/Erfassung';
import { einsatzVorgabe } from '../../components/vorgabeText';
import { dauerMinuten, dauerRegel } from '../dauer';
import type { RasterZeile } from './raster';
import { MINDEST_MS } from './raster';
import { PAUSE, postenEingabe } from './schichtplanZeilen';

/**
 * „Schichten erzeugen“ (LLH-1584, Server LLH-1552): füllt einen Zeitraum an einem Posten mit
 * gleich langen Blöcken. Ohne Länge teilt der Server nach dem Schichtmodell des Einsatzes
 * (Rhythmus oder Wechselzeiten); der Platzhalter nennt es. Ohne Schichtmodell ist die Länge
 * Pflicht.
 *
 * Keine Vorschau: die Zerlegung rechnet nur der Server (`abloesung::schichtplan::zerlegung`,
 * Abstimmung 08.11.2026). Alles oder nichts: überschneidet sich eine erzeugte Schicht mit einem
 * Block, legt der Server nichts an und nennt je Block eine Zeile; die stehen im Dialog, der offen
 * bleibt. Die Pause ist kein Posten zum Erzeugen.
 */

/** Grenzen der Länge wie der Server (`BLOCK_MIN_MINUTEN`, `BLOCK_MAX_MINUTEN`, Raster 5 min). */
const LAENGE_MIN = 10;
const LAENGE_MAX = 1_440;

export interface ErzeugenWerte {
  posten: string;
  zeit: Zeitraum | null;
  laenge?: string;
}

interface SchichtenErzeugenDialogProps {
  zeilen: readonly RasterZeile[];
  /** Kurzform des Schichtmodells des Einsatzes („4 h“, „Wechsel 0600/1800“); `null` = keins. */
  schichtmodell: string | null;
  darfSchreiben: boolean;
  laeuft: boolean;
  speicherung: Speicherung;
  onErzeugen: (body: SchichtplanErzeugenBody) => Promise<unknown>;
  onSchliessen: () => void;
}

function zeitraumGueltig(z: Zeitraum | null | undefined): z is [Dayjs, Dayjs] {
  return !!z && !!z[0] && !!z[1];
}

/** Die Zeilen einer Ablehnung „überschneidet sich mit …“, sonst leer. */
export function konfliktZeilen(fehler: unknown): string[] {
  if (!(fehler instanceof ApiError)) return [];
  return fehler.zeilen.filter((z) => z.art === 'planschicht').map((z) => z.grund);
}

export default function SchichtenErzeugenDialog({
  zeilen,
  schichtmodell,
  darfSchreiben,
  laeuft,
  speicherung,
  onErzeugen,
  onSchliessen,
}: SchichtenErzeugenDialogProps) {
  const [form] = Form.useForm<ErzeugenWerte>();
  const postenOptionen = zeilen
    .filter((z) => z.schluessel !== PAUSE)
    .map((z) => ({ value: z.schluessel, label: z.gruppe ? `${z.titel} · ${z.gruppe}` : z.titel }));
  const konflikte = konfliktZeilen(speicherung.error);
  // Mit Konflikten nennt der Dialog Meldung und Zeilen in einem Hinweis; die Hülle zeigt dann
  // keinen zweiten.
  const huelle: Speicherung = konflikte.length > 0 ? { ...speicherung, error: null } : speicherung;
  const pflicht = schichtmodell == null;

  const erzeugen = (w: ErzeugenWerte) => {
    if (!zeitraumGueltig(w.zeit)) return Promise.reject(new Error('Zeit fehlt'));
    const posten = postenEingabe(w.posten);
    if (!posten) return Promise.reject(new Error('Posten fehlt'));
    const body: SchichtplanErzeugenBody = {
      posten,
      von: alsBackendZeit(w.zeit[0]),
      bis: alsBackendZeit(w.zeit[1]),
    };
    const laenge = dauerMinuten(w.laenge);
    if (laenge != null) body.laenge_minuten = laenge;
    return onErzeugen(body);
  };

  return (
    <ErfassungsModal<ErzeugenWerte>
      offen
      titel="Schichten erzeugen"
      form={form}
      initialValues={{ zeit: null }}
      erfassenText="Schichten erzeugen"
      laeuft={laeuft}
      gesperrt={!darfSchreiben}
      speicherung={huelle}
      speicherFehlerTitel="Keine Schichten erzeugt"
      onErfassen={erzeugen}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<ErzeugenWerte>
        name="posten"
        label="Posten"
        rules={[{ required: true, message: 'Bitte einen Posten wählen' }]}
      >
        <Select placeholder="Posten wählen…" options={postenOptionen} />
      </Form.Item>
      <Form.Item<ErzeugenWerte>
        name="zeit"
        label="Zeit"
        rules={[
          {
            validator: (_, z: Zeitraum | null) => {
              if (!zeitraumGueltig(z)) return Promise.reject(new Error('Beginn und Ende angeben'));
              if (z[1].valueOf() - z[0].valueOf() < MINDEST_MS)
                return Promise.reject(new Error('Mindestens 10 Minuten'));
              if (z.some((t) => t.minute() % 5 !== 0 || t.second() !== 0 || t.millisecond() !== 0))
                return Promise.reject(new Error('Auf volle 5 Minuten'));
              return Promise.resolve();
            },
          },
        ]}
      >
        <ZeitraumEingabe art="frist" />
      </Form.Item>
      <Form.Item<ErzeugenWerte>
        name="laenge"
        label="Länge je Schicht"
        required={pflicht}
        rules={[
          dauerRegel({
            pflicht,
            min: LAENGE_MIN,
            max: LAENGE_MAX,
            pflichtText: 'Bitte eine Länge angeben',
          }),
          {
            validator: (_, wert: string | undefined) => {
              const m = dauerMinuten(wert);
              return m != null && m % 5 !== 0
                ? Promise.reject(new Error('Auf volle 5 Minuten'))
                : Promise.resolve();
            },
          },
        ]}
      >
        <Input
          placeholder={schichtmodell != null ? einsatzVorgabe(schichtmodell) : undefined}
          autoComplete="off"
        />
      </Form.Item>
      {konflikte.length > 0 && (
        <Alert
          type="error"
          showIcon
          data-lfh="schichtplan-erzeugen-konflikte"
          title="Keine Schichten erzeugt"
          description={
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {konflikte.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          }
        />
      )}
    </ErfassungsModal>
  );
}
