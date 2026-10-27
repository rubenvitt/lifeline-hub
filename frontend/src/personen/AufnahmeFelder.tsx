import { Collapse, Form, Input, InputNumber, Typography } from 'antd';
import { Select } from '../components/Select';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import {
  PERSON_ANGABE_MAX,
  PERSON_NAME_MAX,
  PERSON_NOTIZ_MAX,
  PERSON_ZUSTAND_MAX,
} from '../api/eingabegrenzen';
import type { PersonEingabe } from '../api/einsatzPerson';
import type { Sichtungskategorie } from '../api/types';
import { EinsatzOrtsfeld } from '../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../anzeige/Ortsfeld';
import { ortFelder, ortRegeln } from '../anzeige/ortsfeldFormular';
import { useAuthOptional } from '../auth/AuthContext';
import { parseKoordinate } from './koordinate';
import { KoordinateFeld, VermisstSeitFeld } from './LagedatenFelder';
import BestaetigtVonFeld from '../geraet/BestaetigtVonFeld';
import SichtungsWahl from './SichtungsWahl';

/**
 * Werte der Personen-Aufnahme: `PersonEingabe` plus Erst-Sichtung — `status` leitet der
 * Aufrufer ab, `client_id` setzt der Offline-Pfad. Ein `Form.useForm<PersonEingabe>` darüber
 * verlöre `sichtung` still.
 */
export type AufnahmeEingabe = PersonEingabe & {
  sichtung?: Sichtungskategorie;
  /** Wer die Erst-Sichtung am UHS-Gerät bestätigt (LFH-1046); ohne Sichtung fällt es weg. */
  bestaetigt_personal_id?: number | null;
};

/**
 * Die FORMULARwerte: `AufnahmeEingabe` bis auf den Fundort und die Koordinate. Der Fundort ist ein
 * Ortsfeld-Wert (Text und Koordinate, LLH-1407); am gekoppelten Gerät steht die Koordinate als EIN
 * Textfeld (`52.2691/9.1342`) daneben. Zerlegt wird erst in {@link aufnahmeZuEingabe}. „vermisst
 * seit" liegt schon als Wire-String (UTC) im Formular.
 */
export type AufnahmeWerte = Omit<
  AufnahmeEingabe,
  'antreff_ort' | 'antreff_lat' | 'antreff_lon' | 'sichtung'
> & {
  antreff_ort?: OrtsfeldWert;
  koordinate?: string;
  sichtung?: Sichtungskategorie | null;
};

/** Ein gemerkter Fundort (nur Text, `components/erfassungsSitzung.ts`) als Wert des Felds. */
export function fundortAusText(text: string): OrtsfeldWert {
  return { text, koordinate: null };
}

/**
 * Formularwerte → Anlage; beide Mounts rufen sie. Nur GESETZTE Werte gehen mit
 * (`vermisst_seit` ohne Angabe fehlt, dann setzt der Server die Meldezeit). Die Koordinate kommt
 * aus dem Ortsfeld, am Gerät aus dem Koordinatenfeld. Ein unbrauchbarer Koordinatentext erreicht
 * diese Funktion nicht — die Feldprüfung hält vorher an.
 */
export function aufnahmeZuEingabe(werte: AufnahmeWerte): AufnahmeEingabe {
  const { antreff_ort, koordinate, vermisst_seit, bestaetigt_personal_id, sichtung, ...rest } =
    werte;
  const ort = ortFelder(antreff_ort);
  const getippt = koordinate && koordinate.trim() !== '' ? parseKoordinate(koordinate) : null;
  const k =
    ort.lat != null && ort.lon != null
      ? { lat: ort.lat, lon: ort.lon }
      : getippt?.ok
        ? { lat: getippt.lat, lon: getippt.lon }
        : null;
  return {
    ...rest,
    ...(ort.text != null ? { antreff_ort: ort.text } : {}),
    // Eine zurückgenommene Wahl (`SichtungsWahl abwaehlbar` meldet `null`) heißt: ohne Sichtung.
    ...(sichtung ? { sichtung } : {}),
    // Ohne Erst-Sichtung gibt es nichts zu bestätigen (sonst 422).
    ...(sichtung && bestaetigt_personal_id != null ? { bestaetigt_personal_id } : {}),
    ...(k ? { antreff_lat: k.lat, antreff_lon: k.lon } : {}),
    ...(vermisst_seit ? { vermisst_seit } : {}),
  };
}

