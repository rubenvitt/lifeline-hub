import type { FormInstance } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useZeitEingabe } from '../anzeige/ZeitpunktEingabe';
import { useFormularEingehaengt } from '../components/useFormularEingehaengt';

/** Frist des stillen Autosave. */
export const AUTOSAVE_MS = 30_000;

interface VerlustschutzArgs<D, W extends object> {
  /** Serverstand (Query-Data). `undefined`, solange nichts geladen ist. */
  daten: D | undefined;
  /** Nur im Entwurf läuft die Autosave-Uhr. */
  istEntwurf: boolean;
  form: FormInstance<W>;
  /** Serverstand → Formularwerte. Wird über eine Ref gelesen, darf also inline stehen. */
  werteAus: (daten: D) => W;
  /** Der PATCH. Wird über eine Ref gelesen, darf also inline stehen. */
  speichern: (werte: W) => Promise<unknown>;
  /** Nach JEDEM erfolgreichen Speichern (Invalidierung) — genau einmal je PATCH. */
  onGespeichert?: () => void;
}

interface Verlustschutz<W extends object> {
  /** Gibt es eine Fassung im Formular, die noch nicht auf dem Server steht? */
  ungespeichert: boolean;
  /** `HH:mm` des letzten erfolgreichen Speicherns (Autosave oder Knopf), sonst `null`. */
  zuletztGespeichert: string | null;
  /** An `Form onValuesChange`. */
  markiereGeaendert: () => void;
  /** An `Form onBlur` — speichert sofort, wenn etwas offen ist. */
  autosaveJetzt: () => void;
  /**
   * Grund des zuletzt gescheiterten Speicherns, sonst `null` — für `SpeicherFehler`. Fällt erst
   * beim nächsten GELUNGENEN Speichern, nicht beim nächsten Versuch.
   */
  speicherFehler: unknown;
  /**
   * DER EINZIGE Weg für ein Speichern außerhalb der Uhr: „Entwurf speichern" und der
   * Freigabe-Vorlauf. Lehnt mit dem Grund des Servers ab, NACHDEM sie ihn in `speicherFehler`
   * gelegt hat — der Aufrufer braucht kein eigenes `onError`.
   */
  speichereJetzt: (werte: W) => Promise<void>;
  /** Läuft gerade ein Speichern — Autosave ODER expliziter Pfad. */
  speichertGerade: boolean;
  /**
   * An `<FormularEingehaengt onWechsel={…} />` IM `<Form>`. Ohne den Marker übernimmt das
   * Formular den Serverstand nie (s. (4)).
   */
  formularEingehaengt: (da: boolean) => void;
}

/**
 * Verlustschutz für Entwurfsformulare (Befehl und Lagebericht).
 *
 * **(1) DER RIEGEL.** Der Effekt, der den Serverstand ins Formular schreibt, hält, solange eine
 * eigene Fassung offen ist: die Invalidierung kommt über den Live-Stream auch von FREMDEN
 * Änderungen, und wer schrieb, sähe seinen Text ersetzt. Umgekehrt übernimmt die Seite OHNE
 * eigene Fassung den Serverstand weiter; ein Riegel, der immer hält, machte sie still veraltet.
 *
 * **(2) DER MERKER IST EIGENER STATE**, nicht `form.isFieldsTouched()`: antd setzt das Flag
 * beim Speichern nicht zurück, ein Autosave darauf schriebe alle 30 s ein PATCH für nichts.
 *
 * **(3) AUTOSAVE IST STILL** (eine Erfolgsmeldung alle 30 s wäre eine Alarmquelle nach
 * EEMUA 191). Sichtbar ist `zuletztGespeichert` neben dem Knopf; der Fehler ist ZUSTAND
 * (`speicherFehler`), kein Toast, und wird erst bei ERFOLG geräumt — beim Start zu räumen ließe
 * den Alert bei stehendem 503 im 30-s-Takt blinken.
 *
 * **EIN KLICK IST EIN PATCH.** Ein Klick auf „Entwurf speichern" ist zwei Ereignisse: Blur
 * (Autosave), dann `form.submit()`. Beide Pfade nehmen den EINEN Speicherweg `speichereMit`:
 *  (a) ist der Stand schon gesichert (`gesichertRef`), passiert nichts — sonst gewänne ein
 *      schneller Autosave das Rennen und die Dublette ginge doch hinaus;
 *  (b) läuft ein PATCH mit DEMSELBEN Stand, hängt sich der Klick an;
 *  (c) sonst ein eigener PATCH. Bei ungleichem Stand anzuhängen wäre eine Quittung über einen
 *      Stand, den der Server nicht hat.
 * Der Riegel fällt nur, wenn ihn noch derselbe Auftrag hält (`auftragRef`). Die API ist bewusst
 * eng: kein öffentlicher Weg, einen zweiten Speicherpfad daneben zu bauen.
 *
 * Der Befehlsentwurf nutzt zusätzlich `EntwurfNavigationSchutz` (`useBlocker`), der denselben
 * Merker liest; dieser Hook selbst bleibt routerunabhängig.
 *
 * **(4) GESCHRIEBEN WIRD NUR INS GERENDERTE FORMULAR** (LFH-627). Die Seiten rendern ihr `<Form>`
 * nur im bearbeitbaren Entwurf, dieser Hook läuft immer. Ein `setFieldsValue` ohne `<Form>` meldet
 * rc-field-form als „not connected"; deshalb meldet `FormularEingehaengt` im Formular, ob es hängt,
 * und der Sync-Effekt wartet darauf. Hängt es später ein (Freigabe zurück, Schreibrecht), holt er
 * den Serverstand nach.
 *
 * DER MERKER GEHÖRT ZU EINEM DATENSATZ: die Seiten rendern ihren Inhalt mit `key={id}`, sonst
 * hielte der Riegel des alten Berichts nach „Fortschreiben" den neuen Serverstand fern.
 */
