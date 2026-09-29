import SichtungsTag from '../components/SichtungsTag';
import { Collapse, Form, Input, InputNumber, Radio, theme } from 'antd';
import type { CSSProperties } from 'react';
import { Select } from '../components/Select';
import type { PersonEingabe } from '../api/einsatzPerson';
import type { Sichtungskategorie } from '../api/types';
import { parseKoordinate } from './koordinate';
import { KoordinateFeld, VermisstSeitFeld } from './LagedatenFelder';

/**
 * Werte der Personen-Aufnahme: `PersonEingabe` plus Erst-Sichtung — `status` leitet der
 * Aufrufer ab, `client_id` setzt der Offline-Pfad. Ein `Form.useForm<PersonEingabe>` darüber
 * verlöre `sichtung` still.
 */
export type AufnahmeEingabe = PersonEingabe & { sichtung?: Sichtungskategorie };

/**
 * Die FORMULARwerte: `AufnahmeEingabe` bis auf die Koordinate, die als EIN Textfeld
 * (`52.2691/9.1342`) steht und erst in {@link aufnahmeZuEingabe} zerlegt wird. „vermisst seit"
 * liegt schon als Wire-String (UTC) im Formular.
 */
export type AufnahmeWerte = Omit<AufnahmeEingabe, 'antreff_lat' | 'antreff_lon'> & {
  koordinate?: string;
};

/**
 * Formularwerte → Anlage; beide Mounts rufen sie. Nur GESETZTE Werte gehen mit
 * (`vermisst_seit` ohne Angabe fehlt, dann setzt der Server die Meldezeit). Ein unbrauchbarer
 * Koordinatentext erreicht diese Funktion nicht — die Feldprüfung hält vorher an.
 */
export function aufnahmeZuEingabe(werte: AufnahmeWerte): AufnahmeEingabe {
  const { koordinate, vermisst_seit, ...rest } = werte;
  const k = koordinate && koordinate.trim() !== '' ? parseKoordinate(koordinate) : null;
  return {
    ...rest,
    ...(k?.ok ? { antreff_lat: k.lat, antreff_lon: k.lon } : {}),
    ...(vermisst_seit ? { vermisst_seit } : {}),
  };
}

/** Erfassungs-Modi der Personen-Aufnahme. */
export type AufnahmeModus = 'schnell' | 'vermisst' | 'betroffen';

/** Reihenfolge der Auswahlflächen — Dringlichkeit zuerst, wie an der Aufnahme gesprochen. */
const SK_REIHE: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot', 'unverletzt'];

/**
 * Boden der Sichtungs-Auswahlflächen: 64 px oder die Dichtestufe, je nachdem, was größer ist
 * (im Handschuh-Betrieb gewinnt 72). Rein und exportiert, damit über zwei Dichtestufen prüfbar.
 */
export function skFlaechenStil(token: { controlHeight: number }): CSSProperties {
  return {
    minHeight: Math.max(64, token.controlHeight),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  };
}

/**
 * Die Feldgruppe der Personen-Aufnahme — **ohne eigenes `<Form>`**, für zwei Mounts
 * (`PersonErfassungModal` und `pages/personen/AufnahmePage`): eine Maske, ein Feldbudget.
 *
 * ── FELDBUDGET: VIER SICHTBARE FELDER ──────────────────────────────
 * Sichtung, Geschlecht, Geschätztes Alter, Antreffort. Der Name liegt unter „Weitere Angaben":
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
export default function AufnahmeFelder({ modus }: { modus: AufnahmeModus }) {
  const { token } = theme.useToken();
  const flaeche = skFlaechenStil(token);

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
          <VermisstSeitFeld hinweis="Ohne Angabe gilt der Zeitpunkt der Meldung." />
          <Form.Item label="Melder / Kontakt" name="melder_kontakt">
            <Input placeholder="Angehöriger, Kontaktdaten" />
          </Form.Item>
        </>
      )}
      {modus !== 'vermisst' && (
        <>
          <Form.Item label="Zustand" name="zustand">
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
      {modus !== 'vermisst' && (
        <Form.Item label="Sichtungskategorie" name="sichtung">
          {/* Dieselbe fachliche Kennzeichnung wie in Liste und Verlauf; die Beschriftung trägt den
             Textkontrast unabhängig von SK-Farbe und Radio-Zustand. */}
          {/* `aria-label` zusätzlich zum `Form.Item`-Label: `label[for]` benennt nur labelable elements,
             und eine `Radio.Group` (`div[role="radiogroup"]`) gehört nicht dazu — sonst stünden sechs
             Flächen in einer namenlosen Gruppe. */}
          <Radio.Group
            name="sichtung"
            aria-label="Sichtungskategorie"
            optionType="button"
            buttonStyle="outline"
          >
            {SK_REIHE.map((k) => (
              <Radio.Button key={k} value={k} style={flaeche}>
                <SichtungsTag kategorie={k} style={{ marginInlineEnd: 0 }} />
              </Radio.Button>
            ))}
          </Radio.Group>
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
      {/* „Antreffort" ist bewusst das LETZTE sichtbare Eingabefeld: Enter darin sendet ab, und der Ort
         steht am Ende eines Aufnahmegesprächs. */}
      <Form.Item label="Antreffort" name="antreff_ort">
        <Input placeholder="z. B. Brücke, Sammelstelle" />
      </Form.Item>
      <Collapse
        ghost
        items={[{ key: 'weitere', label: 'Weitere Angaben', children: weitereAngaben }]}
      />
    </>
  );
}
