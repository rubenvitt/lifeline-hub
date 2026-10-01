/**
 * Die EINE Ableitung „Unwetter am Einsatzort" (LFH-663,
 * `openspec/changes/lfh-663-unwetterwarnung-alarmbudget/design.md` D4/D9): Modulzähler,
 * AlarmZentrale-Hinweis und Überblick-Marke lesen nur diese Datei.
 *
 * „Unwetter" heißt: amtliche Stufe schwer oder extrem, gültig (Ende nicht verstrichen), aus
 * einem verwertbaren Stand (`aktuell`/`veraltet`). Gering und mäßig bleiben auf der Modulseite:
 * sie verlangen in der Regel keine Handlung und fluteten das Alarmbudget (D1).
 *
 * Rein; strukturelle Eingabetypen, damit die Datei nur an den gelesenen Feldern hängt.
 */
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import type { WetterWarnstufe } from '../api/types';
import { dwdWarnstufe } from '../theme/statusFarben';
import { titelSchreibung, warnZeitraum } from './wetterText';
import { OBERGRENZE_MS, teilStand, teileWarnungen } from './wetterStand';

export const UNWETTER_STUFEN: readonly WetterWarnstufe[] = ['schwer', 'extrem'];

/** Rangfolge der Stufen; ein Record, damit eine neue Stufe den Typcheck bricht. */
const RANG: Record<WetterWarnstufe, number> = { gering: 0, maessig: 1, schwer: 2, extrem: 3 };

/**
 * Wie lange ein gemeldetes Paar als gemeldet gilt — die Obergrenze des Warnstands: eine Lücke
 * in der Quelle unterhalb davon alarmiert nicht neu (D4).
 */
export const UNWETTER_FENSTER_MS = OBERGRENZE_MS.warnungen;

type Warnung = {
  stufe: WetterWarnstufe;
  ereignis: string;
  beginn?: string | null;
  ende?: string | null;
};

type WarnTeil<W extends Warnung = Warnung> = {
  zustand: string;
  abgerufen_at?: string | null;
  daten?: readonly W[] | null;
};

export function istUnwetter(stufe: WetterWarnstufe): boolean {
  return UNWETTER_STUFEN.includes(stufe);
}

/**
 * Die gültigen Unwetterwarnungen, getrennt nach „gilt jetzt" und „angekündigt"; `null`, wenn
 * kein verwertbarer Stand vorliegt (Stand unbekannt, Ausfall, kein Ort) — dann gibt es weder
 * Zahl noch Hinweis noch Marke, auch keine 0.
 */
export function unwetterLage<W extends Warnung>(
  teil: WarnTeil<W> | null | undefined,
  jetzt: number,
): { giltJetzt: W[]; angekuendigt: W[] } | null {
  if (!teil) return null;
  const art = teilStand(teil, 'warnungen', jetzt).art;
  if (art !== 'aktuell' && art !== 'veraltet') return null;
  return teileWarnungen(
    (teil.daten ?? []).filter((w) => istUnwetter(w.stufe)),
    jetzt,
  );
}

/**
 * Schlüssel einer Warnung über Aktualisierungen hinweg: Ereignis und Stufe. NICHT die
 * CAP-Kennung — der DWD gibt eine laufende Warnung bei jeder Aktualisierung mit neuer Kennung
 * aus, das wäre der Doppelalarm (D3).
 */
export function paarSchluessel(w: Pick<Warnung, 'stufe' | 'ereignis'>): string {
  return `${w.stufe}|${w.ereignis.trim().toLocaleUpperCase('de-DE')}`;
}

export type UnwetterGedaechtnis = Record<string, { stufe: WetterWarnstufe; gesehenAt: number }>;

