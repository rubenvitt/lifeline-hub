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
  /** Der PATCH. Wird über eine Ref gelesen, darf also inline stehen. */
  speichern: (werte: W) => Promise<unknown>;
  /** Nach JEDEM erfolgreichen Speichern (Invalidierung) — genau einmal je PATCH. */
  onGespeichert?: () => void;
}

export interface Verlustschutz<W extends object> {
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
  /**
   * DER EINZIGE Weg für ein Speichern ausserhalb der Uhr: „Entwurf speichern" und der
   * Freigabe-Vorlauf. Lehnt mit dem Grund des Servers ab, NACHDEM sie ihn in
   * `speicherFehler` gelegt hat — der Aufrufer braucht dafür kein eigenes `onError`.
   */
  speichereJetzt: (werte: W) => Promise<void>;
  /** Läuft gerade ein Speichern — Autosave ODER expliziter Pfad. */
  speichertGerade: boolean;
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
 * **EIN KLICK IST EIN PATCH (LFH-495).** Ein Klick auf „Entwurf speichern" ist ZWEI
 * Ereignisse: er nimmt dem Feld zuerst den Fokus — `onBlur` startet den Autosave —, und
 * erst danach kommt `click` mit `form.submit()`. Bis dahin sperrte `laeuftRef` nur Autosave
 * gegen Autosave, der explizite Pfad lief daneben: zwei PATCH mit identischem Inhalt, zwei
 * SSE-Ereignisse, zwei Invalidierungen — und im Befehl zwei Glieder in der `speicherfolge`,
 * also der zweite PATCH erst nach dem ersten. Deshalb gibt es jetzt EINEN Speicherweg
 * (`speichereMit`), den beide Pfade nehmen, und `speichereJetzt` HÄNGT SICH AN einen
 * laufenden PATCH an, statt einen zweiten zu schicken.
 *
 * **ANHÄNGEN ALLEIN GENÜGT NICHT — es wäre ein Rennen** (gemessen: der Test „EINEN PATCH,
 * nicht zwei" war damit rot). Zwischen `mousedown` (Blur) und `click` liegen Millisekunden;
 * ein schneller PATCH ist da längst zurück, der Riegel offen, und der explizite Pfad
 * schickte die Dublette doch. Deshalb steht VOR dem Anhängen die Frage „ist dieser Stand
 * schon gesichert?" (`gesichertRef`) — damit ist die Zusicherung von der Antwortzeit des
 * Servers unabhängig: fällt das Rennen zugunsten des Autosave aus, greift (a), fällt es
 * andersherum aus, greift (b). Ein Ticket-Wortlaut „gemeinsamer Riegel" allein hätte nur (b)
 * gebaut.
 *
 * Angehängt wird nur **bei gleichem Stand**: trägt der laufende PATCH S1, während im
 * Formular schon S2 steht, wäre das Anhängen eine Quittung über einen Stand, den der Server
 * nicht hat — genau das Verlustfenster, das der Änderungszähler unten zuhält. Dann läuft der
 * explizite Pfad als eigener PATCH, wie bisher. Der Riegel fällt nur, wenn ihn noch derselbe
 * Auftrag hält (`auftragRef`-Vergleich im `finally`); sonst räumte ein zweiter, früher
 * fertiger Auftrag ihn dem ersten unter den Füssen weg.
 *
 * **DER RIEGEL IST DIE EINZIGE PFORTE — deshalb ist die API eng.** `quittungVorbereiten`,
 * `quittiereGespeichert` und `meldeSpeicherfehler` waren bis LFH-495 öffentlich, damit die
 * Seiten ihren Speicherpfad selbst zusammensetzen konnten; genau daraus entstand der
 * Doppel-PATCH. Sie sind ENTFERNT und nicht bloss ungenutzt — dieselbe Begründung wie bei
 * `onFehler` in LFH-494: solange sie existieren, baut die nächste Seite den zweiten Pfad
 * wieder daneben, und „ein Klick ist ein PATCH" wäre Konvention statt Struktur.
 *
 * **DER FEHLER IST ZUSTAND, KEIN RÜCKRUF (LFH-494).** Bis dahin nahm der Hook ein
 * `onFehler`, und beide Seiten reichten dort ihr `message.error` hinein: nach rund drei
 * Sekunden war der Grund weg, sichtbar blieb „ungespeicherte Änderungen" — das WAS ohne das
 * WARUM, an einer Führungsunterlage, deren Verlust erst Stunden später auffällt. Das ist
 * dieselbe Diagnose wie C10/H14 an den Einstellungsseiten; Träger ist derselbe
 * (`components/SpeicherHinweis.tsx`).
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
}: VerlustschutzArgs<D, W>): Verlustschutz<W> {
  const [ungespeichert, setUngespeichert] = useState(false);
  const [zuletztGespeichert, setZuletztGespeichert] = useState<string | null>(null);
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const [speicherFehler, setSpeicherFehler] = useState<unknown>(null);

  // Inline-Callbacks in Refs: der Sync-Effekt hängt an `daten` und `ungespeichert`, nicht
  // an der Identität von `werteAus` — sonst liefe er bei jedem Render der Seite neu. Aus
  // demselben Grund liegen `speichern` und `onGespeichert` in Refs: `speichereMit` ist ein
  // `useCallback`, das sonst bei jedem Anschlag eine neue Identität bekäme.
  const werteAusRef = useRef(werteAus);
  werteAusRef.current = werteAus;
  const speichernRef = useRef(speichern);
  speichernRef.current = speichern;
  const onGespeichertRef = useRef(onGespeichert);
  onGespeichertRef.current = onGespeichert;

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
  /**
   * Welcher Änderungsstand liegt NACHWEISLICH auf dem Server? Die Ref-Fassung von
   * `!ungespeichert` — und der State taugt dafür nicht: `speichereJetzt` ist ein
   * `useCallback` und läse `ungespeichert` aus der Render-Closure, also möglicherweise eine
   * Runde zu alt. Hier geht es aber um „hat der Klick, der gerade läuft, noch etwas zu
   * tun?", und diese Frage muss im selben Tick richtig beantwortet sein.
   *
   * START AUF `-1`, NICHT AUF `0`: „nichts geändert" und „nichts gesendet" sind zwei
   * verschiedene Zustände, und mit `0` fielen sie zusammen. Ein Klick auf „Entwurf
   * speichern" an einem UNBERÜHRTEN Entwurf muss seinen PATCH behalten — der
   * Freigabe-Vorlauf läuft durch denselben Weg, und `/freigeben` prüft den
   * PERSISTIERTEN Stand, nicht den Editor-Inhalt (`LageberichtePage.test.tsx`, N23, pinnt
   * genau diesen PATCH). Erst ein erfolgreiches Speichern setzt die Ref auf einen echten
   * Stand; danach ist ein zweiter Klick ohne Änderung tatsächlich nichts zu tun.
   */
  const gesichertRef = useRef(-1);
  const quittungVorbereiten = useCallback(() => {
    const stand = aenderungRef.current;
    return () => {
      // VOR der Verzweigung: der Server hat in BEIDEN Zweigen erfolgreich gespeichert.
      // Nur im ersten zu räumen liesse nach einem von einem Tastenanschlag überholten
      // Speichern einen veralteten Grund stehen — genau der Zustand, den LFH-494 abschafft.
      setSpeicherFehler(null);
      gesichertRef.current = stand;
      if (aenderungRef.current === stand) quittiereGespeichert();
      else setZuletztGespeichert(dayjs().format('HH:mm'));
    };
  }, [quittiereGespeichert]);

  // Riegel gegen zwei gleichzeitige Speicherungen als Ref, nicht als State: zwei Aufrufe im
  // selben Tick sähen beide den alten State (React batcht). `standRef` ist der
  // Änderungsstand, mit dem der laufende Auftrag losgeschickt wurde — nur bei Gleichstand
  // darf sich der explizite Pfad anhängen.
  const laeuftRef = useRef(false);
  const auftragRef = useRef<Promise<unknown> | null>(null);
  const standRef = useRef(0);

  /** Der EINE Speicherweg. Lehnt mit dem Grund des Servers ab; Zustand setzt der Aufrufer. */
  const speichereMit = useCallback((werte: W) => {
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
        // Nur der Auftrag, der den Riegel HÄLT, gibt ihn frei — sonst öffnete ein zweiter,
        // früher fertiger Auftrag die Pforte, während der erste noch unterwegs ist.
        if (auftragRef.current !== auftrag) return;
        laeuftRef.current = false;
        auftragRef.current = null;
        setSpeichertGerade(false);
      });
  }, [quittungVorbereiten]);

  // In einer Ref, damit der Intervall-Effekt nicht bei jedem Render neu aufgesetzt wird
  // (sonst liefe die Frist nie ab — dieselbe Falle wie bei instabilen Effekt-Deps).
  const autosaveRef = useRef<() => void>(() => {});
  autosaveRef.current = () => {
    if (!ungespeichert) return;
    /**
     * Der Riegel sperrt gegen DIE DUBLETTE, nicht gegen den Fortschritt (gemessen in
     * LFH-495): ein `laeuftRef.current`-Riegel allein verschluckte den Blur-Autosave eines
     * NEUEREN Standes, solange ein älterer PATCH unterwegs war — `BefehlDetailPage`s
     * Reihenfolge-Test fiel darauf sofort um, und dort geht es genau um den Fall „erst
     * manuell speichern, dann weitertippen, dann die Seite verlassen". Trägt der laufende
     * Auftrag denselben Stand, ist der Inhalt schon unterwegs; ein neuerer bekommt seinen
     * eigenen PATCH, den die `speicherfolge` der Seite hinter den ersten setzt.
     */
    if (laeuftRef.current && aenderungRef.current === standRef.current) return;
    // Der Grund bleibt als Zustand stehen, bis ein Speichern GELINGT (LFH-494).
    // Die Speicher-Sperre hängt am Request, nicht an dieser Rückmeldung.
    speichereMit(form.getFieldsValue()).catch(meldeSpeicherfehler);
  };

  const speichereJetzt = useCallback(async (werte: W) => {
    // (a) SCHON GESICHERT. Der Blur-Autosave dieses Klicks ist bereits zurück, der Server
    // trägt denselben Stand — ein PATCH wäre die Dublette. Dasselbe Urteil, das der
    // Autosave über `ungespeichert` trifft, nur aus der Ref gelesen.
    if (!laeuftRef.current && aenderungRef.current === gesichertRef.current) return;
    // (b) NOCH UNTERWEGS und mit demselben Stand losgeschickt: anhängen statt doppeln.
    const laufend =
      laeuftRef.current && aenderungRef.current === standRef.current ? auftragRef.current : null;
    try {
      // (c) Sonst ein eigener PATCH — ungesicherter Stand, oder ein laufender Auftrag mit
      // einem älteren.
      if (laufend) await laufend;
      else await speichereMit(werte);
    } catch (e) {
      meldeSpeicherfehler(e);
      throw e; // Der Aufrufer entscheidet über Toast, Dialog und Freigabe.
    }
  }, [speichereMit, meldeSpeicherfehler]);

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
  };
}
