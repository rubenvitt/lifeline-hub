import { Collapse, Form, Input, InputNumber, Radio, Tag, theme } from 'antd';
import type { CSSProperties } from 'react';
import { Select } from '../components/Select';
import { SK_META } from './personMeta';
import type { PersonEingabe } from '../api/einsatzPerson';
import type { Sichtungskategorie } from '../api/types';

/**
 * Werte der Personen-Aufnahme. `PersonEingabe` plus die Erst-Sichtung — und NUR diese
 * beiden: `status` leitet der Aufrufer aus seinem Modus ab, `client_id` setzt der
 * Offline-Pfad. Der Typ läuft unverändert durch Formular, Hülle und Mutation; ein
 * `Form.useForm<PersonEingabe>` darüber verlöre `sichtung` still.
 */
export type AufnahmeEingabe = PersonEingabe & { sichtung?: Sichtungskategorie };

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
      <Form.Item label="Name" name="name"><Input /></Form.Item>
      <Form.Item label="Vorname" name="vorname"><Input /></Form.Item>
      {modus === 'vermisst' && (
        <Form.Item label="Melder / Kontakt" name="melder_kontakt">
          <Input placeholder="Angehöriger, Kontaktdaten" />
        </Form.Item>
      )}
      <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
    </>
  );

  return (
    <>
      {modus !== 'vermisst' && (
        <Form.Item label="Sichtungskategorie" name="sichtung">
          {/**
            * `name` ist Pflicht, nicht Zierde: zwei Radio-Gruppen ohne ihn gruppieren im
            * selben Teilbaum nativ zusammen.
            *
            * DIE FARBE TRÄGT EIN `Tag` IN DER FLÄCHE, nicht die Fläche selbst. Das Ticket
            * sagt „SK_META-Farben"; `SK_META` führt aber antd-TAG-Farbnamen („red", „gold",
            * „default"), keine CSS-Werte. Sie in ein `style={{ color }}` zu schreiben wäre
            * ein ANDERER Farbton als überall sonst — CSS-`gold` ist nicht antds Gold — und
            * damit ein erfundener Farbwert, den `theme/tokens.ts` nicht kennt. Mit dem `Tag`
            * steht hier dieselbe Farbe wie in Liste und Detailseite.
            *
            * WAS DAS NICHT IST: eine Einlösung von „Statusfarbe nur als Punkt/Rand/Beistrich,
            * nie als Textfläche". Ein früherer Stand dieses Kommentars hat das behauptet und
            * lag falsch (im Review gemessen): antds `Tag` steht per Vorgabe auf
            * `variant: 'filled'` und rechnet in JEDEM Zweig einen Hintergrund
            * (`tag/hooks/useColor.js`). Das `Tag` ist gegenüber einer eingefärbten
            * Auswahlfläche die kleinere Fläche und die im Repo etablierte SK-Darstellung —
            * mehr sagt es nicht.
            *
            * DAZU EIN OFFENER BESTANDSBEFUND, den C5 nicht verursacht, aber stärker belichtet
            * hat: `SK_META.tot.color = 'black'` ist KEIN antd-Preset (die Liste führt 13
            * Namen, `black` ist keiner). Für Nicht-Presets rechnet `useColor` ein statisches
            * Paar aus der Zeichenkette — Grund auf `hsl.l = 0.95`, Text im Ton —, das weder
            * `theme/tokens.ts` noch den Nachtmodus kennt und dort unverändert hell steht.
            * Die Farbachse der Betroffenen-Module liegt als LFH-455.
            *
            * Der zweite Kanal (WCAG 1.4.1) ist die Beschriftung selbst: „SK I" sagt es auch
            * ohne jede Farbe. Deshalb ist auch „unverletzt" mit `color: 'default'`
            * vollwertig und braucht keinen erfundenen Ton.
            */}
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
                <Tag color={SK_META[k].color} style={{ marginInlineEnd: 0 }}>
                  {SK_META[k].label}
                </Tag>
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
