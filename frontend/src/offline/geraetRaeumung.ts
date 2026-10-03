/**
 * Personenbezogene Daten auf dem Gerät (LFH-767, Spec `geraetedaten-raeumung`). Herleitung:
 * `openspec/changes/archive/2026-10-02-lfh-767-geraet-raeumung-abmelden/design.md`.
 *
 * Grundsatz: Was der Server wieder liefern kann, geht bei jedem Ausgang. Was nur auf diesem
 * Gerät liegt (ETB-Entwürfe), überlebt einen unfreiwilligen Ausgang, an die Person gebunden und
 * befristet. Die Offline-Queue bleibt immer, sie ist Beweissicherung.
 *
 * Einziger Aufrufer ist der `AuthProvider` (`auth/AuthContext.tsx`), wie beim Lagebild.
 */
import { ortCacheRaeumen } from '../anzeige/ortCache';
import { erfassungsSitzungRaeumen } from '../components/erfassungsSitzung';
import { entwuerfeAufraeumen, entwuerfeRaeumen } from '../etb/entwuerfe/entwurfStore';
import { personErfassungsQuittungenAufraeumen, personErfassungsQuittungenRaeumen } from './queue';

/**
 * - `jeder-ausgang`: beim Abmelden UND beim Sitzungsende (401) geräumt.
 * - `gebunden-befristet`: an `benutzer_id` gebunden; Abmelden und Benutzerwechsel räumen,
 *   ein Sitzungsende nicht; ohne angemeldeten Besitzer höchstens 24 h.
 * - `lagebild`: eigener Weg, `lagebildLoeschen` (LFH-723).
 * - `queue`: bleibt, Beweissicherung (LFH-705).
 * - `bleibt`: kein Personenbezug, bewusst stehen gelassen.
 */
export type GeraeteEntscheidung =
  'jeder-ausgang' | 'gebunden-befristet' | 'lagebild' | 'queue' | 'bleibt';

export interface GeraeteSpeicherort {
  /** DB-Name (samt Store) bzw. Schlüssel oder Schlüsselpräfix. */
  ort: string;
  /** Die schreibende Quelldatei, relativ zu `frontend/src/` — daran hängt der Guard. */
  datei: string;
  entscheidung: GeraeteEntscheidung;
  grund: string;
}

