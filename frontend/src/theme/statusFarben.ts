import type { GlobalToken } from 'antd';
import {
  etbTypFarbenDunkel,
  etbTypFarbenHell,
  fachebeneFarbenDunkel,
  fachebeneFarbenHell,
  farbenDunkel,
  farbenHell,
  warnstufeFarbenDunkel,
  warnstufeFarbenHell,
  type EtbTypFarbe,
  type EtbTypTon,
  type FachebeneTon,
  type WarnstufeBalken,
  type sichtungsfarben,
} from './tokens';
import type {
  AbloesungEinstufung,
  AbschnittLagezustand,
  AufbewahrungZustand,
  BelegungsArt,
  BetreuungsstelleStatus,
  Ausmass,
  BrStatus,
  Dienststatus,
  EinsatzStatus,
  EtbTyp,
  MaterialStatus,
  PersonStatus,
  Raeumungszustand,
  SchadenStatus,
  Sichtungskategorie,
  StatusKategorie,
  UhsStatus,
  UhsTyp,
  Verfuegbarkeit,
  Warnstufe,
  WetterWarnstufe,
} from '../api/types';
import type {
  FachebeneQuelle,
  HochwasserKlasse,
  LuftqualitaetKlasse,
  OdlStufe,
} from '../api/fachebenen';

/**
 * Statusfarb-Vertrag (LFH-328 · A2): EINE Quelle für „welche Bedeutung hat welche Statusfarbe“.
 *
 * DIESE DATEI TRÄGT KEINEN FARBWERT. Sie bildet Domänen-Enums auf **Rollen** ab
 * (`alarm`/`achtung`/`normal`/`neutral`/`bedien`/`marke`); die Werte stehen ausschließlich in
 * `tokens.ts` bzw. `rollen.css`. {@link rollenFarbe} ist die einzige Übersetzung Rolle →
 * Farbwert und liest den aktiven Modus aus dem antd-Token.
 *
 * JEDER EINTRAG TRÄGT EINEN ZWEITEN KANAL: `label` ist Pflichtfeld (WCAG 1.4.1).
 * `Record<Enum, StatusDarstellung>` bricht zusätzlich bei einer neuen Enum-Variante den
 * Typcheck.
 *
 * ── DIE GRENZE DES VERTRAGS ──
 *
 * Für Fahrzeug- und Personalstatus kommt die Farbe aus der DATENBANK: `status_farbe` ist
 * mandantengepflegter Freitext, den das Backend nur trimmt (kein Enum, kein Format-Check). Dieser
 * Vertrag deckt nur die Fallback-Achse ({@link statusKategorie}); die DB-Achse bleibt draußen.
 * Ebenfalls draußen: Farb-/Label-Maps anderer Achsen (`kommunikation/phase.ts`, `TierePage`,
 * `clusterDonut.ts`, `taktischesZeichen.ts` u. a.). Sichtung ist ein eigener Vertrag: eine
 * fachliche Farbkennzeichnung, keine A0-Statusrolle.
 *
 * ── DRITTE DARSTELLUNGSSORTE: FLÄCHE ──
 *
 * {@link warnstufeFlaeche} bildet Stufen auf die Füllungsrollen aus `tokens.ts` ab,
 * {@link flaechenFarbe} löst sie je Modus auf. Eigener Typ ({@link Flaechendarstellung}), weil
 * eine Füllung keine {@link Statusrolle} ist. Wer eine VIERTE Sorte braucht, benennt sie hier.
 *
 * ── MODUSPALETTEN OHNE ROLLE ──
 *
 * {@link etbTypFarbe}, {@link warnstufeBalkenFarbe} und {@link fachebeneFarbe} (LFH-593) lösen je
 * Modus aus eigenen Paletten in `tokens.ts` auf. Die Ebenenfarbe ist eine Identität, kein Status;
 * sie steht hier, damit sie wie alles Übrige den Modus wechselt, nicht als Vertragskarte.
 *
 * `theme/statusVertrag.guard.test.ts` hält die Grenzen maschinell: keine
 * `Record<…, StatusDarstellung>` außerhalb DIESER DATEI (nicht bloß des Verzeichnisses) und kein
 * `<Tag color={…}>`, das ein Vertrags-Enum einfärbt (dafür `components/StatusTag.tsx`). Die
 * blinden Flecken stehen im Kopf des Guards.
 */

