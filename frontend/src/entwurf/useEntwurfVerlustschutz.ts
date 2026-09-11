import type { FormInstance } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Frist des stillen Autosave. 30 s ist die Vorgabe aus dem Befund N18 (LFH-342 · C7). */
export const AUTOSAVE_MS = 30_000;

export interface VerlustschutzArgs<D, W extends object> {
  /** Serverstand (Query-Data). `undefined`, solange nichts geladen ist. */
  daten: D | undefined;
  /** Nur im Entwurf läuft die Autosave-Uhr. */
  istEntwurf: boolean;
  form: FormInstance<W>;
  /** Serverstand → Formularwerte. Wird über eine Ref gelesen, darf also inline stehen. */
  werteAus: (daten: D) => W;
  /** Stiller Autosave — KEIN Erfolgs-Toast (siehe Doc-Kommentar unten). */
  speichern: (werte: W) => Promise<unknown>;
  /** Nach erfolgreichem Autosave (Invalidierung). */
  onGespeichert?: () => void;
}

export interface Verlustschutz {
  /** Gibt es eine Fassung im Formular, die noch nicht auf dem Server steht? */
  ungespeichert: boolean;
  /** `HH:mm` des letzten erfolgreichen Speicherns (Autosave oder Knopf), sonst `null`. */
  zuletztGespeichert: string | null;
  /** An `Form onValuesChange`. */
  markiereGeaendert: () => void;
  /** An `Form onBlur` — speichert sofort, wenn etwas offen ist. */
  autosaveJetzt: () => void;
  /**
   * Grund des zuletzt gescheiterten Speicherns, sonst `null` — für `SpeicherFehler`
   * (LFH-494). Fällt erst beim nächsten GELUNGENEN Speichern, nicht beim nächsten Versuch.
   */
  speicherFehler: unknown;
  /** Speicherfehler aus einem Pfad ausserhalb des Autosave (Knopf, Freigabe) melden. */
  meldeSpeicherfehler: (e: unknown) => void;
  /** Nach einem expliziten Speichern des Aufrufers: setzt Merker und Zeitstempel. */
  quittiereGespeichert: () => void;
  /** VOR einem asynchronen Speichern aufrufen, zurückgegebene Quittung erst bei Erfolg. */
  quittungVorbereiten: () => () => void;
  autosaveLaeuft: boolean;
}

/**
 * Verlustschutz für Entwurfsformulare — gehoben aus `BefehlDetailPage` (LFH-342 · C7,
 * Befund N18) nach `entwurf/`, damit `LageberichtDetailPage` (LFH-348 · C13, Befund H63)
 * denselben Mechanismus trägt und nicht einen zweiten daneben.
 *
 * Drei Teile, jeder mit einer eigenen Falle:
 *
 * **(1) DER RIEGEL.** Der Effekt, der den Serverstand ins Formular schreibt, hält, solange
 * eine eigene Fassung offen ist. Die Invalidierung kommt nicht nur vom eigenen Speichern,
 * sondern über den konsolidierten Live-Stream auch von jeder FREMDEN Änderung (zweiter Tab,
 * anderes Stabsmitglied) — wer gerade schrieb, sah seinen Text ohne Vorwarnung ersetzt.
 * Die Umkehrung ist genauso wichtig und eigens getestet: OHNE eigene Fassung übernimmt die
 * Seite den Serverstand weiter; ein Riegel, der immer hält, machte sie still veraltet.
 *
 * **(2) DER MERKER IST EIGENER STATE**, nicht `form.isFieldsTouched()`: antd setzt das
 * Berührt-Flag beim Speichern nicht zurück. Ein Autosave darauf schriebe alle 30 s ein
 * PATCH samt Invalidierung und Live-Ereignis — auch wenn sich nichts geändert hat —, und
 * der Verlassen-Schutz fragte bis zum Seitenwechsel nach etwas, das längst gesichert ist.
 * (Das Ticket zu C13 verlangte `isFieldsTouched()`; das ist aus diesem Grund nicht gebaut.)
 *
 * **(3) AUTOSAVE IST STILL.** Eine Erfolgsmeldung alle 30 Sekunden wäre eine Alarmquelle
 * nach EEMUA 191 und keine Rückmeldung. Sichtbar ist stattdessen `zuletztGespeichert` neben
 * dem Speichern-Knopf — ein Autosave, den niemand sieht, ist von „nicht gespeichert" nicht
 * zu unterscheiden. Der FEHLERFALL meldet sich dagegen sehr wohl — seit LFH-494 als
 * ZUSTAND (`speicherFehler`) statt als Rückruf in einen Toast.
 *
 * **DER FEHLER IST ZUSTAND, KEIN RÜCKRUF (LFH-494).** Bis dahin nahm der Hook ein
 * `onFehler`, und beide Seiten reichten dort ihr `message.error` hinein: nach rund drei
 * Sekunden war der Grund weg, sichtbar blieb „ungespeicherte Änderungen" — das WAS ohne das
 * WARUM, an einer Führungsunterlage, deren Verlust erst Stunden später auffällt. Das ist
 * dieselbe Diagnose wie C10/H14 an den Einstellungsseiten; Träger ist derselbe
 * (`components/SpeicherHinweis.tsx`). Die Prop ist deshalb ENTFERNT und nicht bloß ungenutzt
 * — solange sie existiert, schreibt die nächste Seite den Toast wieder hinein, und die
 * Zusicherung wäre Konvention statt Struktur.
 *
 * **GERÄUMT WIRD BEI ERFOLG, NICHT BEIM NÄCHSTEN VERSUCH** — und das weicht bewusst von
 * react-querys `pending`-Semantik ab, auf die sich C10 stützt. Dort drückt ein Mensch den
 * Knopf; hier wiederholt eine 30-s-Frist von selbst. Beim Start zu räumen liesse den Alert
 * bei einem stehenden 503 im Takt verschwinden und wiederkommen („Kein Blinken auf lesbarem
 * Text", CLAUDE.md) — also genau in dem Fall unlesbar, für den er existiert. Der
 * Anlege-Dialog der Berichtsliste läuft weiter über `mutation.error` und räumt beim
 * Absenden: dort gibt es keinen Auto-Retry. Zwei Pfade, zwei Träger, je passend.
 *
 * Seit LFH-462 nutzt der Befehlsentwurf zusätzlich `EntwurfNavigationSchutz` mit
 * `useBlocker` im Data Router. Er liest denselben Merker und setzt eine angehaltene
 * Navigation nach erfolgreichem Autosave fort. Der Lagebericht behält Blur-Autosave
 * und `beforeunload`; dieser Hook selbst bleibt unabhängig vom Router.
 *
 * DER MERKER GEHÖRT ZU EINEM DATENSATZ. Wechselt die Route auf denselben Komponententyp mit
 * anderer ID (Fortschreiben → neuer Entwurf), bleibt der Hook-State stehen und der Riegel
 * des alten Berichts hielte den neuen Serverstand fern. Die Seiten rendern ihren Inhalt
 * deshalb mit `key={id}` — der Remount ist der Reset.
 */
