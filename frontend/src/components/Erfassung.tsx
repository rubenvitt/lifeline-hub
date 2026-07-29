import { Button, Checkbox, Form, Modal, Space, Typography, theme } from 'antd';
import type { FormInstance, FormProps } from 'antd';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Schnellerfassungs-Primitive (LFH-332 · B4) — Formularhülle, Serienmodus,
 * Wertübernahme.
 *
 * **Das Problem, gemessen am 29.07.2026.** 26 Erfassungsdialoge senden über
 * `onOk` am Modal, also mit einem Absende-Knopf ausserhalb des `<form>`; Enter
 * löst dort nichts aus. `autoFocus` kommt in den geprüften Erfassungs- und
 * Stammdatenmasken kein einziges Mal vor. Neun von neun Stammdaten-Modalen
 * schliessen nach jedem Speichern. An Aufnahme, BHP und BTP wird im Minutentakt
 * erfasst — dort kostet genau das die meiste Zeit.
 *
 * ── DREI ZUSICHERUNGEN ─────────────────────────────────────────────
 *
 * 1. **Der Absende-Knopf liegt im Formular.** Deshalb sendet Enter in einem
 *    Eingabefeld ab — das ist die eingebaute Formularübermittlung des Browsers,
 *    kein nachgebauter Tastaturbehandler. Ein `Input.TextArea` bleibt davon
 *    unberührt: dort erzeugt Enter weiterhin einen Zeilenumbruch, weil ein
 *    mehrzeiliges Feld an der Übermittlung nicht teilnimmt.
 * 2. **Der Fokus steht beim Öffnen im ersten Feld** und kehrt nach jedem
 *    Serien-Speichern dorthin zurück.
 * 3. **Zurückgesetzt wird auf JEDEM Weg hinaus** — nach dem Erfassen, über den
 *    Abbrechen-Knopf, über das Schliesskreuz, über Escape und über den Klick auf
 *    die Maske. Die letzten drei laufen nicht durch das Formular; warum sie
 *    trotzdem zurücksetzen müssen und warum `destroyOnHidden` das eben NICHT
 *    erledigt, steht am `ErfassungsModal` weiter unten. Der Bestand machte das
 *    asymmetrisch: `SchadenErfassenModal` schliesst sich selbst,
 *    `PersonErfassungModal` wird vom Eltern geschlossen, die beiden
 *    Ad-hoc-Dialoge setzen nur im Erfolgsfall zurück, das Verbleib-Modal im
 *    UHS-Grundriss auf beiden. Diese Hülle vereinheitlicht das nach der
 *    strengsten der vier Varianten.
 *
 * ── ZWEI ABWEICHUNGEN VON DER TICKET-FORMULIERUNG ──────────────────
 *
 * Das Ticket verlangt „im Modal zusätzlich als visuell verstecktes
 * `<Button htmlType="submit">`". Das setzt voraus, dass die Knöpfe in der
 * Modal-Fusszeile bleiben. Diese Hülle rendert die Fusszeile stattdessen
 * **selbst und innerhalb** des Formulars (`footer={null}`) — damit ist der
 * sichtbare Knopf schon der Übermittlungsknopf, und ein versteckter Zwilling
 * wäre ein zweites Ding, das mit dem ersten synchron gehalten werden müsste,
 * ohne etwas hinzuzufügen. Im Repo gibt es ausserdem keinen
 * Sehhilfe-Versteckhelfer (`sr-only` o. ä.); der hätte für diesen einen Zweck
 * neu entstehen müssen.
 *
 * Der Zähler heisst **„Erfasst: n"**, nicht „heute erfasst: n". Er zählt, was
 * seit dem Öffnen dieses Dialogs gespeichert wurde — eine Tagesangabe wäre eine
 * Behauptung über Daten, die die Hülle nicht kennt.
 *
 * ── EINE FALLE ─────────────────────────────────────────────────────
 *
 * Nur der Primär-Knopf ist ein Übermittlungsknopf. „Speichern und nächste" ruft
 * `form.submit()` von Hand. Grund: Enter in einem Feld löst den **ersten**
 * Übermittlungsknopf im Baum aus. Wären es zwei, entschiede die Anordnung im
 * DOM darüber, was Enter tut — und die Anordnung ist eine Gestaltungsfrage
 * (primär steht rechts), keine Verhaltensfrage.
 */

/**
 * Erstes bedienbares Feld im Formular. Deckt bewusst auch antds `Select`,
 * `AutoComplete` und `DatePicker` ab — die rendern alle ein echtes `<input>`.
 */
const FOKUSSIERBAR = [
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
].join(', ');

function fokussiereErstesFeld(wurzel: HTMLElement | null) {
  wurzel?.querySelector<HTMLElement>(FOKUSSIERBAR)?.focus();
}