/** Eine A0-Statusrolle. Farbwerte stehen ausschließlich in `tokens.ts`/`rollen.css`. */
export type Statusrolle = 'alarm' | 'achtung' | 'normal' | 'neutral' | 'bedien' | 'marke';

/** Zweiter Kanal ist Pflicht (WCAG 1.4.1): `label` trägt ihn immer, `form` optional zusätzlich. */
export interface StatusDarstellung {
  rolle: Statusrolle;
  /** Pflicht — nie weglassbar. Der Text IST der zweite Kanal. */
  label: string;
  form?: 'dreieck' | 'kreis' | 'balken';
}

/**
 * Status eines Einsatzes. Zuordnung nach A0-Spec §6, Prüflistenzeile 7
 * (`aktiv` → `normal`, `abgeschlossen` → `neutral`).
 */
export const einsatzStatus: Record<EinsatzStatus, StatusDarstellung> = {
  // Großgeschrieben, weil es eine BESCHRIFTUNG ist: der Wire-Wert als Label erfüllte den
  // zweiten Kanal nur formal.
  aktiv: { rolle: 'normal', label: 'Aktiv' },
  abgeschlossen: { rolle: 'neutral', label: 'Abgeschlossen' },
};

/**
 * Lagezustand eines Einsatzabschnitts (LFH-608), die Kante der Abschnittszeile im
 * Führungs-Überblick. „Nicht beurteilt“ hat KEINEN Eintrag: das Feld ist dann leer, eine
 * Neutralstufe behauptete eine Beurteilung. Das Blau der UHS-Zeile im Entwurf ist Bedienrolle,
 * keine Lagestufe.
 */
export const abschnittLagezustand: Record<AbschnittLagezustand, StatusDarstellung> = {
  planmaessig: { rolle: 'normal', label: 'planmäßig' },
  angespannt: { rolle: 'achtung', label: 'angespannt' },
  kritisch: { rolle: 'alarm', label: 'kritisch' },
};

/** Registrierung/Fallbearbeitung, unabhängig von der medizinischen Sichtung.
 * Abgemeldet ist keine medizinische Entwarnung; verstorben kein Alarm wie SK I. */
export const personStatus: Record<PersonStatus, StatusDarstellung> = {
  erfasst: { label: 'erfasst', rolle: 'neutral' },
  vermisst: { label: 'vermisst', rolle: 'achtung' },
  betroffen: { label: 'betroffen', rolle: 'neutral' },
  verstorben: { label: 'verstorben', rolle: 'neutral' },
  abgemeldet: { label: 'abgemeldet', rolle: 'neutral' },
};

/** Übergabe ist eine aktive Beziehung, wie Material im Einsatz oder UHS-Zuordnung. */
export const schadenStatus: Record<SchadenStatus, StatusDarstellung> = {
  offen: { label: 'offen', rolle: 'achtung' },
  uebergeben: { label: 'übergeben', rolle: 'bedien' },
  abgeschlossen: { label: 'abgeschlossen', rolle: 'neutral' },
};

export const schadenAusmass: Record<Ausmass, StatusDarstellung> = {
  gering: { label: 'gering', rolle: 'neutral' },
  mittel: { label: 'mittel', rolle: 'achtung' },
  gross: { label: 'groß', rolle: 'achtung' },
  katastrophal: { label: 'katastrophal', rolle: 'alarm' },
};

/** Ein Datensatzbezug, kein Betriebsstatus der referenzierten Entität. */
export function bezugsDarstellung(label: string): StatusDarstellung {
  return { label, rolle: 'bedien' };
}

interface SichtungsDarstellung {
  label: string;
  farbe: keyof typeof sichtungsfarben | null;
}

/** Eigene fachliche Farbsprache: SK IV/blau ist eine ausdrücklich benannte Ausnahme
 * zur blauen Bedien-/Beziehungsrolle. Schwarz kennzeichnet Tote; es färbt nie Text.
 * Die Labels bleiben der unabhängige zweite Kanal. */
export const sichtung: Record<Sichtungskategorie, SichtungsDarstellung> = {
  sk1: { label: 'SK I', farbe: 'rot' },
  sk2: { label: 'SK II', farbe: 'gelb' },
  sk3: { label: 'SK III', farbe: 'gruen' },
  sk4: { label: 'SK IV', farbe: 'blau' },
  tot: { label: 'tot', farbe: 'schwarz' },
  unverletzt: { label: 'unverletzt', farbe: null },
};