export function useEntwurfVerlustschutz<D, W extends object>({
  daten,
  istEntwurf,
  form,
  werteAus,
  speichern,
  onGespeichert,
}: VerlustschutzArgs<D, W>): Verlustschutz<W> {
  const [ungespeichert, setUngespeichert] = useState(false);
  const [zuletztGespeichert, setZuletztGespeichert] = useState<string | null>(null);
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const [speicherFehler, setSpeicherFehler] = useState<unknown>(null);
  const formular = useFormularEingehaengt();

  // Inline-Callbacks in Refs: der Sync-Effekt hängt an `daten` und `ungespeichert`, nicht an der
  // Identität von `werteAus`; `speichern`/`onGespeichert` in Refs, damit `speichereMit` stabil bleibt.
  const werteAusRef = useRef(werteAus);
  werteAusRef.current = werteAus;
  const speichernRef = useRef(speichern);
  speichernRef.current = speichern;
  const onGespeichertRef = useRef(onGespeichert);
  onGespeichertRef.current = onGespeichert;
  // „zuletzt gespeichert“ in der Anzeigezone (LFH-692); als Ref aus demselben Grund wie oben.
  const { formatiere } = useZeitEingabe();
  const uhrzeitRef = useRef(() => formatiere(dayjs(), 'HH:mm'));
  uhrzeitRef.current = () => formatiere(dayjs(), 'HH:mm');

  useEffect(() => {
    if (!daten) return;
    if (!formular.da) return; // (4)
    if (ungespeichert) return; // DER RIEGEL (1)
    form.setFieldsValue(werteAusRef.current(daten) as Parameters<typeof form.setFieldsValue>[0]);
  }, [daten, form, formular.da, ungespeichert]);

  /**
   * Ein abgebrochener Auftrag (`AbortError` beim Verlassen des Befehlseditors) ist kein
   * Speicherfehler.
   */
  const meldeSpeicherfehler = useCallback((e: unknown) => {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    setSpeicherFehler(e);
  }, []);

  const quittiereGespeichert = useCallback(() => {
    setUngespeichert(false);
    setZuletztGespeichert(uhrzeitRef.current());
    setSpeicherFehler(null);
  }, []);

  /**
   * Änderungszähler gegen das Verlustfenster: Blur startet den PATCH mit S1, weitergetippt wird
   * S2. Quittiert wird nur, wenn seit dem Start nichts geändert wurde; sonst bleibt der Merker
   * stehen und die nächste Frist holt S2 nach.
   */
  const aenderungRef = useRef(0);
  /**
   * Welcher Änderungsstand liegt NACHWEISLICH auf dem Server? Als Ref, weil `speichereJetzt` im
   * selben Tick richtig antworten muss (State läse eine Runde zu alt).
   * Start auf `-1`, nicht `0`: „nichts geändert" und „nichts gesendet" sind zwei Zustände. Ein
   * Klick an einem UNBERÜHRTEN Entwurf muss seinen PATCH behalten — `/freigeben` prüft den
   * persistierten Stand.
   */
  const gesichertRef = useRef(-1);
  const quittungVorbereiten = useCallback(() => {
    const stand = aenderungRef.current;
    return () => {
      // VOR der Verzweigung: der Server hat in BEIDEN Zweigen gespeichert, sonst bliebe nach einem
      // überholten Speichern ein veralteter Grund stehen.
      setSpeicherFehler(null);
      gesichertRef.current = stand;
      if (aenderungRef.current === stand) quittiereGespeichert();
      else setZuletztGespeichert(uhrzeitRef.current());
    };
  }, [quittiereGespeichert]);

  // Riegel als Ref, nicht State: zwei Aufrufe im selben Tick sähen beide den alten State.
  // `standRef` ist der Änderungsstand des laufenden Auftrags — nur bei Gleichstand darf sich der
  // explizite Pfad anhängen.
  const laeuftRef = useRef(false);
  const auftragRef = useRef<Promise<unknown> | null>(null);
  const standRef = useRef(0);

  /** Der EINE Speicherweg. Lehnt mit dem Grund des Servers ab; Zustand setzt der Aufrufer. */
  const speichereMit = useCallback(
    (werte: W) => {
      laeuftRef.current = true;
      standRef.current = aenderungRef.current;
      setSpeichertGerade(true);
      const quittieren = quittungVorbereiten();
      const auftrag = speichernRef.current(werte);
      auftragRef.current = auftrag;
      return auftrag
        .then((r) => {
          quittieren();
          onGespeichertRef.current?.();
          return r;
        })
        .finally(() => {
          // Nur der Auftrag, der den Riegel HÄLT, gibt ihn frei.
          if (auftragRef.current !== auftrag) return;
          laeuftRef.current = false;
          auftragRef.current = null;
          setSpeichertGerade(false);
        });
    },
    [quittungVorbereiten],
  );

  // In einer Ref, damit der Intervall-Effekt nicht je Render neu aufgesetzt wird (sonst liefe die
  // Frist nie ab).
  const autosaveRef = useRef<() => void>(() => {});
  autosaveRef.current = () => {
    if (!ungespeichert) return;
    /**
     * Der Riegel sperrt DIE DUBLETTE, nicht den Fortschritt: ein Blur mit NEUEREM Stand bekommt
     * seinen eigenen PATCH, den die `speicherfolge` der Seite hinter den laufenden setzt.
     */
    if (laeuftRef.current && aenderungRef.current === standRef.current) return;
    // Der Grund bleibt als Zustand stehen, bis ein Speichern gelingt.
    speichereMit(form.getFieldsValue()).catch(meldeSpeicherfehler);
  };

  const speichereJetzt = useCallback(
    async (werte: W) => {
      // (a) SCHON GESICHERT: der Blur-Autosave dieses Klicks ist zurück, ein PATCH wäre die Dublette.
      if (!laeuftRef.current && aenderungRef.current === gesichertRef.current) return;
      // (b) NOCH UNTERWEGS und mit demselben Stand losgeschickt: anhängen statt doppeln.
      const laufend =
        laeuftRef.current && aenderungRef.current === standRef.current ? auftragRef.current : null;
      try {
        // (c) Sonst ein eigener PATCH — ungesicherter Stand oder ein laufender Auftrag mit älterem.
        if (laufend) await laufend;
        else await speichereMit(werte);
      } catch (e) {
        meldeSpeicherfehler(e);
        throw e; // Der Aufrufer entscheidet über Toast, Dialog und Freigabe.
      }
    },
    [speichereMit, meldeSpeicherfehler],
  );

  useEffect(() => {
    if (!istEntwurf) return;
    const uhr = setInterval(() => autosaveRef.current(), AUTOSAVE_MS);
    return () => clearInterval(uhr);
  }, [istEntwurf]);

  useEffect(() => {
    if (!ungespeichert) return;
    const warnen = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Zusätzlich zu `preventDefault`: ältere Browser werten allein `returnValue`.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [ungespeichert]);

  const markiereGeaendert = useCallback(() => {
    aenderungRef.current += 1;
    setUngespeichert(true);
  }, []);
  const autosaveJetzt = useCallback(() => autosaveRef.current(), []);

  return {
    ungespeichert,
    zuletztGespeichert,
    speicherFehler,
    markiereGeaendert,
    autosaveJetzt,
    speichereJetzt,
    speichertGerade,
    formularEingehaengt: formular.melde,
  };
}
