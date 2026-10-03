import { Button, Checkbox, Form, Modal, Space, Tooltip, Typography, theme } from 'antd';
import type { FormInstance, FormProps } from 'antd';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';

/**
 * Schnellerfassungs-Primitive (LFH-332 · B4) — Formularhülle, Serienmodus, Wertübernahme.
 *
 * ── DREI ZUSICHERUNGEN ─────────────────────────────────────────────
 *
 * 1. **Der Absende-Knopf liegt im Formular.** Deshalb sendet Enter in einem Eingabefeld ab —
 *    die eingebaute Formularübermittlung des Browsers, kein nachgebauter Tastaturbehandler. In
 *    einer `Input.TextArea` bleibt Enter ein Zeilenumbruch.
 * 2. **Der Fokus steht beim Öffnen im ersten Feld** und kehrt nach jedem Serien-Speichern
 *    dorthin zurück.
 * 3. **Zurückgesetzt wird auf JEDEM Weg hinaus** — nach dem Erfassen, über Abbrechen,
 *    Schliesskreuz, Escape und Maskenklick. Warum `destroyOnHidden` das NICHT erledigt, steht
 *    am `ErfassungsModal`.
 *
 * Die Fusszeile rendert die Hülle **selbst und innerhalb** des Formulars (`footer={null}`):
 * der sichtbare Knopf ist damit schon der Übermittlungsknopf, ein versteckter Zwilling wäre
 * überflüssig.
 *
 * Der Zähler heisst **„Erfasst: n"**, nicht „heute erfasst": er zählt seit dem Öffnen dieses
 * Dialogs, eine Tagesangabe behauptete Daten, die die Hülle nicht kennt.
 *
 * ── EINE FALLE ─────────────────────────────────────────────────────
 *
 * Nur der Primär-Knopf ist ein Übermittlungsknopf; „Speichern und nächste" ruft `form.submit()`
 * von Hand. Enter löst den **ersten** Übermittlungsknopf im Baum aus, bei zweien entschiede
 * die DOM-Anordnung darüber.
 *
 * ── DER FUSS HAT ZWEI ZEILEN ───────────────────────────────────────
 *
 * „Werte behalten" wirkt nur auf „Speichern und nächste"; mitten in der Knopfreihe wäre der
 * Schalter von „wirkungslos" nicht zu unterscheiden. Die **Einstellung** steht deshalb in einer
 * eigenen, sekundär gesetzten Zeile über der **Aktion**, der Tooltip nennt die Bedingung.
 *
 * Der Schalter startet **AUS**: ein Vorgabewert AN wäre benutzt, ohne gewählt zu sein. Er hält
 * für die Lebensdauer des Dialogs.
 *
 * Die Knöpfe der Aktion stehen mit `size="middle"` auseinander (`token.padding` = 11 / 18 / 26 px,
 * LFH-653): der Primärknopf kann rot sein (`unumkehrbar`), und im Handschuh-Betrieb verlangt die
 * Leitlinie ≥ 16 px zwischen zwei Zielen. antds Vorgabe wären 3 / 5 / 7 px (`paddingXS`).
 *
 * **Strg/⌘ + Enter** löst „Speichern und nächste" aus (blankes Enter bleibt der Primär-Knopf).
 * Das Kürzel hängt am Wurzel-`div`, unabhängig davon, ob antd unbekannte Props ans `form`
 * durchreicht. Der Riegel gegen doppeltes Absenden sitzt in `abschicken` (`sendetRef`): ein
 * `loading`-Knopf ignoriert Klicks, eine Tastenwiederholung erreicht ihn nie.
 */

/**
 * Erstes bedienbares Feld im Formular. Deckt auch antds `Select`, `AutoComplete` und
 * `DatePicker` ab — die rendern alle ein echtes `<input>`.
 */
const FOKUSSIERBAR = [
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
].join(', ');

/**
 * Wohin der Fokus beim Öffnen und nach jedem Serien-Speichern geht:
 *
 * 1. ein ausdrückliches Fokusziel `[data-erfassung-fokus]` — für Felder, deren `<input>` nicht
 *    bedienbar ist (rc-upload rendert `<input type="file">` mit `display: none`, `focus()` darauf
 *    verpufft still). jsdom fokussiert es trotzdem; den Beleg trägt
 *    `e2e/schaden-anhaenge.spec.ts`.
 * 2. sonst das erste GERENDERTE Feld (`getClientRects().length > 0`).
 * 3. sonst das erste Feld überhaupt: jsdom rechnet kein Layout, ohne diesen Rückfall fokussierte
 *    die Hülle in Tests nichts.
 */
