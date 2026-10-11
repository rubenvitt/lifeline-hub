import { Button, Checkbox, ConfigProvider, Form, Modal, Space, Typography, theme } from 'antd';
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
import { SpeicherFehler } from './SpeicherHinweis';
import { useViewport } from './useViewport';
import './Erfassung.css';

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
 * **Unter `md` stehen die Knöpfe untereinander** (LFH-953), in voller Breite: oben „Abbrechen“,
 * unten, dem Daumen am nächsten, der Primärknopf. Nebeneinander waren die drei Knöpfe der Serie
 * auf 390 px breiter als der Dialog und liefen links hinaus („Abbrechen“ bei x = −75). Ab `md`
 * bleibt die Reihe rechtsbündig und bricht im Notfall um (`wrap`), statt hinauszulaufen.
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

/**
 * Die Aktionsknöpfe laufen ohne antds Bewegung (LFH-1142). Das Lade-Symbol eines Knopfs blendet
 * antd mit einem Übergang aus und entfernt es erst bei dessen `transitionend`; nach einigen
 * Serien-Speicherungen blieb das Ereignis aus. Das leere Symbol (Breite 0, Deckkraft 0) blieb dann
 * im Knopf stehen, mit `aria-label="loading"`: der Knopf hieß „loading Erfassen“, 30 s bis über
 * 3 min lang, obwohl er längst wieder bediente. Ohne Bewegung kommt und geht das Symbol mit dem
 * Ladezustand. Nachweis: `e2e/personen-aufnahme.spec.ts`, Fall LFH-1142.
 */
const AKTION_OHNE_BEWEGUNG = { token: { motion: false } } as const;

/**
 * Klasse des Kürzels im Serienknopf: sichtbar nur bei feinem Zeiger mit Hover (`Erfassung.css`,
 * LFH-953). Eine Medienabfrage statt eines Zuhörers auf die Zeigerart; auf dem Touchgerät
 * verwirrte „Strg + ↵“ und machte den Knopf breiter.
 */
export const SERIEN_KUERZEL_KLASSE = 'lfh-serien-kuerzel';

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
  /**
   * Die Prüfung ist gescheitert. Für Masken mit eingeklapptem Teil: ein Fehler dort bliebe
   * sonst unsichtbar (LFH-974).
   */
  onPruefungGescheitert?: (fehlerFelder: string[]) => void;
  /**
   * Die Speicher-Mutation des Aufrufers (LFH-1077). Die Hülle zeigt ihren Fehler über der
   * Aktionszeile, bis zum nächsten Absenden, und räumt ihn beim Einhängen und beim Abbrechen;
   * ein Dialog öffnet so nie mit dem Grund der letzten Ablehnung. Kein `onError`-Toast
   * (`frontend/AGENTS.md`, „Rückwege und Fehler“). Teilt sich eine Mutation mehrere Wege, reicht
   * der Aufrufer nur den Fehler dieses Weges durch. Solange sie läuft, ist Abbrechen gesperrt.
   */
  speicherung?: Speicherung;
  /** Überschrift des Fehlers; Vorgabe „Nicht gespeichert“. */
  speicherFehlerTitel?: string;
  /** Text für einen Fehler ohne Servermeldung; Vorgabe „Speichern fehlgeschlagen“. */
  speicherFehlerFallback?: string;
  /** Die `Form.Item`-Felder. */
  children: ReactNode;
}

