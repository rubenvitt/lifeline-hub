import { Collapse, Form, Input, InputNumber, Typography } from 'antd';
import { Select } from '../components/Select';
import type { PersonEingabe } from '../api/einsatzPerson';
import type { Sichtungskategorie } from '../api/types';
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
 * Die FORMULARwerte: `AufnahmeEingabe` bis auf die Koordinate, die als EIN Textfeld
 * (`52.2691/9.1342`) steht und erst in {@link aufnahmeZuEingabe} zerlegt wird. „vermisst seit"
 * liegt schon als Wire-String (UTC) im Formular.
 */
export type AufnahmeWerte = Omit<AufnahmeEingabe, 'antreff_lat' | 'antreff_lon' | 'sichtung'> & {
  koordinate?: string;
  sichtung?: Sichtungskategorie | null;
};

/**
 * Formularwerte → Anlage; beide Mounts rufen sie. Nur GESETZTE Werte gehen mit
 * (`vermisst_seit` ohne Angabe fehlt, dann setzt der Server die Meldezeit). Ein unbrauchbarer
 * Koordinatentext erreicht diese Funktion nicht — die Feldprüfung hält vorher an.
 */
export function aufnahmeZuEingabe(werte: AufnahmeWerte): AufnahmeEingabe {
  const { koordinate, vermisst_seit, bestaetigt_personal_id, sichtung, ...rest } = werte;
  const k = koordinate && koordinate.trim() !== '' ? parseKoordinate(koordinate) : null;
  return {
    ...rest,
    // Eine zurückgenommene Wahl (`SichtungsWahl abwaehlbar` meldet `null`) heißt: ohne Sichtung.
    ...(sichtung ? { sichtung } : {}),
    // Ohne Erst-Sichtung gibt es nichts zu bestätigen (sonst 422).
    ...(sichtung && bestaetigt_personal_id != null ? { bestaetigt_personal_id } : {}),
    ...(k?.ok ? { antreff_lat: k.lat, antreff_lon: k.lon } : {}),
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
 * Unter „Weitere Angaben" liegen außerdem Zustand und Koordinate (geprüft über
 * `personen/koordinate.ts`), im Vermisst-Modus statt ihrer „vermisst seit". Der Collapse bleibt
 * OHNE `forceRender` (Beleg in `PersonErfassungModal.test.tsx`): ein Wert entsteht nur
 * aufgeklappt, und einmal aufgeklappt bleibt der Bereich eingehängt.
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
  /** Für „Bestätigt von“ am UHS-Gerät (LFH-1046); ohne Kennung kein Feld. */
  einsatzId?: number;
  /** Ohne Sichtung und ohne ihren Folgestatus, etwa am Gerät einer Betreuungsstelle (LFH-1041). */
  ohneSichtung?: boolean;
}) {
  const weitereAngaben = (
    <>
      <Form.Item label="Name" name="name">
        <Input />
      </Form.Item>
      <Form.Item label="Vorname" name="vorname">
        <Input />
      </Form.Item>
      {modus === 'vermisst' && (
        <>
          <VermisstSeitFeld platzhalter="Zeitpunkt der Meldung" />
          <Form.Item label="Melder / Kontakt" name="melder_kontakt">
            <Input placeholder="Angehöriger, Kontaktdaten" />
          </Form.Item>
        </>
      )}
      {modus !== 'vermisst' && (
        <>
          {einsatzId != null && <BestaetigtVonFeld einsatzId={einsatzId} />}
          <Form.Item label="Zustand / Verdacht" name="zustand">
            <Input placeholder="z. B. gehfähig, unterkühlt" />
          </Form.Item>
          <KoordinateFeld />
        </>
      )}
      <Form.Item label="Notiz" name="notiz">
        <Input.TextArea rows={2} />
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
      {/* „Fundort" ist bewusst das LETZTE sichtbare Eingabefeld: Enter darin sendet ab, und der Ort
         steht am Ende eines Aufnahmegesprächs. */}
      <Form.Item label="Fundort" name="antreff_ort">
        <Input placeholder="z. B. Brücke, Sammelstelle" />
      </Form.Item>
      <Collapse
        ghost
        items={[{ key: 'weitere', label: 'Weitere Angaben', children: weitereAngaben }]}
      />
    </>
  );
}