interface ErfassungsFormularProps<T> {
  /** Die Formularinstanz des Aufrufers (`Form.useForm()`). Die Hülle setzt sie zurück. */
  form: FormInstance<T>;
  /**
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`, nicht `mutate`) —
   * sonst leert die Hülle die Felder, obwohl der Datensatz nie ankam.
   */
  onErfassen: (werte: T) => Promise<unknown>;
  /** Einzel-Erfassen erfolgreich. Der Aufrufer schliesst; die Hülle hat bereits geleert. */
  onFertig: () => void;
  /** Abbrechen. Die Hülle leert vorher — der Aufrufer setzt nur seinen Offen-Zustand. */
  onAbbrechen?: () => void;
  /** Läuft die Mutation? Setzt beide Speicher-Knöpfe auf Ladeanzeige. */
  laeuft?: boolean;
  /** Beschriftung des Primär-Knopfes. Default `'Erfassen'`. */
  erfassenText?: string;
  /**
   * Serienmodus: zeigt „Speichern und nächste" und den Zähler. Für Masken, an
   * denen im Minutentakt erfasst wird.
   */
  serie?: boolean;
  /**
   * Wiederholfelder, die ein Serien-Speichern überleben (Trägerorganisation,
   * Meldeweg, Antreffort …). Nicht leer → die Hülle zeigt „Werte behalten".
   */
  uebernahme?: (keyof T & string)[];
  /** Startwerte. Werden bei jedem Zurücksetzen wieder wirksam. */
  initialValues?: FormProps<T>['initialValues'];
  /** Die `Form.Item`-Felder. */
  children: ReactNode;
}

/**
 * Die Formularhülle. Steht allein für Inline-Erfassung (Kommunikationsmodule)
 * und steckt in `ErfassungsModal` für Dialoge.
 */
export function ErfassungsFormular<T extends object>({
  form, onErfassen, onFertig, onAbbrechen, laeuft = false,
  erfassenText = 'Erfassen', serie = false, uebernahme, initialValues, children,
}: ErfassungsFormularProps<T>) {
  const { token } = theme.useToken();
  const wurzel = useRef<HTMLDivElement>(null);
  const [zaehler, setZaehler] = useState(0);
  const [behalten, setBehalten] = useState(true);
  // Ref statt State: der Wert wird zwischen Klick und `onFinish` im selben Zug
  // gelesen — ein State-Update wäre zu diesem Zeitpunkt noch nicht sichtbar.
  const serienlaufRef = useRef(false);

  /**
   * Der Fokus läuft über **zwei Effekte, nicht über eine Zeitangabe** — und das
   * ist die teuerste Lektion dieser Datei.
   *
   * Ein direkter `focus()` im Absende-Handler verpufft: React flusht danach noch
   * einen Renderdurchgang, und der Fokus landet gemessen auf `<body>`. Der
   * naheliegende Ausweg `requestAnimationFrame` behebt das — und handelt sich
   * zwei lastabhängige Fehler ein, beide von der vollen Vitest-Suite gefunden und
   * im Einzellauf unsichtbar:
   *
   * 1. Am Mount greift ein aufgeschobener Fokus, wann immer das Bild kommt —
   *    notfalls erst, wenn die Person schon tippt. Dann springt der Cursor mitten
   *    im Wortlaut ins erste Feld zurück (`Erfassung.test.tsx`, „Enter in der
   *    Textarea sendet NICHT ab").
   * 2. Nach dem Serien-Speichern kam das Bild unter Last später als die
   *    Erwartung des Tests (`PersonalPage.test.tsx:556`).
   *
   * Ein Effekt läuft **nach dem Commit** — also später als der direkte Aufruf und
   * dennoch an einem festen Punkt statt an einem Zeitpunkt. Der Zähler
   * `fokusTick` ist die Auslöse-Abhängigkeit; er zählt Serien-Speicherungen und
   * hat sonst keine Bedeutung.
   */
  const [fokusTick, setFokusTick] = useState(0);

  useEffect(() => {
    fokussiereErstesFeld(wurzel.current);
  }, []);

  useEffect(() => {
    if (fokusTick > 0) fokussiereErstesFeld(wurzel.current);
  }, [fokusTick]);

  const abschicken = useCallback(async (werte: T) => {
    const serienlauf = serienlaufRef.current;
    serienlaufRef.current = false;
    // Werte VOR dem Zurücksetzen sichern — danach sind sie weg.
    const behaltene = Object.fromEntries(
      (uebernahme ?? []).map((feld) => [feld, werte[feld]]),
    ) as Partial<T>;
    try {
      await onErfassen(werte);
    } catch {
      // Abgelehnt: nichts leeren, nichts schliessen. Den Fehler meldet die
      // Mutation des Aufrufers; hier bleibt der Wortlaut stehen.
      return;
    }
    setZaehler((n) => n + 1);
    if (!serienlauf) {
      form.resetFields();
      onFertig();
      return;
    }
    form.resetFields();
    if (behalten && uebernahme?.length) form.setFieldsValue(behaltene);
    setFokusTick((n) => n + 1);
  }, [behalten, form, onErfassen, onFertig, uebernahme]);

  function abbrechen() {
    form.resetFields();
    onAbbrechen?.();
  }

  return (
    <div ref={wurzel}>
      {/* `onFinishFailed` ist die zweite Hälfte von `serienlaufRef`. Scheitert die
          Prüfung, läuft `onFinish` NIE — die Marke bliebe auf „Serie" stehen und
          das nächste, reguläre Absenden nähme still den Serien-Zweig: gespeichert,
          Felder leer, Dialog offen. Wer dann ein zweites Mal drückt, legt den
          Datensatz doppelt an. Gemessen an einer Serien-Maske mit Pflichtfeld. */}
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={abschicken}
        onFinishFailed={() => { serienlaufRef.current = false; }}
      >
        {children}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: token.marginXS, flexWrap: 'wrap',
            marginTop: token.margin, paddingTop: token.paddingSM,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {/* Die Ansage-Region steht IMMER im Baum, auch bei 0. Wird sie erst
              zusammen mit ihrem ersten Text eingehängt, sagt der Screenreader
              genau die erste Speicherung nicht an — eine `aria-live`-Region meldet
              nur Änderungen an bereits vorhandenem Inhalt. */}
          {serie && (
            <Typography.Text type="secondary" aria-live="polite">
              {zaehler > 0 ? `Erfasst: ${zaehler}` : ''}
            </Typography.Text>
          )}
          {serie && uebernahme != null && uebernahme.length > 0 && (
            <Checkbox checked={behalten} onChange={(e) => setBehalten(e.target.checked)}>
              Werte behalten
            </Checkbox>
          )}
          <Space style={{ marginLeft: 'auto' }}>
            {onAbbrechen && <Button onClick={abbrechen}>Abbrechen</Button>}
            {serie && (
              // htmlType="button": siehe „EINE FALLE" im Dateikopf.
              <Button
                loading={laeuft}
                onClick={() => { serienlaufRef.current = true; form.submit(); }}
              >
                Speichern und nächste
              </Button>
            )}
            <Button type="primary" htmlType="submit" loading={laeuft}>{erfassenText}</Button>
          </Space>
        </div>
      </Form>
    </div>
  );
}

