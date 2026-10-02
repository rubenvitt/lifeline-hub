/**
 * HEIC/HEIF-Vorschau auf dem Gerät (LFH-759, Spec `anhang-vorschau`, Herleitung
 * `openspec/changes/archive/2026-10-02-lfh-759-bildvorschau-anhaenge/design.md` D8).
 *
 * Lädt die BEREINIGTE Fassung (nie `fassung=original`) und lässt sie im Worker
 * (`heicWorker.ts`, libheif als WASM) zu zwei JPEG-Blobs dekodieren: klein für die Kachel, groß
 * für die Großansicht. Ein Worker arbeitet die Aufträge der Reihe nach ab, damit ein schwaches
 * Tablet nie zwei Dekodierungen zugleich trägt. Worker und WASM entstehen erst beim ersten
 * Auftrag; dieses Modul selbst lädt `AnhangVorschau` erst bei einem HEIC per `import()`.
 */

export interface HeicVorschau {
  klein: Blob;
  gross: Blob;
}

type Antwort = { id: number; klein?: Blob; gross?: Blob; fehler?: string; tot?: boolean };

/**
 * Längste Zeit für einen Auftrag. Danach gilt der Worker als hängend: der Auftrag scheitert (die
 * Kachel zeigt den Platzhalter), der Worker wird ersetzt, und die Warteschlange läuft weiter.
 */
export const ZEITLIMIT_MS = 60_000;
type Offen = { fertig: (v: HeicVorschau) => void; fehler: (e: Error) => void };

/** Baut einen Dekodierer; Worker und Laden sind für Tests austauschbar. */
export function erzeugeHeicDekodierer(
  neuerWorker: () => Worker,
  laden: (href: string) => Promise<ArrayBuffer>,
  zeitlimitMs: number = ZEITLIMIT_MS,
): (href: string) => Promise<HeicVorschau> {
  let worker: Worker | null = null;
  let naechsteId = 1;
  let kette: Promise<unknown> = Promise.resolve();
  const offen = new Map<number, Offen>();

  /** Beendet den Worker und lässt alle offenen Aufträge scheitern; der nächste baut neu auf. */
  function verwerfe(w: Worker, grund: string) {
    for (const auftrag of offen.values()) auftrag.fehler(new Error(grund));
    offen.clear();
    w.terminate();
    if (worker === w) worker = null;
  }

  function holeWorker(): Worker {
    if (worker) return worker;
    const w = neuerWorker();
    w.onmessage = (e: MessageEvent<Antwort>) => {
      const { id, klein, gross, fehler, tot } = e.data;
      const auftrag = offen.get(id);
      if (auftrag) {
        offen.delete(id);
        if (klein && gross) auftrag.fertig({ klein, gross });
        else auftrag.fehler(new Error(fehler ?? 'HEIC nicht dekodierbar'));
      }
      if (tot) verwerfe(w, fehler ?? 'Worker');
    };
    // Ein abgestürzter Worker nimmt seine Aufträge mit; der nächste Auftrag baut einen frischen auf.
    w.onerror = (e: ErrorEvent) => verwerfe(w, e.message || 'Worker');
    worker = w;
    return w;
  }

  return function dekodiere(href: string): Promise<HeicVorschau> {
    const lauf = kette.then(async () => {
      const daten = await laden(href);
      const id = naechsteId++;
      const w = holeWorker();
      return new Promise<HeicVorschau>((fertig, fehler) => {
        const uhr = setTimeout(() => verwerfe(w, 'Zeitlimit'), zeitlimitMs);
        offen.set(id, {
          fertig: (v) => {
            clearTimeout(uhr);
            fertig(v);
          },
          fehler: (f) => {
            clearTimeout(uhr);
            fehler(f);
          },
        });
        w.postMessage({ id, daten }, [daten]);
      });
    });
    kette = lauf.catch(() => undefined);
    return lauf;
  };
}

/** Lädt die bereinigte Fassung mit dem Sitzungs-Cookie; jeder Fehlerstatus ist ein Fehler. */
async function ladeBereinigt(href: string): Promise<ArrayBuffer> {
  const antwort = await fetch(href, { credentials: 'same-origin' });
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  return antwort.arrayBuffer();
}

/** Der Dekodierer der App. */
export const dekodiereHeic = erzeugeHeicDekodierer(
  () => new Worker(new URL('./heicWorker.ts', import.meta.url), { type: 'module' }),
  ladeBereinigt,
);
