import { Button, Checkbox, Form, Modal, Space, Tooltip, Typography, theme } from 'antd';
import type { FormInstance, FormProps } from 'antd';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

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
 *
 * ── NACHTRAG 30.07.2026: DER FUSS HAT ZWEI ZEILEN ──────────────────
 *
 * Bis hierher standen Zähler, „Werte behalten" und die drei Knöpfe in EINER
 * Reihe. Der Schalter wirkt aber ausschliesslich auf „Speichern und nächste" —
 * der Primär-Knopf direkt daneben leert und schliesst, mit Schalter oder ohne.
 * Ein Umschalter, der mitten in einer Knopfreihe steht und nur einen der Knöpfe
 * betrifft, ist von der Bedienung aus nicht von „wirkungslos" zu unterscheiden;
 * genau so wurde er gemeldet. Deshalb liegt die **Einstellung** jetzt in einer
 * eigenen, sekundär gesetzten Zeile über der **Aktion**, und der Tooltip nennt
 * die Bedingung („beim Speichern und nächste"), statt sie den Bedienenden
 * herleiten zu lassen.
 *
 * Der Schalter startet **AUS**. Er verändert, was nach einem Speichern im
 * Formular steht — ein Vorgabewert AN bedeutet, dass die erste Person, die ihn
 * bemerkt, ihn bereits benutzt hat, ohne ihn zu wählen. Wer in Serie erfasst,
 * schaltet ihn einmal an; er hält für die Lebensdauer des Dialogs.
 *
 * Das Tastenkürzel **Strg/⌘ + Enter** löst „Speichern und nächste" aus (blankes
 * Enter bleibt der Primär-Knopf). Es hängt am Wurzel-`div`, nicht am `<form>`:
 * so ist es unabhängig davon, ob antd unbekannte Props ans native `form`
 * durchreicht. Der Riegel gegen ein doppeltes Absenden sitzt in `abschicken`
 * (`sendetRef`) und nicht nur am Knopf — ein `loading`-Knopf ignoriert Klicks,
 * eine Tastenwiederholung erreicht ihn nie.
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

/**
 * Beschriftung des Serien-Kürzels. Auf dem Mac heisst die Taste ⌘, sonst Strg;
 * beide werden im Handler gleichwertig akzeptiert, angezeigt wird die ortsübliche.
 *
 * Exportiert und mit Parameter, damit BEIDE Zweige prüfbar sind: jsdom meldet
 * keinen Mac, ein Test gegen die Modul-Konstante träfe also immer denselben.
 */
export function serienKuerzel(userAgent: string) {
  return /Mac|iPhone|iPad|iPod/.test(userAgent) ? '⌘ ↵' : 'Strg + ↵';
}

// Einmal je Sitzung bestimmt — die Plattform wechselt nicht.
const SERIEN_KUERZEL = serienKuerzel(typeof navigator === 'undefined' ? '' : navigator.userAgent);