function fokussiereErstesFeld(wurzel: HTMLElement | null) {
  if (!wurzel) return;
  const ausdruecklich = wurzel.querySelector<HTMLElement>('[data-erfassung-fokus]');
  if (ausdruecklich) {
    ausdruecklich.focus();
    return;
  }
  const kandidaten = Array.from(wurzel.querySelectorAll<HTMLElement>(FOKUSSIERBAR));
  (kandidaten.find((k) => k.getClientRects().length > 0) ?? kandidaten[0])?.focus();
}

/**
 * Beschriftung des Serien-Kürzels: ⌘ auf dem Mac, sonst Strg; der Handler akzeptiert beide.
 * Exportiert und mit Parameter, damit BEIDE Zweige prüfbar sind (jsdom meldet keinen Mac).
 */
export function serienKuerzel(userAgent: string) {
  return /Mac|iPhone|iPad|iPod/.test(userAgent) ? '⌘ ↵' : 'Strg + ↵';
}

// Einmal je Sitzung bestimmt — die Plattform wechselt nicht.
const SERIEN_KUERZEL = serienKuerzel(typeof navigator === 'undefined' ? '' : navigator.userAgent);

const UEBERNAHME_ERKLAERUNG =
  'Beim „Speichern und nächste" bleiben die Wiederholfelder stehen, alle übrigen Felder werden geleert. ' +
  'Auf den Knopf rechts hat der Schalter keinen Einfluss — der schliesst den Dialog.';

export interface ErfassungsFormularSteuerung {
  /** Bricht über denselben Reset-Pfad wie Knopf und Tastatur-Registry ab. */
  abbrechen: () => void;
}

interface ErfassungsFormularProps<T> {
  /** Die Formularinstanz des Aufrufers (`Form.useForm()`). Die Hülle setzt sie zurück. */
  form: FormInstance<T>;
  /**
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`, nicht `mutate`) —
   * sonst leert die Hülle die Felder, obwohl der Datensatz nie ankam.
   */
  onErfassen: (werte: T) => Promise<unknown>;
  /**
   * Nach erfolgreichem Speichern und bestandener Abbruchprüfung. Geeignet für
   * lokale Folgewirkungen, die ein Abbruch während der Mutation nicht auslösen darf.
   */
  onErfasst?: (werte: T) => void | Promise<void>;
  /** Einzel-Erfassen erfolgreich. Der Aufrufer schliesst; die Hülle hat bereits geleert. */
  onFertig: () => void;
  /** Abbrechen. Die Hülle leert vorher — der Aufrufer setzt nur seinen Offen-Zustand. */
  onAbbrechen?: () => void;
  /** Läuft die Mutation? Setzt beide Speicher-Knöpfe auf Ladeanzeige. */
  laeuft?: boolean;
  /** Beschriftung des Primär-Knopfes. Default `'Erfassen'`. */
  erfassenText?: string;
  /**
   * Der Primär-Knopf bestätigt eine UNUMKEHRBARE Handlung (LFH-363): rot (`danger`). Nur für
   * Rückfragen mit Pflichtangabe (z. B. Streichgrund), nie für ein gewöhnliches Erfassen.
   */
  unumkehrbar?: boolean;
  /**
   * Sperrt den Primär-Knopf, solange eine Voraussetzung fehlt, die die Feldregeln nicht
   * ausdrücken (LFH-751: die eingetippte Kennung stimmt noch nicht). Nur zusätzlich zu den
   * Feldregeln, nie statt ihrer — die Prüfung beim Absenden bleibt.
   */
  gesperrt?: boolean;
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
  /** Steuerung für äußere Dialoghüllen (Drawer-Kreuz, Maske und Escape). */
  steuerungRef?: Ref<ErfassungsFormularSteuerung>;
  /** Die `Form.Item`-Felder. */
  children: ReactNode;
}

/**
 * Die Formularhülle. Steht allein für Inline-Erfassung (Kommunikationsmodule)
 * und steckt in `ErfassungsModal` für Dialoge.
 */
