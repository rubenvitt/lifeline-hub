/**
 * Verlaufsgedächtnis (LLH-1997): je Verlaufseintrag (`location.key`) die Adresse, von der aus man
 * ihn per PUSH betreten hat. Der Ortspfad einer Detailseite (`components/ListenRueckweg.tsx`)
 * fragt daraus, ob die vorige Seite seine Liste war, und geht dann per `navigate(-1)` zurück.
 * Geschrieben wird nur von `VerlaufMerken` im `BetriebsLayout`.
 *
 * Gespeichert im `sessionStorage` (`lfh:verlauf`), damit die Herkunft ein Neuladen im selben Tab
 * übersteht: `location.key` liegt im `history.state` und überlebt es auch. Die Liste in diesem
 * Modul ist die Quelle; der Speicher ist nur ihr Abbild. Ist er gesperrt (gehärtete Rechner,
 * `frontend/AGENTS.md`, Browserspeicher), arbeitet das Gedächtnis ohne ihn weiter, vergisst dann
 * aber beim Neuladen. Die Adressen tragen Filter- und Suchtexte, deshalb räumt jeder Ausgang
 * (`GERAETESPEICHER`, `offline/geraetRaeumung.ts`).
 *
 * Herleitung: `docs/superpowers/specs/2026-11-19-z7oww8sf-ortspfad-rueckweg-liste-design.md`.
 */

export type VorigeAdresse = { pathname: string; search: string };

export const VERLAUF_SCHLUESSEL = 'lfh:verlauf';
export const VERLAUF_HOECHSTENS = 50;

/** Der erste Eintrag eines Tabs hat diesen Key; er hat nie eine Herkunft. */
const ERSTER_KEY = 'default';

type Zeile = [key: string, adresse: VorigeAdresse];

function istZeile(wert: unknown): wert is Zeile {
  if (!Array.isArray(wert) || wert.length !== 2 || typeof wert[0] !== 'string') return false;
  const adresse = wert[1] as Partial<VorigeAdresse> | null;
  return (
    typeof adresse === 'object' &&
    adresse !== null &&
    typeof adresse.pathname === 'string' &&
    typeof adresse.search === 'string'
  );
}

function ladeZeilen(): Zeile[] {
  try {
    const roh = globalThis.sessionStorage?.getItem(VERLAUF_SCHLUESSEL);
    if (!roh) return [];
    const wert: unknown = JSON.parse(roh);
    return Array.isArray(wert) ? wert.filter(istZeile).slice(-VERLAUF_HOECHSTENS) : [];
  } catch {
    /* Speicher gesperrt oder Inhalt kaputt: ohne Gedächtnis beginnen */
    return [];
  }
}

let zeilen: Zeile[] = ladeZeilen();

function sichere(): void {
  try {
    globalThis.sessionStorage?.setItem(VERLAUF_SCHLUESSEL, JSON.stringify(zeilen));
  } catch {
    /* Speicher gesperrt: das Gedächtnis in diesem Modul trägt weiter */
  }
}

const zuhoerer = new Set<() => void>();

/** Für `useSyncExternalStore`: wer liest, erfährt von jeder späteren Herkunft. */
export function abonniereHerkunft(zuhoererNeu: () => void): () => void {
  zuhoerer.add(zuhoererNeu);
  return () => zuhoerer.delete(zuhoererNeu);
}

/**
 * Meldet geschriebene Herkünfte an die Leser. Nicht aus `merkeHerkunft` selbst, weil das im
 * Render läuft (`VerlaufMerken`) und ein Update anderer Komponenten dort verboten ist; der
 * Layout-Effekt von `VerlaufMerken` ruft es.
 */
export function meldeHerkunft(): void {
  zuhoerer.forEach((z) => z());
}

/** Merkt die Herkunft eines per PUSH betretenen Eintrags; ältere fallen über 50 heraus. */
export function merkeHerkunft(key: string, adresse: VorigeAdresse): void {
  if (key === ERSTER_KEY) return;
  const bisher = leseHerkunft(key);
  // Gleiche Herkunft, gleiches Objekt: der Schnappschuss der Leser bleibt stabil.
  if (bisher && bisher.pathname === adresse.pathname && bisher.search === adresse.search) return;
  zeilen = zeilen.filter(([k]) => k !== key);
  zeilen.push([key, { pathname: adresse.pathname, search: adresse.search }]);
  if (zeilen.length > VERLAUF_HOECHSTENS) zeilen = zeilen.slice(-VERLAUF_HOECHSTENS);
  sichere();
}

/** Ein REPLACE ersetzt den Eintrag: die Herkunft wandert auf den neuen Key. */
export function uebertrageHerkunft(alterKey: string, neuerKey: string): void {
  const herkunft = leseHerkunft(alterKey);
  if (herkunft) merkeHerkunft(neuerKey, herkunft);
}

export function leseHerkunft(key: string): VorigeAdresse | null {
  const zeile = zeilen.find(([k]) => k === key);
  return zeile ? zeile[1] : null;
}

/** Jeder Ausgang (`offline/geraetRaeumung.ts`). */
export function verlaufGedaechtnisRaeumen(): void {
  zeilen = [];
  try {
    globalThis.sessionStorage?.removeItem(VERLAUF_SCHLUESSEL);
  } catch {
    /* Speicher gesperrt: dann liegt dort auch nichts */
  }
}