const UEBERNAHME_ERKLAERUNG =
  'Beim „Speichern und nächste" bleiben die Wiederholfelder stehen, alle übrigen Felder werden geleert. '
  + 'Auf den Knopf rechts hat der Schalter keinen Einfluss — der schliesst den Dialog.';

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
  // Vorgabe AUS — Begründung im Dateikopf, Abschnitt „NACHTRAG".
  const [behalten, setBehalten] = useState(false);
  // Ref statt State: der Wert wird zwischen Klick und `onFinish` im selben Zug
  // gelesen — ein State-Update wäre zu diesem Zeitpunkt noch nicht sichtbar.
  const serienlaufRef = useRef(false);
  // „Ein Absenden ist unterwegs." Gleicher Grund für die Ref: der Riegel muss
  // innerhalb desselben Zuges greifen, in dem er gesetzt wurde.
  const sendetRef = useRef(false);

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
    // Der Riegel liegt HIER und nicht am Knopf: über das Tastenkürzel erreicht
    // eine gehaltene Taste den Knopf nie, und `loading` blockiert nur Klicks.
    if (sendetRef.current) return;
    sendetRef.current = true;
    const serienlauf = serienlaufRef.current;
    serienlaufRef.current = false;
    // Werte VOR dem Zurücksetzen sichern — danach sind sie weg.
    const behaltene = Object.fromEntries(
      (uebernahme ?? []).map((feld) => [feld, werte[feld]]),
    ) as Partial<T>;
    let angenommen = false;
    try {
      await onErfassen(werte);
      angenommen = true;
    } catch {
      // Abgelehnt: nichts leeren, nichts schliessen. Den Fehler meldet die
      // Mutation des Aufrufers; hier bleibt der Wortlaut stehen.
    } finally {
      sendetRef.current = false;
    }
    if (!angenommen) return;
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

  /**
   * Der Serienlauf — eine Funktion für Knopf UND Tastenkürzel. Zwei Kopien
   * gingen genau so lange auseinander, bis eine von beiden die Marke vergisst.
   */
  const serienSpeichern = useCallback(() => {
    // Greift NICHT beim auslösenden Druck — `sendetRef` wird erst in `abschicken`
    // gesetzt, also nach der Prüfung. Der Riegel hier erspart einem Druck WÄHREND
    // eines laufenden Absendens die überflüssige Prüfrunde; der wirksame Riegel
    // steht in `abschicken`.
    if (sendetRef.current) return;
    serienlaufRef.current = true;
    form.submit();
  }, [form]);

  function aufTaste(e: KeyboardEvent<HTMLDivElement>) {
    // Ohne Serienmodus gibt es den Knopf nicht — dann darf das Kürzel auch
    // keine Serien-Marke setzen. Eine stehengebliebene Marke färbt das nächste
    // reguläre Absenden still zum Serienlauf (s. `onFinishFailed` unten).
    if (!serie || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    serienSpeichern();
  }

  function abbrechen() {
    form.resetFields();
    onAbbrechen?.();
  }

  return (
    <div ref={wurzel} onKeyDown={aufTaste}>
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
            marginTop: token.margin, paddingTop: token.paddingSM,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {/* EINSTELLUNG — eigene Zeile über der Aktion. Warum getrennt: Dateikopf,
              Abschnitt „NACHTRAG". Die Zeile steht im Serienmodus IMMER, denn sie
              trägt die Ansage-Region: wird die erst zusammen mit ihrem ersten Text
              eingehängt, sagt der Screenreader genau die erste Speicherung nicht an
              — eine `aria-live`-Region meldet nur Änderungen an bereits vorhandenem
              Inhalt. */}
          {serie && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: token.marginXS,
                flexWrap: 'wrap', marginBottom: token.marginXS,
              }}
            >
              {uebernahme != null && uebernahme.length > 0 && (
                <Tooltip title={UEBERNAHME_ERKLAERUNG}>
                  <Checkbox checked={behalten} onChange={(e) => setBehalten(e.target.checked)}>
                    <Typography.Text type="secondary">Werte behalten</Typography.Text>
                  </Checkbox>
                </Tooltip>
              )}
              <Typography.Text type="secondary" aria-live="polite" style={{ marginLeft: 'auto' }}>
                {zaehler > 0 ? `Erfasst: ${zaehler}` : ''}
              </Typography.Text>
            </div>
          )}
          {/* AKTION */}
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {onAbbrechen && <Button onClick={abbrechen}>Abbrechen</Button>}
            {serie && (
              // htmlType="button": siehe „EINE FALLE" im Dateikopf.
              // Das Kürzel steht `aria-hidden` im Knopf: sichtbar für die Augen,
              // unsichtbar für den zugänglichen Namen — sonst müsste jede
              // Aufrufstelle ihre Knopf-Abfrage auf den Zusatz umschreiben, und
              // eine Vorlesehilfe buchstabierte „Strg Plus Pfeil".
              <Button loading={laeuft} onClick={serienSpeichern}>
                Speichern und nächste
                <span aria-hidden style={{ marginLeft: token.marginXS, color: token.colorTextTertiary }}>
                  {SERIEN_KUERZEL}
                </span>
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