/** Kräfte-Statuskategorie (Fallback-Achse für Fahrzeug- und Personalstatus). */
export const statusKategorie: Record<StatusKategorie, StatusDarstellung> = {
  verfuegbar: { rolle: 'normal', label: 'verfügbar' },
  gebunden: { rolle: 'achtung', label: 'gebunden' },
  nicht_verfuegbar: { rolle: 'alarm', label: 'nicht verfügbar' },
};

/** Verfügbarkeit eines UHS-Platzes. `gesperrt` ist `neutral`, nicht `alarm`: ein bewusster
 *  Zustand, keine Gefahr. */
export const verfuegbarkeit: Record<Verfuegbarkeit, StatusDarstellung> = {
  frei: { rolle: 'normal', label: 'frei' },
  defekt: { rolle: 'alarm', label: 'defekt' },
  aufbereitung: { rolle: 'achtung', label: 'in Aufbereitung' },
  gesperrt: { rolle: 'neutral', label: 'gesperrt' },
  reserviert: { rolle: 'bedien', label: 'reserviert' },
};

/**
 * ETB-Eintragstyp als ETIKETT (`StatusTag`) und Quelle des Wortlauts (`label`).
 *
 * Die Zeitachse zeigt den Typ als farbige KANTE plus TYPWORT; diese Farbe liefert
 * {@link etbTypFarbe} aus einer eigenen Palette, weil ein Eintragstyp eine Kategorie ist und
 * keine Dringlichkeit. Die Rollen hier gelten nur für die Etikett-Darstellung.
 */
export const etbTyp: Record<EtbTyp, StatusDarstellung> = {
  meldung: { rolle: 'bedien', label: 'Meldung' },
  anordnung: { rolle: 'achtung', label: 'Anordnung' },
  lage: { rolle: 'neutral', label: 'Lage' },
  entscheidung: { rolle: 'neutral', label: 'Entscheidung' },
  system: { rolle: 'neutral', label: 'System' },
  berichtigung: { rolle: 'alarm', label: 'Berichtigung' },
};

/** Status einer Unfallhilfsstelle. */
export const uhsStatus: Record<UhsStatus, StatusDarstellung> = {
  geplant: { rolle: 'neutral', label: 'geplant' },
  aktiv: { rolle: 'normal', label: 'aktiv' },
  aufgeloest: { rolle: 'alarm', label: 'aufgelöst' },
};

/** Typ einer Unfallhilfsstelle: eine Kategorie, keine Lage, deshalb durchgängig `neutral`;
 *  unterschieden wird über den Text und das taktische Zeichen. */
export const uhsTyp: Record<UhsTyp, StatusDarstellung> = {
  patientenablage: { rolle: 'neutral', label: 'Patientenablage' },
  behandlungsplatz: { rolle: 'neutral', label: 'Behandlungsplatz' },
  verletztensammelstelle: { rolle: 'neutral', label: 'Verletztensammelstelle' },
  sonstige: { rolle: 'neutral', label: 'Sonstige' },
};

/**
 * Status eines Einsatzmaterials. `im_einsatz` ist `bedien`: die Rolle steht in dieser Datei
 * schon für aktive Beziehungen (`verfuegbarkeit.reserviert`, `belegungsArt.wechsel`,
 * `etbTyp.meldung`). `defekt` und `verbraucht` teilen sich `alarm`, unterschieden über `label`.
 * `pages/MaterialPage.tsx` und `pages/uhs/MaterialTab.tsx` lesen beide von hier.
 */
export const materialStatus: Record<MaterialStatus, StatusDarstellung> = {
  einsatzbereit: { rolle: 'normal', label: 'einsatzbereit' },
  im_einsatz: { rolle: 'bedien', label: 'im Einsatz' },
  defekt: { rolle: 'alarm', label: 'defekt' },
  verbraucht: { rolle: 'alarm', label: 'verbraucht' },
  desinfektion_noetig: { rolle: 'achtung', label: 'Desinfektion nötig' },
};

/**
 * Dienststatus eines Stammdatums (Fahrzeug, Personal, Material, LFH-476). `ausser_dienst` ist
 * `neutral`, nicht `alarm`: bewusst aus dem Bestand genommen, keine Gefahr — wie
 * `verfuegbarkeit.gesperrt`. `stammdaten/dienststatus.tsx` liest Wort und Rolle für alle drei
 * Katalog-Tabs von hier, auch den Wortlaut der Filterwerte.
 */