const beginnMs = (w: Warnung) => {
  const t = w.beginn ? Date.parse(w.beginn) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * Regel „neu" (D4). Neu ist ein Paar, das in den letzten {@link UNWETTER_FENSTER_MS} nicht
 * gesehen wurde UND dessen Stufe nicht unter der höchsten in dieser Zeit gesehenen liegt —
 * sonst ist es eine Herabstufung. Höchstens EIN Hinweis je Auswertung: die höchste neue Stufe,
 * dann der früheste Beginn; die übrigen neuen Paare zählen als `weitere`.
 *
 * Das zurückgegebene Gedächtnis trägt jedes aktuelle Paar mit `jetzt` und verliert alles, was
 * älter als das Fenster ist.
 */
export function erkenneNeue<W extends Warnung>(
  gedaechtnis: UnwetterGedaechtnis,
  warnungen: readonly W[],
  jetzt: number,
): { neu: W | null; weitere: number; gedaechtnis: UnwetterGedaechtnis } {
  const frisch: UnwetterGedaechtnis = {};
  let hoechsterRang = -1;
  for (const [schluessel, eintrag] of Object.entries(gedaechtnis)) {
    if (jetzt - eintrag.gesehenAt > UNWETTER_FENSTER_MS) continue;
    frisch[schluessel] = eintrag;
    hoechsterRang = Math.max(hoechsterRang, RANG[eintrag.stufe]);
  }

  const kandidaten = new Map<string, W>();
  for (const w of warnungen) {
    if (!istUnwetter(w.stufe)) continue;
    const schluessel = paarSchluessel(w);
    if (schluessel in frisch || RANG[w.stufe] < hoechsterRang) continue;
    const bisher = kandidaten.get(schluessel);
    if (!bisher || beginnMs(w) < beginnMs(bisher)) kandidaten.set(schluessel, w);
  }
  const sortiert = [...kandidaten.values()].sort(
    (a, b) => RANG[b.stufe] - RANG[a.stufe] || beginnMs(a) - beginnMs(b),
  );

  const neuesGedaechtnis: UnwetterGedaechtnis = { ...frisch };
  for (const w of warnungen) {
    if (istUnwetter(w.stufe)) {
      neuesGedaechtnis[paarSchluessel(w)] = { stufe: w.stufe, gesehenAt: jetzt };
    }
  }
  return {
    neu: sortiert[0] ?? null,
    weitere: Math.max(0, sortiert.length - 1),
    gedaechtnis: neuesGedaechtnis,
  };
}

/** Titel = Stufenbezeichnung (zweiter Kanal neben der Farbe), Beschreibung = Ereignis und
    Zeitraum, bei mehreren neuen „(+ n weitere)". */
export function unwetterHinweisText(
  w: Warnung,
  weitere: number,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): { titel: string; beschreibung: string } {
  const zusatz = weitere > 0 ? ` (+ ${weitere} weitere)` : '';
  return {
    titel: dwdWarnstufe[w.stufe].label,
    beschreibung: `${titelSchreibung(w.ereignis)}, ${warnZeitraum(w.beginn, w.ende, jetzt, konv)}${zusatz}`,
  };
}

/** „Unwetterwarnung: Orkanböen". */
export function unwetterMarkenText(w: Pick<Warnung, 'stufe' | 'ereignis'>): string {
  return `${dwdWarnstufe[w.stufe].label}: ${titelSchreibung(w.ereignis)}`;
}

/**
 * Der nächste Zeitpunkt, an dem sich die Unwetterlage ohne neuen Abruf ändert: ein Beginn
 * (angekündigt → gilt), ein Ende (fällt heraus) oder die Obergrenze des Stands (→ unbekannt).
 * `null`, wenn nichts mehr wechselt. Für den Wecker der Rahmenuhr (`wetter/useUnwetterUhr.ts`).
 */
export function naechsterUnwetterWechsel(
  teil: WarnTeil | null | undefined,
  jetzt: number,
): number | null {
  const lage = unwetterLage(teil, jetzt);
  if (!teil || !lage) return null;
  const alle = [...lage.giltJetzt, ...lage.angekuendigt];
  // Ohne Unwetter wechselt nichts Sichtbares: 0 und „unbekannt" zeigen beide keine Zahl.
  if (alle.length === 0) return null;
  // `teilStand` wird erst JENSEITS der Obergrenze unbekannt (`alter > OBERGRENZE`); sie gilt auch,
  // wenn keine Warnung ein künftiges Datum trägt (Ende „bis auf Weiteres").
  const zeiten = [Date.parse(teil.abgerufen_at as string) + OBERGRENZE_MS.warnungen + 1];
  for (const w of alle) {
    for (const z of [w.beginn, w.ende]) {
      const t = z ? Date.parse(z) : Number.NaN;
      if (Number.isFinite(t) && t > jetzt) zeiten.push(t);
    }
  }
  return Math.min(...zeiten);
}
