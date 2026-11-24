import type {
  AbschlussPruefung,
  Fuehrungsfunktion,
  Einsatzart,
  EinsatzAnzeige,
  EinsatzRolle,
  MitgliedAnzeige,
  MitgliedAuswahl,
  EinsatzEinstellungen,
  EinstellungenUpdate,
  Fuehrungsstelle,
  FuehrungsstellePatch,
  ModulOverride,
  ModulFreigaben,
  ModulOverrides,
  ModulOverrideUpdate,
  OrgModulEinstellungen,
} from './types';
import { apiGet, apiSend } from './client';

export function listeEinsaetze(): Promise<EinsatzAnzeige[]> {
  return apiGet<EinsatzAnzeige[]>('/api/einsaetze');
}

export function ladeEinsatz(id: number): Promise<EinsatzAnzeige> {
  return apiGet<EinsatzAnzeige>(`/api/einsaetze/${id}`);
}

/**
 * Anlegefelder eines Einsatzes. `einsatzart` und `begonnen_at` sind optional; fehlen sie,
 * greifen die DB-Defaults `'realeinsatz'` und `jetzt`.
 */
interface NeuerEinsatz {
  bezeichnung: string;
  stichwort?: string;
  einsatzart?: Einsatzart;
  /** Alarmzeit. Format wie im Kopfdaten-PATCH: `'YYYY-MM-DD HH:mm:ss'`. */
  begonnen_at?: string;
  /** Einsatzort (LFH-1175); die Koordinate nur als Paar. */
  einsatzort?: string;
  einsatzort_lat?: number;
  einsatzort_lon?: number;
  /** Einsatz-Vorlage (LLH-1375): ihre ausgeblendeten Module werden eigene Einsatzwerte. */
  vorlage_id?: number;
  /**
   * Personen, die mit dem Einsatz gleich aufgenommen werden (LLH-1820). Wer anlegt, wird
   * immer Einsatzleitung und steht nicht in der Liste.
   */
  mitglieder?: { benutzer_id: number; rolle: EinsatzRolle }[];
}

export function legeEinsatzAn(daten: NeuerEinsatz): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>('/api/einsaetze', 'POST', daten);
}

export function schliesseEinsatzAb(id: number): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}/close`, 'POST');
}

/** Offene Punkte vor dem Abschluss (LLH-1814, Spec `einsatz-abschluss`): je Gruppe Anzahl und
 *  Kurzliste, unabhängig von den Modulfreigaben. Nur die Einsatzleitung eines aktiven Einsatzes. */
export function loadAbschlussPruefung(id: number): Promise<AbschlussPruefung> {
  return apiGet<AbschlussPruefung>(`/api/einsaetze/${id}/closure/check`);
}

/** Einen abgeschlossenen Einsatz binnen 24 Stunden wieder öffnen (LLH-1814); der Grund ist
 *  Pflicht und steht danach im ETB. */
export function oeffneEinsatzWieder(id: number, grund: string): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}/reopen`, 'POST', { grund });
}

export function ladeMitglieder(id: number): Promise<MitgliedAnzeige[]> {
  return apiGet<MitgliedAnzeige[]>(`/api/einsaetze/${id}/members`);
}

/** Personen, die die Einsatzleitung aufnehmen kann (LFH-1141): nur Kennung und Anzeigename. */
export function ladeMitgliedAuswahl(id: number): Promise<MitgliedAuswahl[]> {
  return apiGet<MitgliedAuswahl[]>(`/api/einsaetze/${id}/members/selection`);
}

/**
 * Personen, die sich schon beim Anlegen aufnehmen lassen (LLH-1820): dieselbe Grundmenge wie
 * unter „Zugriff“, ohne die anlegende Person. Nur Kennung und Anzeigename.
 */
export function loadMitgliedAuswahlAnlage(): Promise<MitgliedAuswahl[]> {
  return apiGet<MitgliedAuswahl[]>('/api/einsaetze/member-selection');
}

/**
 * Führungsstelle als Paar (LFH-549): Katalogcode und Text werden zusammen gesetzt — der Text ist
 * Freitext ohne Code bzw. die Bezeichnung bei Führungshilfspersonal/Fachberater. `null` auf
 * beiden leert die Stelle.
 */
export interface FuehrungsstelleUpdate {
  fuehrungsfunktion: Fuehrungsfunktion | null;
  fuehrungsstelle: string | null;
}

export function setzeMitglied(
  id: number,
  benutzerId: number,
  rolle: EinsatzRolle,
  stelle?: FuehrungsstelleUpdate,
): Promise<MitgliedAnzeige[]> {
  return apiSend<MitgliedAnzeige[]>(`/api/einsaetze/${id}/members/${benutzerId}`, 'PUT', {
    einsatz_rolle: rolle,
    ...(stelle ?? {}),
  });
}

export function entferneMitglied(id: number, benutzerId: number): Promise<MitgliedAnzeige[]> {
  return apiSend<MitgliedAnzeige[]>(`/api/einsaetze/${id}/members/${benutzerId}`, 'DELETE');
}

/** Editierbare Kopffelder; geschrieben wird nur als Teil-PATCH (`patcheEinsatz`). */
interface Kopfdaten {
  bezeichnung: string;
  stichwort: string | null;
  einsatzart: Einsatzart;
  // Keine `einsatznummer_intern`: die vergibt das System beim Anlegen, der Server weist den
  // Schlüssel im PATCH mit 400 ab, auch mit `null`.
  leitstellen_nr: string | null;
  einsatzort: string | null;
  einsatzort_lat: number | null;
  einsatzort_lon: number | null;
  meldende_stelle: string | null;
  sachverhalt: string | null;
  anzahl_betroffene_initial: number | null;
  /** Alarmzeit im SQLite-Format 'YYYY-MM-DD HH:mm:ss'. */
  begonnen_at: string;
  // Kein Termin der nächsten Lagebesprechung: den setzt seit LLH-1111 das Modul Lagebesprechung,
  // der Server weist den Schlüssel im PATCH mit 400 ab.
}