/**
 * Erfassungs-Modi der Personen-Aufnahme: EINE allgemeine Maske und „Vermisst melden“ (LFH-963,
 * `personen/AGENTS.md`). Die allgemeine legt immer mit Status `erfasst` an; mit Sichtung hebt der
 * Server auf `betroffen`.
 */
export type AufnahmeModus = 'erfassen' | 'vermisst';

/** Der Folgestatus der allgemeinen Maske, sichtbar im Dialog (LFH-963, Entscheidung 9). */
export const FOLGESTATUS_HINWEIS = 'Status: erfasst · mit Sichtung → betroffen';

/**
 * Die Feldgruppe der Personen-Aufnahme — **ohne eigenes `<Form>`**, für zwei Mounts
 * (`PersonErfassungModal` und `pages/personen/AufnahmePage`): eine Maske, ein Feldbudget.
 *
 * ── FELDBUDGET: VIER SICHTBARE FELDER ──────────────────────────────
 * Sichtung, Geschlecht, Geschätztes Alter, Fundort. Der Name liegt unter „Weitere Angaben":
 * an der Aufnahme wird zuerst die Kategorie vergeben, der Name ist meist unbekannt.
 * Pflichtfelder gibt es keine.
 *
 * Der Fundort ist ein Ortsfeld mit Suche im Einsatz und Kartenvorschau (LLH-1407): ein Treffer,
 * eine getippte Koordinate oder die Nadel liefern die Koordinate. Enter im Fundort sucht und sendet
 * nicht ab; gespeichert wird über den Knopf. Am gekoppelten Gerät gibt es keine Ortssuche (seine
 * Routenliste, `src/geraet/mod.rs`): dort ist der Fundort Text, und die Koordinate steht als
 * eigenes Feld unter „Weitere Angaben" (geprüft über `personen/koordinate.ts`).
 *
 * Unter „Weitere Angaben" liegt außerdem der Zustand, im Vermisst-Modus statt seiner „vermisst
 * seit". Der Collapse bleibt
 * OHNE `forceRender` (Beleg in `PersonErfassungModal.test.tsx`): ein Wert entsteht nur
 * aufgeklappt, und einmal aufgeklappt bleibt der Bereich eingehängt.
 *
 * Jeder Freitext trägt die Grenze des Servers (LLH-1329, `api/eingabegrenzen.ts`): Zähler ab
 * 80 % über `zeichenGrenze`, Sperre über `zeichenRegel`, nie gekürzt.
 *
 * Zustand und Koordinate fehlen im Vermisst-Modus (sie beschreiben eine angetroffene Person);
 * „vermisst seit" fehlt außerhalb (das Backend lehnt es ohne `vermisst` mit 422 ab).
 *
 * ── DIE SICHTUNG FEHLT IM VERMISST-MODUS ───────────────────────────
 * Eine vermisste Person ist nicht angetroffen. `POST /personen` antwortet auf `vermisst` +
 * `sichtung` mit 422 — ein Feld hier könnte nur einen Fehler erzeugen.
 */
