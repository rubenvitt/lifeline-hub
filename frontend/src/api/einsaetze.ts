import type {
  Fuehrungsfunktion,
  Einsatzart,
  EinsatzAnzeige,
  EinsatzRolle,
  MitgliedAnzeige,
  EinsatzEinstellungen,
  EinstellungenUpdate,
  ModulOverride,
  ModulFreigaben,
  ModulOverrides,
  ModulOverrideUpdate,
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
}

export function legeEinsatzAn(daten: NeuerEinsatz): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>('/api/einsaetze', 'POST', daten);
}

export function schliesseEinsatzAb(id: number): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}/abschliessen`, 'POST');
}

export function ladeMitglieder(id: number): Promise<MitgliedAnzeige[]> {
  return apiGet<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder`);
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
  return apiSend<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder/${benutzerId}`, 'PUT', {
    einsatz_rolle: rolle,
    ...(stelle ?? {}),
  });
}

export function entferneMitglied(id: number, benutzerId: number): Promise<MitgliedAnzeige[]> {
  return apiSend<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder/${benutzerId}`, 'DELETE');
}

/** Editierbare Kopffelder (Vollersatz beim atomaren Speichern). */
export interface KopfdatenUpdate {
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
  /** Expliziter UTC-Termin; null löscht die optionale Angabe. */
  naechste_lagebesprechung_at?: string | null;
}

export function aktualisiereEinsatz(id: number, felder: KopfdatenUpdate): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}`, 'PATCH', felder);
}

/**
 * Teil der Kopfdaten (LFH-472): fehlender Schlüssel = unverändert, `null` = leeren — so liest der
 * Server den Body (`routes/einsatz.rs:KopfdatenPatch`, Tri-State seit LFH-306).
 */
export type KopfdatenPatch = Partial<KopfdatenUpdate>;

/**
 * Einzelfeld-Weg der Zeilenbearbeitung (LFH-472). Er schickt nur die übergebenen Schlüssel: ein
 * mitgeschicktes fremdes Feld aus einem älteren Seitenstand überschriebe die gleichzeitige
 * Änderung einer anderen Person.
 */
export function patcheEinsatz(id: number, patch: KopfdatenPatch): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}`, 'PATCH', patch);
}

/** Einsatz-Einstellungen laden (LFH-131); existiert keine Zeile → Defaults (alle null). */
export function ladeEinstellungen(id: number): Promise<EinsatzEinstellungen> {
  return apiGet<EinsatzEinstellungen>(`/api/einsaetze/${id}/einstellungen`);
}

/** Einsatz-Einstellungen setzen (Vollersatz); nur bei aktivem Einsatz (sonst 409). */
export function speichereEinstellungen(
  id: number,
  felder: EinstellungenUpdate,
): Promise<EinsatzEinstellungen> {
  return apiSend<EinsatzEinstellungen>(`/api/einsaetze/${id}/einstellungen`, 'PUT', felder);
}

/** Modul-Overrides eines Einsatzes laden (LFH-132); Map modul_key→Override (leer = Defaults). */
export function ladeModulOverrides(id: number): Promise<ModulOverrides> {
  return apiGet<ModulOverrides>(`/api/einsaetze/${id}/modul-overrides`);
}

/**
 * Effektive Modulfreigaben des angemeldeten Benutzers (LFH-669): je Modul-Key
 * `{ sichtbar, zugriff }`, ausgewertet vom Server mit derselben Regel wie die Modul-Gates.
 */
export function ladeModulFreigaben(id: number): Promise<ModulFreigaben> {
  return apiGet<ModulFreigaben>(`/api/einsaetze/${id}/modul-freigaben`);
}

/** Sichtbarkeit + benötigte Rolle eines Moduls überschreiben; nur Einsatzleitung/Admin, aktiver Einsatz. */
export function setzeModulOverride(
  id: number,
  modulKey: string,
  update: ModulOverrideUpdate,
): Promise<ModulOverride> {
  return apiSend<ModulOverride>(`/api/einsaetze/${id}/modul-overrides/${modulKey}`, 'PUT', update);
}