/** Vollständig gehalten von `geraetRaeumung.guard.test.ts`. */
export const GERAETESPEICHER: readonly GeraeteSpeicherort[] = [
  {
    ort: 'IndexedDB lifeline-lagebild',
    datei: 'offline/lagebildSpeicher.ts',
    entscheidung: 'lagebild',
    grund: 'Vorgehaltenes Lagebild; Löschen, Frist und Rechteentzug regelt LFH-723.',
  },
  {
    ort: 'IndexedDB lifeline-offline: ausstehend, abgelehnt, schreibaktionen, schreibaktionenAbgelehnt',
    datei: 'offline/queue.ts',
    entscheidung: 'queue',
    grund: 'Offline-Queue, an benutzer_id gebunden; Beweissicherung, wird nie automatisch geräumt.',
  },
  {
    ort: 'IndexedDB lifeline-offline: personErfassungsQuittungen',
    datei: 'offline/queue.ts',
    entscheidung: 'jeder-ausgang',
    grund:
      'Volle Person-Objekte; die Person liegt nach dem Replay auf dem Server, die Quittung ist nur der Hinweis darauf.',
  },
  {
    ort: 'IndexedDB lifeline-etb-entwuerfe; localStorage lifeline-etb-entwuerfe-ausstehend:<id>',
    datei: 'etb/entwuerfe/entwurfStore.ts',
    entscheidung: 'gebunden-befristet',
    grund:
      'Ungesendeter ETB-Text, nur auf diesem Gerät; ein Sitzungsablauf darf ihn nicht kosten (LFH-142).',
  },
  {
    ort: 'localStorage etb-entwurf-aktiv-<benutzer>-<einsatz>',
    datei: 'etb/entwuerfe/useEtbEntwuerfe.ts',
    entscheidung: 'gebunden-befristet',
    grund: 'Nur die id des aktiven Entwurfs, kein Personenbezug; geht beim Abmelden mit.',
  },
  {
    ort: 'IndexedDB lifeline-ortcache',
    datei: 'anzeige/ortCache.ts',
    entscheidung: 'jeder-ausgang',
    grund:
      'Verrät, welche Orte im Einsatz nachgeschlagen wurden; die Ortsvorschau des Servers füllt ihn wieder.',
  },
  {
    ort: 'sessionStorage lfh:erfassung:<einsatz>:<maske>:<feld>, lfh:erfassung:besitzer',
    datei: 'components/erfassungsSitzung.ts',
    entscheidung: 'jeder-ausgang',
    grund:
      'Letzter Antreff- bzw. Schadensort; ein zweiter Benutzer im selben Tab bekäme ihn sonst vorbelegt. Zusätzlich an benutzer_id gebunden, ein Benutzerwechsel ohne Abmelden räumt ihn (LFH-785).',
  },
  {
    ort: 'localStorage lfh:offline-quittung-signal',
    datei: 'offline/ereignisse.ts',
    entscheidung: 'bleibt',
    grund: 'Datenarmes Tab-Signal (Benutzer- und Einsatz-id), ohne Personendaten (LFH-688).',
  },
  {
    ort: 'localStorage lifeline-serveruhr',
    datei: 'offline/serveruhr.ts',
    entscheidung: 'bleibt',
    grund: 'Uhrversatz zum Server; eine Eigenschaft des Geräts, nicht der Person.',
  },
  {
    ort: 'localStorage lifeline-unwetter-gemeldet*',
    datei: 'wetter/unwetterGedaechtnis.ts',
    entscheidung: 'bleibt',
    grund: 'Kennungen öffentlicher DWD-Warnungen, damit ein Neuladen nicht erneut alarmiert.',
  },
  {
    ort: 'localStorage <praefix>:letzteAuswahl:<einsatz>',
    datei: 'components/direkteinstiegKern.ts',
    entscheidung: 'bleibt',
    grund: 'Nur die Datensatz-id der zuletzt geöffneten UHS bzw. des Bereitstellungsraums.',
  },
  {
    ort: 'localStorage lfh:nav:zuletzt:<benutzer>:<einsatz>',
    datei: 'einsatz/zuletztModule.ts',
    entscheidung: 'bleibt',
    grund: 'Modulnamen, schon je Benutzer getrennt; kein Inhalt aus dem Einsatz.',
  },
  {
    ort: 'localStorage lfh:nav:eingeklappt',
    datei: 'einsatz/navPersistenz.ts',
    entscheidung: 'bleibt',
    grund: 'Geräte-Einstellung (Navigation eingeklappt), ohne Personenbezug.',
  },
  {
    ort: 'localStorage lifeline-hub.theme, lifeline-hub.dichte, lifeline-hub.helligkeit',
    datei: 'theme/ThemeModeProvider.tsx',
    entscheidung: 'bleibt',
    grund: 'Geräte-Einstellung der Darstellung; der Fükw-Rechner behält sie über Personen hinweg.',
  },
  {
    ort: 'localStorage lifeline.koordinatensystem',
    datei: 'anzeige/koordinatenSystemStore.ts',
    entscheidung: 'bleibt',
    grund: 'Geräte-Einstellung des Koordinatensystems, ohne Personenbezug.',
  },
  {
    ort: 'localStorage lfh:alarm:mute',
    datei: 'alarm/alarmTon.ts',
    entscheidung: 'bleibt',
    grund: 'Geräte-Einstellung der Alarmtöne, ohne Personenbezug.',
  },
  {
    ort: 'localStorage lfh:lagekarte:paneele',
    datei: 'pages/lagekarte/KlappPaneel.tsx',
    entscheidung: 'bleibt',
    grund: 'Geräte-Einstellung der Lagekarte (Paneele offen/zu), ohne Personenbezug.',
  },
  {
    ort: 'localStorage lfh:lagekarte:zeitachse-eingeklappt',
    datei: 'pages/lagekarte/SnapshotLeiste.tsx',
    entscheidung: 'bleibt',
    grund: 'Geräte-Einstellung der Lagekarte (Zeitachse), ohne Personenbezug.',
  },
  {
    ort: 'localStorage lfh:lagekarte:leiste-offen:*',
    datei: 'pages/lagekarte/leistenWahl.ts',
    entscheidung: 'bleibt',
    grund: 'Geräte-Einstellung der Lagekarte (Leisten), ohne Personenbezug.',
  },
  {
    ort: 'localStorage lfh:lagekarte:zeichen-zuletzt',
    datei: 'pages/lagekarte/zuletztVerwendet.ts',
    entscheidung: 'bleibt',
    grund: 'Zuletzt gewählte taktische Zeichen (Katalog-Schlüssel), ohne Einsatzinhalt.',
  },
];

/** Freiwilliges Abmelden oder Sitzungsende (401) — nur das erste kostet die Entwürfe. */
export type AusgangsAnlass = 'abmelden' | 'sitzungsende';

/** Jeden Ort einzeln: ein Fehler (Kontingent, gesperrte Transaktion) darf die übrigen nicht
 *  stehen lassen und die Abmeldung nicht aufhalten. Was liegen bleibt, räumt der nächste Start
 *  als fremd oder abgelaufen nach (design.md D4). */
async function einzeln(schritte: Record<string, () => unknown>): Promise<void> {
  await Promise.all(
    Object.entries(schritte).map(async ([ort, schritt]) => {
      try {
        await schritt();
      } catch (e) {
        console.error(`Gerät räumen: ${ort} ließ sich nicht leeren`, e);
      }
    }),
  );
}

/**
 * Der Weg hinaus (LFH-767, design.md D2): läuft nach `lagebildLoeschen` in `abmeldenLokal`.
 * Was der Server wieder liefern kann, geht bei jedem Anlass; die ETB-Entwürfe nur beim
 * Abmelden. Wirft nie.
 */
export async function geraetRaeumen(anlass: AusgangsAnlass): Promise<void> {
  await einzeln({
    personErfassungsQuittungen: personErfassungsQuittungenRaeumen,
    ortCache: ortCacheRaeumen,
    erfassungsSitzung: erfassungsSitzungRaeumen,
    ...(anlass === 'abmelden' ? { etbEntwuerfe: entwuerfeRaeumen } : {}),
  });
}

/**
 * Nach Start und Anmeldung (LFH-767, design.md D4/D5): Mit bestätigter Person gehen fremde
 * Entwürfe und Quittungen; ohne Person nur, was länger als 24 h liegt. Wirft nie.
 */
export async function geraetFuerBenutzerRaeumen(
  benutzerId: number | null,
  jetzt: number = Date.now(),
): Promise<void> {
  await einzeln({
    etbEntwuerfe: () => entwuerfeAufraeumen(benutzerId, jetzt),
    personErfassungsQuittungen: () => personErfassungsQuittungenAufraeumen(benutzerId, jetzt),
  });
}