export function useEntwurfVerlustschutz<D, W extends object>({
  daten,
  istEntwurf,
  form,
  werteAus,
  speichern,
  onGespeichert,
}: VerlustschutzArgs<D, W>): Verlustschutz {
  const [ungespeichert, setUngespeichert] = useState(false);
  const [zuletztGespeichert, setZuletztGespeichert] = useState<string | null>(null);
  const [autosaveLaeuft, setAutosaveLaeuft] = useState(false);
  const [speicherFehler, setSpeicherFehler] = useState<unknown>(null);

  // Inline-Callbacks in Refs: der Sync-Effekt hängt an `daten` und `ungespeichert`, nicht
  // an der Identität von `werteAus` — sonst liefe er bei jedem Render der Seite neu.
  const werteAusRef = useRef(werteAus);
  werteAusRef.current = werteAus;

  useEffect(() => {
    if (!daten) return;
    if (ungespeichert) return; // DER RIEGEL (1)
    form.setFieldsValue(werteAusRef.current(daten) as Parameters<typeof form.setFieldsValue>[0]);
  }, [daten, form, ungespeichert]);

  /**
   * Ein abgebrochener Auftrag ist kein Speicherfehler. `BefehlDetailPage` beendet die
   * Speicherfolge beim Verlassen des Editors mit einem `AbortError` — den als Grund
   * stehenzulassen behauptete einen Verlust, den es nicht gab.
   */
  const meldeSpeicherfehler = useCallback((e: unknown) => {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    setSpeicherFehler(e);
  }, []);

  const quittiereGespeichert = useCallback(() => {
    setUngespeichert(false);
    setZuletztGespeichert(dayjs().format('HH:mm'));
    setSpeicherFehler(null);
  }, []);

  /**
   * Änderungszähler — die Antwort auf das Verlustfenster IM Verlustschutz (Review LFH-348):
   * blur startet den PATCH mit Schnappschuss S1, im nächsten Feld wird weitergetippt (S2),
   * der PATCH kommt zurück und quittierte S1 als „gespeichert" — der Merker fiel, der
   * Warner meldete sich ab, und S2 lag ungesichert im Formular, ohne dass die Seite es
   * sagte. Quittiert wird deshalb nur, wenn seit dem Start des Speicherns nichts mehr
   * geändert wurde; sonst bleibt der Merker stehen und die nächste Frist holt S2 nach.
   */
  const aenderungRef = useRef(0);
  const quittungVorbereiten = useCallback(() => {
    const stand = aenderungRef.current;
    return () => {
      // VOR der Verzweigung: der Server hat in BEIDEN Zweigen erfolgreich gespeichert.
      // Nur im ersten zu räumen liesse nach einem von einem Tastenanschlag überholten
      // Speichern einen veralteten Grund stehen — genau der Zustand, den LFH-494 abschafft.
      setSpeicherFehler(null);
      if (aenderungRef.current === stand) quittiereGespeichert();
      else setZuletztGespeichert(dayjs().format('HH:mm'));
    };
  }, [quittiereGespeichert]);
  // Riegel gegen zwei gleichzeitige Autosaves als Ref, nicht als State: zwei Aufrufe im
  // selben Tick sähen beide den alten State (React batcht).
  const laeuftRef = useRef(false);

  // In einer Ref, damit der Intervall-Effekt nicht bei jedem Render neu aufgesetzt wird
  // (sonst liefe die Frist nie ab — dieselbe Falle wie bei instabilen Effekt-Deps).
  const autosaveRef = useRef<() => void>(() => {});
  autosaveRef.current = () => {
    if (!ungespeichert || laeuftRef.current) return;
    laeuftRef.current = true;
    setAutosaveLaeuft(true);
    const quittieren = quittungVorbereiten();
    speichern(form.getFieldsValue())
      .then(() => {
        quittieren();
        onGespeichert?.();
      })
      .catch((e) => {
        // Der Grund bleibt als Zustand stehen, bis ein Speichern GELINGT (LFH-494).
        // Die Speicher-Sperre hängt am Request, nicht an dieser Rückmeldung.
        meldeSpeicherfehler(e);
      })
      .finally(() => {
        laeuftRef.current = false;
        setAutosaveLaeuft(false);
      });
  };

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
    meldeSpeicherfehler,
    markiereGeaendert,
    autosaveJetzt,
    quittiereGespeichert,
    quittungVorbereiten,
    autosaveLaeuft,
  };
}