/** Was die Hülle von einer Mutation braucht (`useMutation` erfüllt es). */
export interface Speicherung {
  error: unknown;
  isPending: boolean;
  reset: () => void;
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
  onPruefungGescheitert,
  speicherung,
  speicherFehlerTitel,
  speicherFehlerFallback,
  children,
}: ErfassungsFormularProps<T>) {
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();
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

  // Ref, damit Einhängen und Abbrechen die AKTUELLE Mutation räumen, ohne dass ein neues
  // Mutationsobjekt je Render den Effekt erneut auslöst.
  const speicherungRef = useRef(speicherung);
  speicherungRef.current = speicherung;
  /*
   * Solange die `speicherung` läuft, ist Abbrechen auf allen Wegen wirkungslos (Knopf gesperrt,
   * Escape, Steuerung von außen): der Dialog bleibt bis zur Antwort offen, sonst hätte ihre
   * Ablehnung keinen Ort mehr (LFH-1077, design.md D3). `laeuft` allein sperrt nicht: ein Upload
   * darf abgebrochen werden (`ErfassungsAnhangAblegenModal`, LFH-878). Ref, weil Escape und
   * Steuerung ihn außerhalb des Renders lesen.
   */
  const sperrtAbbruch = speicherung?.isPending === true;
  const sperrtAbbruchRef = useRef(sperrtAbbruch);
  sperrtAbbruchRef.current = sperrtAbbruch;
  const raeumeSpeicherFehler = useCallback(() => {
    const s = speicherungRef.current;
    // Eine laufende Mutation bleibt unberührt: `reset()` hängte ihr Ergebnis ab.
    if (s && !s.isPending && s.error != null) s.reset();
  }, []);
  useEffect(() => {
    raeumeSpeicherFehler();
  }, [raeumeSpeicherFehler]);

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
    if (sperrtAbbruchRef.current) return;
    abbruchGenerationRef.current += 1;
    serienlaufRef.current = false;
    form.resetFields();
    raeumeSpeicherFehler();
    onAbbrechen?.();
  }, [form, onAbbrechen, raeumeSpeicherFehler]);

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
        onFinishFailed={({ errorFields }) => {
          serienlaufRef.current = false;
          onPruefungGescheitert?.(errorFields.map((f) => f.name.join('.')));
        }}
      >
        {children}
        {speicherung && (
          <SpeicherFehler
            fehler={speicherung.error}
            titel={speicherFehlerTitel}
            fallback={speicherFehlerFallback}
          />
        )}
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
                <Checkbox checked={behalten} onChange={(e) => setBehalten(e.target.checked)}>
                  <Typography.Text type="secondary">Werte behalten</Typography.Text>
                </Checkbox>
              )}
              <Typography.Text type="secondary" aria-live="polite" style={{ marginLeft: 'auto' }}>
                {zaehler > 0 ? `Erfasst: ${zaehler}` : ''}
              </Typography.Text>
            </div>
          )}
          {/* AKTION — unter `md` gestapelt, siehe Dateikopf. Ohne antds Bewegung: siehe
              `AKTION_OHNE_BEWEGUNG`. */}
          <ConfigProvider theme={AKTION_OHNE_BEWEGUNG}>
            <Space
              size="middle"
              orientation={istSchmal ? 'vertical' : 'horizontal'}
              wrap={!istSchmal}
              style={
                istSchmal ? { display: 'flex' } : { display: 'flex', justifyContent: 'flex-end' }
              }
            >
              {onAbbrechen && (
                <Button block={istSchmal} onClick={abbrechen} disabled={sperrtAbbruch}>
                  Abbrechen
                </Button>
              )}
              {serie && (
                // htmlType="button": siehe „EINE FALLE" im Dateikopf. Das Kürzel steht `aria-hidden` im
                // Knopf, damit der zugängliche Name „Speichern und nächste" bleibt; zu sehen ist es nur
                // mit feinem Zeiger (`Erfassung.css`), auf dem Touchgerät gibt es keine Tastatur dafür.
                <Button block={istSchmal} loading={laeuft} onClick={serienSpeichern}>
                  Speichern und nächste
                  <span
                    aria-hidden
                    className={SERIEN_KUERZEL_KLASSE}
                    style={{ marginLeft: token.marginXS, color: token.colorTextTertiary }}
                  >
                    {SERIEN_KUERZEL}
                  </span>
                </Button>
              )}
              <Button
                type="primary"
                htmlType="submit"
                block={istSchmal}
                loading={laeuft}
                danger={unumkehrbar}
                disabled={gesperrt}
              >
                {erfassenText}
              </Button>
            </Space>
          </ConfigProvider>
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
 * Während die Mutation läuft, sind Kreuz und Maske zusätzlich sichtbar gesperrt.
 */
export function ErfassungsModal<T extends object>({
  offen,
  titel,
  onAbbrechen,
  ...rest
}: ErfassungsModalProps<T>) {
  const { form } = rest;
  const sperrtAbbruch = rest.speicherung?.isPending === true;
  const formularSteuerung = useRef<ErfassungsFormularSteuerung>(null);
  const schliessen = useCallback(() => {
    if (formularSteuerung.current) formularSteuerung.current.abbrechen();
    else if (!sperrtAbbruch) {
      form.resetFields();
      onAbbrechen();
    }
  }, [form, onAbbrechen, sperrtAbbruch]);

  return (
    <Modal
      open={offen}
      title={titel}
      onCancel={schliessen}
      closable={sperrtAbbruch ? { disabled: true } : true}
      mask={{ closable: !sperrtAbbruch }}
      footer={null}
      destroyOnHidden
      keyboard={false}
    >
      <ErfassungsFormular<T> onAbbrechen={onAbbrechen} {...rest} steuerungRef={formularSteuerung} />
    </Modal>
  );
}