export const dienststatus: Record<Dienststatus, StatusDarstellung> = {
  in_dienst: { rolle: 'normal', label: 'in Dienst' },
  ausser_dienst: { rolle: 'neutral', label: 'außer Dienst' },
};

/** Status eines Bereitstellungsraums. */
export const brStatus: Record<BrStatus, StatusDarstellung> = {
  geplant: { rolle: 'neutral', label: 'geplant' },
  aktiv: { rolle: 'normal', label: 'aktiv' },
  aufgeloest: { rolle: 'alarm', label: 'aufgelöst' },
};

/** Bewegungsart einer UHS-Belegung. */
export const belegungsArt: Record<BelegungsArt, StatusDarstellung> = {
  eintritt: { rolle: 'normal', label: 'Eintritt' },
  wechsel: { rolle: 'bedien', label: 'Wechsel' },
  austritt: { rolle: 'achtung', label: 'Austritt' },
};

/**
 * Warnstufe als **Objektsignatur auf der Karte**.
 *
 * `keine` ist bewusst `alarm`: ein Gefahrengebiet ohne gesetzte Warnstufe wird vorsichtshalber
 * als Gefahr dargestellt. Die Gegenlesart steht als {@link warnstufeKennzahl} daneben.
 *
 * Fünf Stufen auf zwei Rollen (`niedrig`/`mittel` → `achtung`, `keine`/`hoch`/`akut` →
 * `alarm`); die Farbe unterscheidet also nur zwei. Der tragende zweite Kanal auf der Karte ist
 * der TEXT: `pages/lagekarte/zonenStil.ts:zonenBeschriftung` liest `label` von hier. Wer ein
 * Wort ändert, ändert die Kartenbeschriftung mit. `form` bleibt ungesetzt: es trägt nur drei
 * Zeichen für fünf Stufen.
 */
export const warnstufeKarte: Record<Warnstufe, StatusDarstellung> = {
  keine: { rolle: 'alarm', label: 'keine' },
  niedrig: { rolle: 'achtung', label: 'niedrig' },
  mittel: { rolle: 'achtung', label: 'mittel' },
  hoch: { rolle: 'alarm', label: 'hoch' },
  akut: { rolle: 'alarm', label: 'akut' },
};

/**
 * Warnstufe als **Kennzahl im Lagebild**.
 *
 * `keine` ist hier `normal`, im Widerspruch zu {@link warnstufeKarte} mit Absicht: die Karte
 * zeigt ein Objekt (unbewertet ⇒ vorsichtshalber Gefahr), das Dashboard eine Kennzahl (nichts
 * gemeldet ⇒ kein Alarmbeitrag). Die Werte sind kopiert, weil `theme/` nicht von `pages/`
 * abhängen darf.
 */
export const warnstufeKennzahl: Record<Warnstufe, StatusDarstellung> = {
  keine: { rolle: 'normal', label: 'keine' },
  niedrig: { rolle: 'normal', label: 'niedrig' },
  mittel: { rolle: 'achtung', label: 'mittel' },
  hoch: { rolle: 'alarm', label: 'hoch' },
  akut: { rolle: 'alarm', label: 'akut' },
};

/**
 * Hochwasserklasse eines LHP-Pegels auf der Lagekarte (LFH-77).
 *
 * Vier Meldeklassen auf zwei Rollen: `klein`/`mittel` → `achtung`, `gross`/`sehr_gross` →
 * `alarm`. „Ohne Daten“ und „unklassifiziert“ sind beide `neutral` (das Portal malt sie grau
 * bzw. blau, Blau ist hier aber `bedien`); unterschieden über `label`.
 *
 * Zweiter Kanal auf der Karte ist der Punktdurchmesser (`pages/lagekarte/hochwasserStil.ts`),
 * im Inspector das Wort. Die Staffelung über die vier Klassen ist eine eigene: das Portal
 * trennt nur gemeldet von nicht gemeldet.
 */
export const hochwasserKlasse: Record<HochwasserKlasse, StatusDarstellung> = {
  keine_daten: { rolle: 'neutral', label: 'keine Daten' },
  unklassifiziert: { rolle: 'neutral', label: 'ohne Meldeklassen' },
  kein_hochwasser: { rolle: 'normal', label: 'kein Hochwasser' },
  klein: { rolle: 'achtung', label: 'kleines Hochwasser' },
  mittel: { rolle: 'achtung', label: 'mittleres Hochwasser' },
  gross: { rolle: 'alarm', label: 'großes Hochwasser' },
  sehr_gross: { rolle: 'alarm', label: 'sehr großes Hochwasser' },
};