export function ErfassungsFormular<T extends object>({
  form,
  onErfassen,
  onErfasst,
  onFertig,
  onAbbrechen,
  laeuft = false,
  erfassenText = 'Erfassen',
  unumkehrbar = false,
  gesperrt = false,
  serie = false,
  uebernahme,
  initialValues,
  steuerungRef,
  children,
}: ErfassungsFormularProps<T>) {
  const { token } = theme.useToken();
  const wurzel = useRef<HTMLDivElement>(null);
  const [zaehler, setZaehler] = useState(0);
  // Vorgabe AUS — siehe Dateikopf.
  const [behalten, setBehalten] = useState(false);
  // Ref statt State: der Wert wird zwischen Klick und `onFinish` im selben Zug gelesen.
  const serienlaufRef = useRef(false);
  // „Ein Absenden ist unterwegs." Ref, weil der Riegel im selben Zug greifen muss.
  const sendetRef = useRef(false);
  // Jeder Abbruch macht einen bereits laufenden Abschluss ungültig. Die Mutation
  // darf serverseitig zu Ende laufen, aber danach weder schließen noch navigieren.
  const abbruchGenerationRef = useRef(0);

  /**
   * Der Fokus läuft über **Effekte, nicht über eine Zeitangabe**. Ein direkter `focus()` im
   * Absende-Handler verpufft (React flusht danach noch einmal, der Fokus landet auf `<body>`).
   * `requestAnimationFrame` wäre lastabhängig: am Mount spränge der Cursor notfalls mitten im
   * Tippen zurück, und nach dem Serien-Speichern käme der Fokus zu spät.
   *
   * Ein Effekt läuft nach dem Commit, an einem festen Punkt. `fokusTick` ist nur die
   * Auslöse-Abhängigkeit und zählt Serien-Speicherungen.
   */
  const [fokusTick, setFokusTick] = useState(0);

  useEffect(() => {
    fokussiereErstesFeld(wurzel.current);
  }, []);

  useEffect(() => {
    if (fokusTick > 0) fokussiereErstesFeld(wurzel.current);
  }, [fokusTick]);

  const abschicken = useCallback(
    async (werte: T) => {
      // Der Riegel liegt HIER und nicht am Knopf: eine gehaltene Taste erreicht den Knopf nie, und
      // `loading` blockiert nur Klicks.
      if (sendetRef.current) return;
      sendetRef.current = true;
      const abbruchGeneration = abbruchGenerationRef.current;
      const serienlauf = serienlaufRef.current;
      serienlaufRef.current = false;
      // Werte VOR dem Zurücksetzen sichern — danach sind sie weg.
      const behaltene = Object.fromEntries(
        (uebernahme ?? []).map((feld) => [feld, werte[feld]]),
      ) as Partial<T>;
      let serverErfolg = false;
      try {
        try {
          await onErfassen(werte);
          serverErfolg = true;
        } catch {
          // Abgelehnt: nichts leeren, nichts schliessen. Den Fehler meldet die
          // Mutation des Aufrufers; hier bleibt der Wortlaut stehen.
        }
        if (!serverErfolg || abbruchGenerationRef.current !== abbruchGeneration) return;

        try {
          await onErfasst?.(werte);
        } catch {
          // Der Server hat bereits erfolgreich gespeichert. Ein lokaler Folgefehler
          // darf den Satz nicht offen und damit versehentlich wiederholbar lassen.
        }
        // Der Hook ist awaitbar: ein Abbruch währenddessen bleibt maßgeblich und
        // hat Reset/Callback bereits selbst ausgeführt.
        if (abbruchGenerationRef.current !== abbruchGeneration) return;

        setZaehler((n) => n + 1);
        if (!serienlauf) {
          form.resetFields();
          onFertig();
          return;
        }
        form.resetFields();
        if (behalten && uebernahme?.length) form.setFieldsValue(behaltene);
        setFokusTick((n) => n + 1);
      } finally {
        sendetRef.current = false;
      }
    },
    [behalten, form, onErfassen, onErfasst, onFertig, uebernahme],
  );

  /**
   * Der Serienlauf — eine Funktion für Knopf UND Tastenkürzel, damit keine Kopie die Marke
   * vergisst.
   */
  const serienSpeichern = useCallback(() => {
    // Erspart einem Druck WÄHREND eines laufenden Absendens die Prüfrunde; der wirksame Riegel steht
    // in `abschicken`.
    if (sendetRef.current) return;
    serienlaufRef.current = true;
    form.submit();
  }, [form]);

  function aufTaste(e: KeyboardEvent<HTMLDivElement>) {
    // Ohne Serienmodus gibt es den Knopf nicht, also darf das Kürzel keine Serien-Marke setzen
    // (s. `onFinishFailed` unten).
    if (
      e.nativeEvent.isComposing ||
      e.repeat ||
      e.shiftKey ||
      e.altKey ||
      !serie ||
      e.key !== 'Enter' ||
      !(e.metaKey || e.ctrlKey)
    )
      return;
    e.preventDefault();
    serienSpeichern();
  }

  const abbrechen = useCallback(() => {
    abbruchGenerationRef.current += 1;
    serienlaufRef.current = false;
    form.resetFields();
    onAbbrechen?.();
  }, [form, onAbbrechen]);

  useImperativeHandle(steuerungRef, () => ({ abbrechen }), [abbrechen]);

  useTastaturEbene({
    name: 'Erfassungsformular',
    wurzel,
    aktionen: {
      // Ein gesperrter Primär-Knopf sperrt auch sein Kürzel.
      speichern: () => {
        if (!gesperrt) form.submit();
      },
      verwerfen: abbrechen,
    },
  });

  return (
    <div ref={wurzel} onKeyDown={aufTaste}>
      {/* `onFinishFailed` ist die zweite Hälfte von `serienlaufRef`: scheitert die Prüfung, läuft
          `onFinish` NIE, die Marke bliebe auf „Serie", und das nächste reguläre Absenden hielte den
          Dialog offen — ein zweiter Druck legte den Datensatz doppelt an. */}
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={abschicken}
        onFinishFailed={() => {
          serienlaufRef.current = false;
        }}
      >
        {children}
        <div
          style={{
            marginTop: token.margin,
            paddingTop: token.paddingSM,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {/* EINSTELLUNG — eigene Zeile über der Aktion (siehe Dateikopf). Sie steht im Serienmodus
              IMMER, weil sie die Ansage-Region trägt: eine `aria-live`-Region meldet nur Änderungen an
              bereits vorhandenem Inhalt, sonst bliebe die erste Speicherung unangesagt. */}
          {serie && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.marginXS,
                flexWrap: 'wrap',
                marginBottom: token.marginXS,
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
          <Space size="middle" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {onAbbrechen && <Button onClick={abbrechen}>Abbrechen</Button>}
            {serie && (
              // htmlType="button": siehe „EINE FALLE" im Dateikopf. Das Kürzel steht `aria-hidden` im
              // Knopf, damit der zugängliche Name „Speichern und nächste" bleibt.
              <Button loading={laeuft} onClick={serienSpeichern}>
                Speichern und nächste
                <span
                  aria-hidden
                  style={{ marginLeft: token.marginXS, color: token.colorTextTertiary }}
                >
                  {SERIEN_KUERZEL}
                </span>
              </Button>
            )}
            <Button
              type="primary"
              htmlType="submit"
              loading={laeuft}
              danger={unumkehrbar}
              disabled={gesperrt}
            >
              {erfassenText}
            </Button>
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
 * Dieselbe Hülle als Dialog. `footer={null}`, weil die Knöpfe **im** Formular liegen;
 * `destroyOnHidden`, damit ein geschlossener Dialog keine Felder im Baum stehen lässt.
 *
 * **`onCancel` wird umschlossen, nicht durchgereicht.** Von den vier Auswegen (Abbrechen,
 * Schließkreuz, Escape, Maske) läuft nur der erste durch das Formular, und `destroyOnHidden`
 * fängt die übrigen **nicht** auf: der Speicher von rc-field-form überlebt das Abhängen
 * (`preserve` per Vorgabe an) und gewinnt beim nächsten Öffnen gegen `initialValues`. Ein
 * Anlegen-Dialog trüge sonst die Werte des zuletzt bearbeiteten Datensatzes und legte ihn als
 * Dublette an.
 *
 * Deshalb besitzen alle vier Wege denselben zentralen Abbruch: Knopf und Escape gehen direkt
 * durch `ErfassungsFormular.abbrechen`, Kreuz und Maske über `ErfassungsFormularSteuerung`.
 */
export function ErfassungsModal<T extends object>({
  offen,
  titel,
  onAbbrechen,
  ...rest
}: ErfassungsModalProps<T>) {
  const { form } = rest;
  const formularSteuerung = useRef<ErfassungsFormularSteuerung>(null);
  const schliessen = useCallback(() => {
    if (formularSteuerung.current) formularSteuerung.current.abbrechen();
    else {
      form.resetFields();
      onAbbrechen();
    }
  }, [form, onAbbrechen]);

  return (
    <Modal
      open={offen}
      title={titel}
      onCancel={schliessen}
      footer={null}
      destroyOnHidden
      keyboard={false}
    >
      <ErfassungsFormular<T> onAbbrechen={onAbbrechen} {...rest} steuerungRef={formularSteuerung} />
    </Modal>
  );
}