/**
 * Teil der Kopfdaten (LFH-472): fehlender Schlüssel = unverändert, `null` = leeren — so liest der
 * Server den Body (`routes/einsatz.rs:KopfdatenPatch`, Tri-State seit LFH-306).
 */
export type KopfdatenPatch = Partial<Kopfdaten>;

/**
 * Einzelfeld-Weg der Zeilenbearbeitung (LFH-472). Er schickt nur die übergebenen Schlüssel: ein
 * mitgeschicktes fremdes Feld aus einem älteren Seitenstand überschriebe die gleichzeitige
 * Änderung einer anderen Person.
 */
/**
 * Teil-Patch der Kopfdaten. `erwartet` = Werte beim Öffnen (Feld-CAS, LLH-1831, Spec
 * `einsatzdaten-bearbeitung`): weicht einer ab, antwortet der Server 409. Ohne `erwartet` schreibt
 * er ohne Vergleich („Meine Änderung übernehmen“ nach der Rückfrage).
 */
export function patcheEinsatz(
  id: number,
  patch: KopfdatenPatch,
  erwartet?: Partial<KopfdatenPatch>,
): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(
    `/api/einsaetze/${id}`,
    'PATCH',
    erwartet ? { ...patch, erwartet } : patch,
  );
}

/** Eigene Führungsstelle (LFH-849); ohne erfasste Angaben nur `sprechgruppen: []`. */
export function ladeFuehrungsstelle(id: number): Promise<Fuehrungsstelle> {
  return apiGet<Fuehrungsstelle>(`/api/einsaetze/${id}/command-post`);
}

/**
 * Teiländerung der Führungsstelle: nur die übergebenen Schlüssel gehen hinaus (wie die Zeile).
 * `erwartet` = Werte beim Öffnen (Feld-CAS, LLH-1831, Spec `einsatz-fuehrungsstelle`).
 */
export function patcheFuehrungsstelle(
  id: number,
  patch: FuehrungsstellePatch,
  /** Altwerte; der Einsatzleiter ohne „seit“ (`EinsatzleiterAltwert`). */
  erwartet?: Record<string, unknown>,
): Promise<Fuehrungsstelle> {
  return apiSend<Fuehrungsstelle>(
    `/api/einsaetze/${id}/command-post`,
    'PATCH',
    erwartet ? { ...patch, erwartet } : patch,
  );
}

/**
 * Eine Sprechgruppe der Führungsstelle zuordnen (LLH-1456, D4): idempotent, `204` ohne Körper; eine
 * wirksame Zuordnung schreibt der Server ins Tagebuch.
 */
export function ordneFuehrungsstelleSprechgruppeZu(
  einsatzId: number,
  sprechgruppeId: number,
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/command-post/talk-groups/${sprechgruppeId}`,
    'PUT',
  );
}

/** Eine Sprechgruppe der Führungsstelle lösen (LLH-1456, D4): idempotent, `204` ohne Körper. */
export function loeseFuehrungsstelleSprechgruppe(
  einsatzId: number,
  sprechgruppeId: number,
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/command-post/talk-groups/${sprechgruppeId}`,
    'DELETE',
  );
}

/** Einsatz-Einstellungen laden (LFH-131); existiert keine Zeile → Defaults (alle null). */
export function ladeEinstellungen(id: number): Promise<EinsatzEinstellungen> {
  return apiGet<EinsatzEinstellungen>(`/api/einsaetze/${id}/settings`);
}

/** Einsatz-Einstellungen setzen (Vollersatz); nur bei aktivem Einsatz (sonst 409). */
export function speichereEinstellungen(
  id: number,
  felder: EinstellungenUpdate,
): Promise<EinsatzEinstellungen> {
  return apiSend<EinsatzEinstellungen>(`/api/einsaetze/${id}/settings`, 'PUT', felder);
}

/** Modul-Overrides eines Einsatzes laden (LFH-132); Map modul_key→Override (leer = Defaults). */
export function ladeModulOverrides(id: number): Promise<ModulOverrides> {
  return apiGet<ModulOverrides>(`/api/einsaetze/${id}/module-overrides`);
}

/**
 * Modul-Vorgaben der Organisation des Einsatzes (LLH-1183), Form wie
 * `GET /api/org-module-settings`. Lesbar für Mitglieder und die Einsatz-Org, auch ohne
 * Org-Rolle; daraus zeigt der Editor „Module“ die Herkunft von Rolle und Sichtbarkeit.
 */
export function fetchModulVorgaben(id: number): Promise<OrgModulEinstellungen> {
  return apiGet<OrgModulEinstellungen>(`/api/einsaetze/${id}/module-defaults`);
}

/**
 * Effektive Modulfreigaben des angemeldeten Benutzers (LFH-669): je Modul-Key
 * `{ sichtbar, zugriff }`, ausgewertet vom Server mit derselben Regel wie die Modul-Gates.
 */
export function ladeModulFreigaben(id: number): Promise<ModulFreigaben> {
  return apiGet<ModulFreigaben>(`/api/einsaetze/${id}/module-access`);
}

/** Sichtbarkeit + benötigte Rolle eines Moduls überschreiben; nur Einsatzleitung/Admin, aktiver Einsatz. */
export function setzeModulOverride(
  id: number,
  modulKey: string,
  update: ModulOverrideUpdate,
): Promise<ModulOverride> {
  return apiSend<ModulOverride>(`/api/einsaetze/${id}/module-overrides/${modulKey}`, 'PUT', update);
}