/**
 * Stufe des UBA-Luftqualitätsindex einer Messstation auf der Lagekarte (LFH-79).
 *
 * `sehr_gut`/`gut` → `normal`; `maessig` → `achtung` (das UBA schließt ab „mäßig“ Wirkungen bei
 * Langzeitexposition nicht mehr aus); `schlecht`/`sehr_schlecht` → `alarm`. `keine_daten` ist
 * `neutral`, nicht „gute Luft“. Zweiter Kanal: Punktdurchmesser
 * (`pages/lagekarte/luftqualitaetStil.ts`), im Inspector das Wort.
 */
export const luftqualitaetIndex: Record<LuftqualitaetKlasse, StatusDarstellung> = {
  keine_daten: { rolle: 'neutral', label: 'keine Daten' },
  sehr_gut: { rolle: 'normal', label: 'sehr gut' },
  gut: { rolle: 'normal', label: 'gut' },
  maessig: { rolle: 'achtung', label: 'mäßig' },
  schlecht: { rolle: 'alarm', label: 'schlecht' },
  sehr_schlecht: { rolle: 'alarm', label: 'sehr schlecht' },
};

/**
 * Bewertungsstufe einer ODL-Sonde des BfS auf der Lagekarte (LFH-78).
 *
 * Die Stufen sind eine Projekt-Einteilung, keine BfS-Schwelle: relativ zum Grundpegel der
 * Sonde oder, solange keiner vorliegt, nach absoluten Bändern. Die Labels nennen deshalb keinen
 * Maßstab (den nennt der Inspector) und beschreiben eine Auffälligkeit, keine Gefährdung; Regen
 * hebt Werte kurzzeitig bis Faktor 3. Zweiter Kanal: Punktdurchmesser (`pages/lagekarte/odlStil.ts`).
 */
export const odlStufe: Record<OdlStufe, StatusDarstellung> = {
  keine_messung: { rolle: 'neutral', label: 'keine Messung' },
  normal: { rolle: 'normal', label: 'unauffällig' },
  erhoeht: { rolle: 'achtung', label: 'erhöht' },
  stark_erhoeht: { rolle: 'alarm', label: 'stark erhöht' },
};

/**
 * Einstufung einer laufenden Ablösungsschicht (LFH-635). Drei Stufen (EEMUA 191: ≤ 3
 * Eskalationsstufen). „planmäßig“ ist `neutral`, nicht `normal`: es ist der Ruhezustand der
 * Liste, kein hervorzuhebender Gutzustand. Die Uhrzeit der Fälligkeit steht immer daneben.
 */
export const abloesungEinstufung: Record<AbloesungEinstufung, StatusDarstellung> = {
  planmaessig: { rolle: 'neutral', label: 'planmäßig' },
  vorwarnung: { rolle: 'achtung', label: 'Ablösung bald fällig' },
  ueberfaellig: { rolle: 'alarm', label: 'überfällig' },
};

/**
 * Deckung eines Verpflegungszeitfensters (LFH-634). Die Einstufung rechnet
 * `verpflegung/deckung.ts` im Client gegen die Uhr, das Backend liefert nur die Fehlmenge.
 * „offen“ ist `neutral`: eine Fehlmenge vor Beginn ist Planungsstand. „Unterdeckung“ gilt erst
 * nach Beginn und ist `alarm`.
 */
export type VerpflegungDeckung = 'gedeckt' | 'offen' | 'unterdeckung';

/**
 * Aufbewahrungszustand eines abgeschlossenen Einsatzes (LFH-23). Erscheint in Übersicht und
 * Akte. `faellig` und `vorgemerkt` teilen sich `achtung` (nur während `vorgemerkt` ist
 * Wiederherstellen möglich); `schwaerzung_ausstehend` ist `alarm`, weil dort jede Rücknahme
 * verloren ist. Kein `bedien`: Wiederherstellen ist eine Aktion, kein Zustand.
 */
