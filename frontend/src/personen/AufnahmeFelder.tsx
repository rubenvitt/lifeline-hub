import SichtungsTag from '../components/SichtungsTag';
import { Collapse, Form, Input, InputNumber, Radio, theme } from 'antd';
import type { CSSProperties } from 'react';
import { Select } from '../components/Select';
import type { PersonEingabe } from '../api/einsatzPerson';
import type { Sichtungskategorie } from '../api/types';
import { parseKoordinate } from './koordinate';
import { KoordinateFeld, VermisstSeitFeld } from './LagedatenFelder';

/**
 * Werte der Personen-Aufnahme. `PersonEingabe` plus die Erst-Sichtung — und NUR diese
 * beiden: `status` leitet der Aufrufer aus seinem Modus ab, `client_id` setzt der
 * Offline-Pfad. Der Typ läuft unverändert durch Formular, Hülle und Mutation; ein
 * `Form.useForm<PersonEingabe>` darüber verlöre `sichtung` still.
 */
export type AufnahmeEingabe = PersonEingabe & { sichtung?: Sichtungskategorie };

/**
 * Die FORMULARwerte der Maske — `AufnahmeEingabe` bis auf die Koordinate: die steht als
 * EIN Textfeld (`52.2691/9.1342`, Design D6) statt als zwei Zahlen und wird erst von
 * {@link aufnahmeZuEingabe} in `antreff_lat`/`antreff_lon` zerlegt. „vermisst seit" liegt
 * schon im Formular als Wire-String (UTC), die Umrechnung macht das `Form.Item` selbst.
 */
export type AufnahmeWerte = Omit<AufnahmeEingabe, 'antreff_lat' | 'antreff_lon'> & {
  koordinate?: string;
};

/**
 * Formularwerte → Anlage. Beide Mounts rufen sie, damit es EINE Zerlegung gibt.
 *
 * Nur GESETZTE Werte gehen mit: `vermisst_seit` fehlt ohne Angabe ganz (dann setzt der
 * Server die Meldezeit), eine leere Koordinate ebenso. Ein unbrauchbarer Koordinatentext
 * erreicht diese Funktion nicht — die Feldprüfung hält das Absenden vorher an.
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
 * Boden der Sichtungs-Auswahlflächen: **64 px oder die Dichtestufe, je nachdem, was größer
 * ist**. Die 64 px sind eine Untergrenze aus dem Ticket, kein Sollwert — im
 * Handschuh-Betrieb steht `controlHeight` auf 72 und gewinnt.
 *
 * Rein und exportiert (Muster `bedienzielStil`): so ist die Zusicherung über zwei
 * Dichtestufen prüfbar, ohne zu rendern — jsdom rechnet kein Layout, ein gemessenes Pixel
 * gäbe es dort ohnehin nicht.
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
 * Die Feldgruppe der Personen-Aufnahme — **ohne eigenes `<Form>`**.
 *
 * Ein Bauteil, zwei Mounts: das Schnellerfassungs-Modal (`PersonErfassungModal`) und die
 * Aufnahme-Route (`pages/personen/AufnahmePage`) zeigen dieselben Felder in derselben
 * Reihenfolge. Zwei Kopien wären zwei Feldbudgets, zwei Tastaturwege und zwei Stellen, an
 * denen die Sichtung fehlen kann.
 *
 * ── FELDBUDGET: VIER SICHTBARE FELDER ──────────────────────────────
 *
 * Sichtung, Geschlecht, Geschätztes Alter, Antreffort. **Der Name ist unter „Weitere
 * Angaben" gewandert** (bis LFH-340 · C5 war er sichtbar): an der Aufnahme wird zuerst die
 * Kategorie vergeben — das ist die Angabe, an der die Lage hängt —, und der Name ist der
 * langsamste Teil und in der Masse der Fälle unbekannt. Pflichtfelder gibt es weiterhin
 * keine: eine Person, von der man nichts weiß, muss trotzdem erfassbar sein.
 *
 * Unter „Weitere Angaben" (LFH-613) liegen zusätzlich **Zustand** und **Koordinate**
 * (Fundort als `52.2691/9.1342`, geprüft über `personen/koordinate.ts` — dieselbe Funktion
 * wie in der Schnellerfassungszeile und auf der Detailseite), im Vermisst-Modus statt
 * ihrer **„vermisst seit"**. Das sichtbare Budget wächst dadurch nicht. Der Collapse bleibt
 * OHNE `forceRender` (Entscheidung und Beleg in `PersonErfassungModal.test.tsx`): ein Wert
 * entsteht nur aufgeklappt, und einmal aufgeklappt bleibt der Bereich eingehängt — eine
 * ungültige Koordinate hält das Absenden also auch nach dem Zuklappen an.
 *
 * Zustand und Koordinate fehlen im Vermisst-Modus: beide beschreiben eine ANGETROFFENE
 * Person — eine Koordinate an einer vermissten Person stünde auf der Betroffenen-Karte wie
 * ein Fundort. „vermisst seit" fehlt umgekehrt außerhalb: das Backend lehnt es ohne Status
 * `vermisst` mit 422 ab.
 *
 * ── DIE SICHTUNG FEHLT IM VERMISST-MODUS, UND ZWAR MIT ABSICHT ─────
 *
 * Eine vermisste Person ist nicht angetroffen und damit nicht sichtbar. Das ist keine
 * Anzeige-Entscheidung, sondern der Vertrag: `POST /personen` antwortet auf die Kombination
 * `status: 'vermisst'` + `sichtung` mit 422 (`src/routes/einsatz_person.rs`). Ein Feld, das
 * hier stünde, könnte nur einen Fehler erzeugen.
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
          {/* LFH-455: dieselbe fachliche Kennzeichnung wie in Liste und Verlauf.
              Die Farbfelder sind keine Auswahlflächen; ihre Beschriftung trägt den
              Textkontrast unabhängig von der SK-Farbe und dem Radio-Zustand. */}
          {/* `aria-label` zusätzlich zum `Form.Item`-Label, und das ist kein Gürtel-plus-
              Hosenträger: antds `FormItemLabel` rendert ausschließlich `<label htmlFor>`,
              und `label[for]` benennt in HTML nur *labelable elements*. Eine
              `Radio.Group` ist ein `div[role="radiogroup"]` und gehört nicht dazu — ohne
              den Namen stünden hier sechs Auswahlflächen in einer namenlosen Gruppe.
              Dieselbe Lösung trugen bis LFH-392 die zwei `Segmented` der Kopfzeile
              („Farbschema wählen", „Bediendichte wählen"); sie sind fort, die
              Begründung darüber steht für sich. */}
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
      {/* „Antreffort" ist bewusst das LETZTE sichtbare Eingabefeld: Enter darin sendet ab
          (Zusicherung 1 der Erfassungs-Hülle), und der Ort ist die Angabe, die am Ende
          eines Aufnahmegesprächs steht. */}
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