export default function AufnahmeFelder({
  modus,
  einsatzId,
  ohneSichtung = false,
}: {
  modus: AufnahmeModus;
  /**
   * Für „Bestätigt von“ am UHS-Gerät (LFH-1046) und die Ortssuche des Fundorts (LLH-1407); ohne
   * Kennung beides nicht.
   */
  einsatzId?: number;
  /** Ohne Sichtung und ohne ihren Folgestatus, etwa am Gerät einer Betreuungsstelle (LFH-1041). */
  ohneSichtung?: boolean;
}) {
  const geraet = useAuthOptional()?.geraet ?? null;
  const ortssuche = einsatzId != null && geraet == null;
  const weitereAngaben = (
    <>
      <Form.Item label="Name" name="name" rules={[zeichenRegel(PERSON_NAME_MAX, 'Name')]}>
        <Input count={zeichenGrenze(PERSON_NAME_MAX)} />
      </Form.Item>
      <Form.Item label="Vorname" name="vorname" rules={[zeichenRegel(PERSON_NAME_MAX, 'Vorname')]}>
        <Input count={zeichenGrenze(PERSON_NAME_MAX)} />
      </Form.Item>
      {modus === 'vermisst' && (
        <>
          <VermisstSeitFeld platzhalter="Zeitpunkt der Meldung" />
          <Form.Item
            label="Melder / Kontakt"
            name="melder_kontakt"
            rules={[zeichenRegel(PERSON_ANGABE_MAX, 'Melder / Kontakt')]}
          >
            <Input
              placeholder="Angehöriger, Kontaktdaten"
              count={zeichenGrenze(PERSON_ANGABE_MAX)}
            />
          </Form.Item>
        </>
      )}
      {modus !== 'vermisst' && (
        <>
          {einsatzId != null && <BestaetigtVonFeld einsatzId={einsatzId} />}
          <Form.Item
            label="Zustand / Verdacht"
            name="zustand"
            rules={[zeichenRegel(PERSON_ZUSTAND_MAX, 'Zustand / Verdacht')]}
          >
            <Input
              placeholder="z. B. gehfähig, unterkühlt"
              count={zeichenGrenze(PERSON_ZUSTAND_MAX)}
            />
          </Form.Item>
          {!ortssuche && <KoordinateFeld />}
        </>
      )}
      <Form.Item label="Notiz" name="notiz" rules={[zeichenRegel(PERSON_NOTIZ_MAX, 'Notiz')]}>
        <Input.TextArea rows={2} count={zeichenGrenze(PERSON_NOTIZ_MAX)} />
      </Form.Item>
    </>
  );

  return (
    <>
      {/* Text, kein Feld: das Budget von vier sichtbaren Feldern bleibt. Er sagt, was die Maske
          anlegt, damit niemand zwischen zwei Knöpfen raten muss (LFH-963). */}
      {modus === 'erfassen' && !ohneSichtung && (
        <Typography.Paragraph data-lfh="folgestatus" type="secondary">
          {FOLGESTATUS_HINWEIS}
        </Typography.Paragraph>
      )}
      {modus !== 'vermisst' && !ohneSichtung && (
        <Form.Item label="Sichtungskategorie" name="sichtung">
          {/* Dieselbe Wahl wie bei der Nachsichtung (LLH-1083); abwählbar, denn eine Person darf
             ohne Sichtung entstehen (`FOLGESTATUS_HINWEIS`). Die Gruppe trägt ihren Namen selbst:
             `label[for]` benennt keine `radiogroup`. */}
          <SichtungsWahl abwaehlbar aria-label="Sichtungskategorie" />
        </Form.Item>
      )}
      <Form.Item label="Geschlecht" name="geschlecht">
        <Select
          allowClear
          placeholder="unbekannt"
          options={[
            { value: 'maennlich', label: 'männlich' },
            { value: 'weiblich', label: 'weiblich' },
            { value: 'divers', label: 'divers' },
            { value: 'unbekannt', label: 'unbekannt' },
          ]}
        />
      </Form.Item>
      <Form.Item label="Geschätztes Alter (Jahre)" name="alter_geschaetzt">
        <InputNumber min={0} max={120} style={{ width: 140 }} />
      </Form.Item>
      {/* „Fundort" ist das LETZTE sichtbare Eingabefeld: der Ort steht am Ende eines
         Aufnahmegesprächs. */}
      {ortssuche ? (
        <Form.Item
          label="Fundort"
          name="antreff_ort"
          rules={ortRegeln(PERSON_ANGABE_MAX, 'Fundort')}
        >
          <EinsatzOrtsfeld
            einsatzId={einsatzId}
            etikett="Fundort"
            count={zeichenGrenze(PERSON_ANGABE_MAX)}
          />
        </Form.Item>
      ) : (
        // Am Gerät nur Text; der Wert bleibt ein Ortsfeld-Wert, damit beide Wege gleich zerlegen.
        <Form.Item
          label="Fundort"
          name="antreff_ort"
          rules={ortRegeln(PERSON_ANGABE_MAX, 'Fundort')}
          getValueProps={(w?: OrtsfeldWert) => ({ value: w?.text ?? '' })}
          normalize={(text: string) => fundortAusText(text)}
        >
          <Input
            placeholder="z. B. Brücke, Sammelstelle"
            count={zeichenGrenze(PERSON_ANGABE_MAX)}
          />
        </Form.Item>
      )}
      <Collapse
        ghost
        items={[{ key: 'weitere', label: 'Weitere Angaben', children: weitereAngaben }]}
      />
    </>
  );
}