export const aufbewahrungZustand: Record<AufbewahrungZustand, StatusDarstellung> = {
  ohne_frist: { rolle: 'neutral', label: 'ohne Frist' },
  frist_laeuft: { rolle: 'neutral', label: 'Frist läuft' },
  faellig: { rolle: 'achtung', label: 'fällig' },
  vorgemerkt: { rolle: 'achtung', label: 'zur Löschung vorgemerkt' },
  schwaerzung_ausstehend: { rolle: 'alarm', label: 'Schwärzung steht aus' },
  geschwaerzt: { rolle: 'neutral', label: 'geschwärzt' },
};

export const verpflegungDeckung: Record<VerpflegungDeckung, StatusDarstellung> = {
  gedeckt: { rolle: 'normal', label: 'gedeckt' },
  offen: { rolle: 'neutral', label: 'offen' },
  unterdeckung: { rolle: 'alarm', label: 'Unterdeckung' },
};

/**
 * Räumungszustand eines Evakuierungsbezirks (LFH-639). „angeordnet“ und „läuft“ teilen sich
 * `achtung`; „geräumt“ ist der Sollzustand (`normal`), „aufgehoben“ ist beendet (`neutral`) und
 * zählt in der Kennzahl nicht mehr mit. Kein `bedien`: das ist eine Beziehung, kein Zustand.
 */
export const raeumungszustand: Record<Raeumungszustand, StatusDarstellung> = {
  angeordnet: { rolle: 'achtung', label: 'angeordnet' },
  laeuft: { rolle: 'achtung', label: 'läuft' },
  geraeumt: { rolle: 'normal', label: 'geräumt' },
  aufgehoben: { rolle: 'neutral', label: 'aufgehoben' },
};

/**
 * Betriebsstatus einer Betreuungsstelle (LFH-639). Wie `uhsStatus`, aber „geschlossen“ ist
 * `neutral`: eine Stelle lässt sich wieder öffnen, ein umkehrbarer Zustand ist kein Alarm. Die
 * ART der Stelle ist eine Kategorie und bekommt keine Karte.
 */
export const betreuungsstelleStatus: Record<BetreuungsstelleStatus, StatusDarstellung> = {
  vorbereitet: { rolle: 'neutral', label: 'vorbereitet' },
  in_betrieb: { rolle: 'normal', label: 'in Betrieb' },
  geschlossen: { rolle: 'neutral', label: 'geschlossen' },
};

/**
 * Auslastung einer Betreuungsstelle (LFH-639), eine BERECHNETE Einstufung. Deshalb eine
 * Funktion: der Abdeckungstest leitet die Vertragskarten aus den Objekt-Exporten ab.
 *
 *  - Keine Kapazität, keine Meldung oder unter 90 % → `null` (ohne Wort keine Farbe).
 *  - Ab 90 % `achtung` „fast voll“, genau 100 % `alarm` „voll“, darüber `alarm`
 *    „überbelegt“ (Überbelegung ist erlaubt).
 *
 * Verglichen wird ganzzahlig (`belegt · 10 ≥ kapazität · 9`), damit an der Kante kein
 * Gleitkomma-Quotient entscheidet.
 */
export function auslastung(
  belegt: number | null | undefined,
  kapazitaet: number | null | undefined,
): StatusDarstellung | null {
  if (belegt == null || kapazitaet == null || kapazitaet < 1) return null;
  if (belegt > kapazitaet) return { rolle: 'alarm', label: 'überbelegt' };
  if (belegt === kapazitaet) return { rolle: 'alarm', label: 'voll' };
  if (belegt * 10 >= kapazitaet * 9) return { rolle: 'achtung', label: 'fast voll' };
  return null;
}

/**
 * Amtliche DWD-Warnstufe einer Wetterwarnung am Einsatzort (LFH-633).
 * `gering`/`maessig` → `achtung`, `schwer`/`extrem` → `alarm`, unterschieden über die amtlichen
 * Bezeichnungen in `label`. `gering` ist nicht `neutral` (eine Warnung ist kein Ruhezustand),
 * und keine Stufe ist Blau (`bedien`).
 */
export const dwdWarnstufe: Record<WetterWarnstufe, StatusDarstellung> = {
  gering: { rolle: 'achtung', label: 'Wetterwarnung' },
  maessig: { rolle: 'achtung', label: 'Markantes Wetter' },
  schwer: { rolle: 'alarm', label: 'Unwetterwarnung' },
  extrem: { rolle: 'alarm', label: 'Extremes Unwetter' },
};