interface ErfassungsModalProps<T> extends ErfassungsFormularProps<T> {
  /** Modal offen? */
  offen: boolean;
  /** Titel des Dialogs. */
  titel: ReactNode;
  /** Abbrechen ist im Dialog Pflicht — sonst gäbe es keinen Weg heraus. */
  onAbbrechen: () => void;
}

/**
 * Dieselbe Hülle als Dialog. `footer={null}`, weil die Knöpfe **im** Formular
 * liegen (Dateikopf, Abweichung 1); `destroyOnHidden`, damit ein geschlossener
 * Dialog keine Felder im Baum stehen lässt.
 *
 * **`onCancel` wird NICHT durchgereicht, sondern umschlossen — und das ist kein
 * Feinschliff.** Ein Dialog hat vier Auswege: den Abbrechen-Knopf, das
 * Schließkreuz, Escape und den Klick auf die Maske. Nur der erste läuft durch das
 * Formular. Reichte man `onAbbrechen` roh an das Modal durch, setzten die anderen
 * drei nicht zurück — und `destroyOnHidden` fängt das **nicht** auf: es hängt die
 * Kinder ab, aber der Formularspeicher von rc-field-form überlebt
 * (`destroyForm(undefined)` lässt den Store stehen, `preserve` ist per Vorgabe an,
 * und beim nächsten Öffnen gewinnt der alte Store gegen `initialValues`). Gemessen
 * an `PersonalFormModal`: Person bearbeiten, mit Escape schließen, „Person
 * anlegen" öffnen — das Formular trug Name, Personalnummer und Telefon der
 * bearbeiteten Person, und Speichern legte sie als Dublette an.
 *
 * Deshalb liegt der Reset zweimal, aber nie doppelt: der Knopf geht durch
 * `ErfassungsFormular.abbrechen`, die drei anderen Wege durch `schliessen` hier.
 */
export function ErfassungsModal<T extends object>({
  offen, titel, onAbbrechen, ...rest
}: ErfassungsModalProps<T>) {
  const { form } = rest;
  const schliessen = useCallback(() => {
    form.resetFields();
    onAbbrechen();
  }, [form, onAbbrechen]);

  return (
    <Modal open={offen} title={titel} onCancel={schliessen} footer={null} destroyOnHidden>
      <ErfassungsFormular<T> onAbbrechen={onAbbrechen} {...rest} />
    </Modal>
  );
}