/**
 * Die drei Rollen, die eine Kennzahl **stufen** können, als VERENGUNG von {@link Statusrolle}.
 * `Extract<>` statt einer zweiten Literalliste, damit eine Umbenennung im Vertrag die
 * Konsumenten im Typcheck bricht. Drei, weil {@link dringlichkeit} je Stufe ein Formzeichen
 * trägt und es kein viertes gibt.
 */
type Dringlichkeit = Extract<Statusrolle, 'alarm' | 'achtung' | 'normal'>;

/**
 * Der ZWEITE KANAL des Dringlichkeitsmarkers (LFH-395, WCAG 1.4.1).
 *
 * Die einzige Karte, deren Schlüssel eine {@link Statusrolle} statt eines Domänen-Enums ist:
 * sie beschriftet die Stufe selbst. `label` benennt die STUFE, nicht ihren Anlass, weil dieselbe
 * Stufe an Auftrags- und Meldungszeile aus verschiedenen Anlässen entsteht.
 */
export const dringlichkeit: Record<Dringlichkeit, StatusDarstellung> = {
  alarm: { rolle: 'alarm', label: 'dringend', form: 'dreieck' },
  achtung: { rolle: 'achtung', label: 'erhöht', form: 'balken' },
  normal: { rolle: 'normal', label: 'normal', form: 'kreis' },
};

/**
 * Übersetzt eine Rolle in den Farbwert des aktiven Modus.
 *
 * Vier Rollen liegen als antd-Token vor (`antdToken()` leitet sie ab); `neutral` ist der
 * gedämpfte Grauwert aus antds Textskala. `marke` kennt antd nicht und darf NICHT auf
 * `colorError` ausweichen, sonst trüge `alarm` Gefahr UND Ortssignatur; der Wert kommt direkt aus
 * den Rollen.
 *
 * Den Modus erkennt {@link istDunklerModus} über die Helligkeit von `colorBgBase`, nicht über
 * einen Vergleich mit Rollenwerten: der `darkAlgorithm` rechnet Seed-Tokens um. Ein fremdes
 * Theme (z. B. blanker `ConfigProvider` im Test) landet im Hellmodus, statt zu werfen.
 */
export function rollenFarbe(rolle: Statusrolle, token: GlobalToken): string {
  switch (rolle) {
    case 'alarm':
      return token.colorError;
    case 'achtung':
      return token.colorWarning;
    case 'normal':
      return token.colorSuccess;
    case 'bedien':
      return token.colorPrimary;
    case 'neutral':
      return token.colorTextTertiary;
    case 'marke':
      return (istDunklerModus(token) ? farbenDunkel : farbenHell).marke;
  }
}

/** antd hat keinen Modus-Token; die Helligkeit der Basisfläche ist das einzige Signal,
 *  das ohne zweiten Provider auskommt und den Algorithmus-Umbau der Seeds übersteht. */
function istDunklerModus(token: GlobalToken): boolean {
  const kurz = token.colorBgBase.trim().replace('#', '');
  const hex = kurz.length === 3 ? [...kurz].map((z) => z + z).join('') : kurz;
  if (hex.length < 6) return false;
  const wert = Number.parseInt(hex.slice(0, 6), 16);
  if (Number.isNaN(wert)) return false;
  // Relative Helligkeit nach ITU-R BT.709 — dieselbe Gewichtung, die WCAG 1.4.3 nutzt.
  const helligkeit =
    0.2126 * ((wert >> 16) & 255) + 0.7152 * ((wert >> 8) & 255) + 0.0722 * (wert & 255);
  return helligkeit < 128;
}

/** Eine Flächen-Füllungsrolle. Bewusst enger als `keyof Farbrollen`: `markeGlut` ist
 *  ein Schatten, keine Fläche, und `text` schon gar nicht. */
type Fuellungsrolle =
  | 'achtungFuellung'
  | 'achtungFuellungStark'
  | 'alarmFuellung'
  | 'alarmFuellungStark'
  | 'normalFuellung';

/**
 * Die dritte Darstellungssorte: eine FLÄCHE, kein Etikett. Eigener Typ, weil eine Füllung keine
 * {@link Statusrolle} ist und `rollenFarbe` sie nicht auflösen kann.
 */
interface Flaechendarstellung {
  /** `null` = keine Fläche. Kein `'transparent'` als Rollenname — das ist ein Wert. */
  fuellung: Fuellungsrolle | null;
  /** Pflicht, zweiter Kanal (WCAG 1.4.1). */
  label: string;
  /** Ein Zeichen für die Zelle, in der der volle Text nicht steht. Zweiter Kanal dort. */
  kuerzel: string;
}

/**
 * Warnstufe als **Fläche der Gefahrenmatrix**. Fünf Stufen über die INTENSITÄT derselben Rolle
 * plus {@link Flaechendarstellung.kuerzel}, ohne sechste Farbe.
 *
 * `keine` ist leer und NICHT `alarm` wie auf der Karte: hier heißt die Stufe ausdrücklich „für
 * dieses Schutzobjekt besteht keine Gefahr“, und eine Matrix voller roter Zellen zeigte nichts an.
 */
export const warnstufeFlaeche: Record<Warnstufe, Flaechendarstellung> = {
  keine: { fuellung: null, label: 'keine', kuerzel: '–' },
  niedrig: { fuellung: 'achtungFuellung', label: 'niedrig', kuerzel: 'N' },
  mittel: { fuellung: 'achtungFuellungStark', label: 'mittel', kuerzel: 'M' },
  hoch: { fuellung: 'alarmFuellung', label: 'hoch', kuerzel: 'H' },
  akut: { fuellung: 'alarmFuellungStark', label: 'akut', kuerzel: 'A' },
};

/**
 * Fläche → Farbwert des aktiven Modus. Wie der `marke`-Zweig in {@link rollenFarbe}: für
 * Füllungsrollen gibt es keinen antd-Token, der Modus kommt über {@link istDunklerModus}.
 */
export function flaechenFarbe(w: Warnstufe, token: GlobalToken): string {
  const rolle = warnstufeFlaeche[w].fuellung;
  if (rolle === null) return 'transparent';
  return (istDunklerModus(token) ? farbenDunkel : farbenHell)[rolle];
}

/**
 * ETB-Typfarbe des aktiven Modus: Kante (2 px) und Typwort. Nur Farbe; der Wortlaut kommt aus
 * {@link etbTyp}. Modus wie bei {@link flaechenFarbe}. Exhaustiv über `EtbTyp`.
 */
const ETB_TYP_TON: Record<EtbTyp, EtbTypTon> = {
  meldung: 'meldung',
  anordnung: 'anordnung',
  entscheidung: 'entscheidung',
  lage: 'lage',
  berichtigung: 'berichtigung',
  system: 'system',
};

export function etbTypFarbe(typ: EtbTyp, token: GlobalToken): EtbTypFarbe {
  return (istDunklerModus(token) ? etbTypFarbenDunkel : etbTypFarbenHell)[ETB_TYP_TON[typ]];
}

/**
 * Balkenfarbe einer Warnstufe (Gefahrenmatrix) im aktiven Modus; `keine` hat keinen Balken.
 * Die Zellfläche bleibt {@link flaechenFarbe}.
 */
const WARNSTUFE_BALKEN: Record<Warnstufe, WarnstufeBalken | null> = {
  keine: null,
  niedrig: 'niedrig',
  mittel: 'mittel',
  hoch: 'hoch',
  akut: 'akut',
};

export function warnstufeBalkenFarbe(w: Warnstufe, token: GlobalToken): string | null {
  const stufe = WARNSTUFE_BALKEN[w];
  if (stufe === null) return null;
  return (istDunklerModus(token) ? warnstufeFarbenDunkel : warnstufeFarbenHell)[stufe];
}

/**
 * Ebenenfarbe einer Fachebene im aktiven Modus (LFH-593): Kartenpunkt, Panel-Quadrat,
 * Inspector-Akzent. Nur Farbe; der zweite Kanal ist der Ebenenname. Modus wie bei
 * {@link flaechenFarbe}. Exhaustiv über `FachebeneQuelle`.
 */
const FACHEBENE_TON: Record<FachebeneQuelle, FachebeneTon> = {
  nina: 'nina',
  dwd: 'dwd',
  pegelonline: 'pegelonline',
  hochwasser: 'hochwasser',
  luftqualitaet: 'luftqualitaet',
  odl: 'odl',
  autobahn: 'autobahn',
  kritis: 'kritis',
  energie: 'energie',
};

export function fachebeneFarbe(quelle: FachebeneQuelle, token: GlobalToken): string {
  return (istDunklerModus(token) ? fachebeneFarbenDunkel : fachebeneFarbenHell)[
    FACHEBENE_TON[quelle]
  ];
}
