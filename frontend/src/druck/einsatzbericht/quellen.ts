import type { ModulFreigaben } from '../../api/types';
import { istModulSichtbar, modulRegistry } from '../../einsatz/modulRegistry';
import { BLOECKE, STANDARDUMFANG, type BlockSchluessel } from './auswahl';

/**
 * Einsatzbericht (LFH-726): woraus der Bericht schöpft und ob er es abrufen darf
 * (`openspec/changes/archive/2026-10-01-lfh-726-einsatzbericht/design.md` D3).
 *
 * Die Weiche fällt VOR dem Abruf: ein im Einsatz ausgeblendetes Modul ist „nicht genutzt“ und
 * sperrt den Druck nicht, ein Modul ohne Zugriff sperrt ihn. Am Server sähen beide gleich aus
 * (403), deshalb unterscheidet sie der Client über die Modulfreigaben, die der Server je Benutzer
 * ausrechnet (`GET …/modul-freigaben`, LFH-669: Override, Rolle UND Org-Vorgabe). Unbekannt gibt
 * nichts frei (Spec `modul-freigabe`). Der Server bleibt Türsteher: ein 403 trotz `abrufen`
 * (Aufbewahrungsfrist) wertet der Abruf als „kein Zugriff“, nie als leeren Bestand.
 *
 * Geprüft und abgerufen werden nur Quellen gewählter Blöcke (LFH-902, D3 in
 * `openspec/changes/archive/2026-10-05-lfh-902-einsatzbericht-bloecke-auswaehlen/design.md`):
 * „vollständig oder gar nicht“ gilt für die gewählte Menge.
 */

export { BLOECKE, type BlockSchluessel } from './auswahl';

export type QuellenSchluessel =
  | 'einsatz'
  | 'mitglieder'
  | 'stab'
  | 'lagebesprechungen'
  | 'einheiten'
  | 'einheitenPerioden'
  | 'personal'
  | 'personalPerioden'
  | 'fahrzeuge'
  | 'lageberichte'
  | 'personen'
  | 'schaeden'
  | 'betreuung'
  | 'verpflegung'
  | 'etbZaehler'
  | 'etbEntscheidungen';

export interface Quelle {
  schluessel: QuellenSchluessel;
  /** Die Blöcke, die aus der Quelle schöpfen; abgerufen wird sie, wenn einer gewählt ist. */
  bloecke: readonly BlockSchluessel[];
  /** Modul-Key des Server-Gates; `null` = kein Modul-Gate (nur Lesezugriff auf den Einsatz). */
  modul: string | null;
}

/**
 * Ein einzelner Block. Als Funktion statt `['etb']`: ein Array-Literal mit einem Modulnamen vorn
 * läse der Query-Key-Guard (`api/queryKeys.guard.test.ts`) als Inline-Key.
 */
const nur = (block: BlockSchluessel): readonly BlockSchluessel[] => [block];

/**
 * Block → Quelle → Modul. Hinter jeder Zeile steht das Gate der Route im Backend; weicht es ab,
 * zeigte der Bericht ein gesperrtes Modul als lesbar an (der Server wiese es mit 403 ab).
 */
export const QUELLEN: readonly Quelle[] = [
  // GET /api/einsaetze/{id} — `EinsatzLesezugriff` ohne Modul (src/routes/einsatz.rs:113).
  // Kopf, Stand und Abschluss des Einsatzes braucht jeder Block.
  { schluessel: 'einsatz', bloecke: BLOECKE.map((b) => b.schluessel), modul: null },
  // GET …/mitglieder — `EinsatzLesezugriff` ohne Modul (src/routes/einsatz.rs:622).
  { schluessel: 'mitglieder', bloecke: nur('fuehrung'), modul: null },
  // GET …/stab — `EinsatzLesezugriff<Stab>` (src/routes/stab.rs:122).
  { schluessel: 'stab', bloecke: nur('fuehrung'), modul: 'stab' },
  // GET …/stab/lagebesprechungen — `EinsatzLesezugriff<Stab>` (src/routes/stab.rs:192).
  { schluessel: 'lagebesprechungen', bloecke: nur('fuehrung'), modul: 'stab' },
  // GET …/einheiten — `EinsatzLesezugriff<Einheiten>` (src/routes/einsatz_einheit.rs:44).
  // Die Personal-Anlage liest daraus den Namen der Einheit je Kraft (LFH-902).
  {
    schluessel: 'einheiten',
    bloecke: ['kraefte', 'einheiten-zeiten', 'personal-kopf'],
    modul: 'einheiten',
  },
  // GET …/einheiten/zeitachse — `EinsatzLesezugriff<Einheiten>` (src/routes/zeitachse.rs:176).
  { schluessel: 'einheitenPerioden', bloecke: ['kraefte', 'einheiten-zeiten'], modul: 'einheiten' },
  // GET …/personal — `EinsatzLesezugriff<Personal>` (src/routes/einsatz_personal.rs:46).
  { schluessel: 'personal', bloecke: ['kraefte', 'personal-kopf'], modul: 'personal' },
  // GET …/personal/zeitachse — `EinsatzLesezugriff<Personal>` (src/routes/zeitachse.rs:237).
  { schluessel: 'personalPerioden', bloecke: ['kraefte', 'personal-kopf'], modul: 'personal' },
  // GET …/fahrzeuge — `EinsatzLesezugriff<Fahrzeuge>` (src/routes/einsatz_fahrzeug.rs:30).
  { schluessel: 'fahrzeuge', bloecke: nur('kraefte'), modul: 'fahrzeuge' },
  // GET …/lageberichte — `fordere_lesen` mit `MODUL_KEY = "lageberichte"`
  // (src/routes/lagebericht.rs:20/30, src/routes/vorlagendokument.rs:39).
  { schluessel: 'lageberichte', bloecke: nur('lage'), modul: 'lageberichte' },
  // GET …/personen — `EinsatzLesezugriff<Personen>` (src/routes/einsatz_person.rs:99).
  { schluessel: 'personen', bloecke: nur('bilanz'), modul: 'personen' },
  // GET …/schaeden — `EinsatzLesezugriff<Schaeden>` (src/routes/einsatz_schaden.rs:45).
  { schluessel: 'schaeden', bloecke: nur('bilanz'), modul: 'schaeden' },
  // GET …/betreuung — `EinsatzLesezugriff<Betreuung>` (src/routes/betreuung.rs:132).
  { schluessel: 'betreuung', bloecke: nur('bilanz'), modul: 'betreuung' },
  // GET …/verpflegung — `EinsatzLesezugriff<Verpflegung>` (src/routes/verpflegung.rs:66).
  { schluessel: 'verpflegung', bloecke: nur('bilanz'), modul: 'verpflegung' },
  // GET …/etb/zaehler — `EinsatzLesezugriff<Etb>` (src/routes/etb.rs:360).
  { schluessel: 'etbZaehler', bloecke: nur('etb'), modul: 'etb' },
  // GET …/etb?typ=entscheidung — `EinsatzLesezugriff<Etb>` (src/routes/etb.rs:304).
  { schluessel: 'etbEntscheidungen', bloecke: nur('etb'), modul: 'etb' },
];

/**
 * `nicht-gewaehlt`: kein gewählter Block schöpft aus der Quelle (LFH-902, design.md D3). Sie wird
 * weder geprüft noch abgerufen — wer die Bilanz abwählt, braucht kein Recht an Personen.
 */
export type QuellenFreigabe = 'abrufen' | 'gesperrt' | 'nicht-genutzt' | 'nicht-gewaehlt';

export interface BerichtFreigabe {
  je: Record<QuellenSchluessel, QuellenFreigabe>;
  /** Anzeigenamen der gesperrten Module, je Modul einmal, in Reihenfolge der Quellen. */
  gesperrteModule: string[];
}

/** Zustand einer Quelle aus den Modulfreigaben; ausgeblendet geht vor gesperrt. */
function freigabeDerQuelle(quelle: Quelle, freigaben: ModulFreigaben): QuellenFreigabe {
  if (quelle.modul == null) return 'abrufen';
  const modul = modulRegistry.find((m) => m.key === quelle.modul);
  // Ein unbekannter Key ist ein Programmierfehler (Test „nur Modul-Keys der Registry“); im
  // Betrieb fail-closed.
  if (!modul) return 'gesperrt';
  if (!istModulSichtbar(modul, freigaben)) return 'nicht-genutzt';
  // Nicht `istModulGesperrt`: das lässt Unbekanntes frei (gegen Flackern der Navigation). Vor einem
  // Abruf gilt fail-closed — ein fehlender Eintrag sperrt.
  if (freigaben[modul.key]?.zugriff !== true) return 'gesperrt';
  return 'abrufen';
}

export function berichtFreigabe(
  freigaben: ModulFreigaben,
  auswahl: readonly BlockSchluessel[] = STANDARDUMFANG,
): BerichtFreigabe {
  const je = {} as Record<QuellenSchluessel, QuellenFreigabe>;
  const gesperrteModule: string[] = [];
  for (const quelle of QUELLEN) {
    const zustand = quelle.bloecke.some((b) => auswahl.includes(b))
      ? freigabeDerQuelle(quelle, freigaben)
      : 'nicht-gewaehlt';
    je[quelle.schluessel] = zustand;
    if (zustand === 'gesperrt') {
      const label = modulLabel(quelle.modul);
      if (!gesperrteModule.includes(label)) gesperrteModule.push(label);
    }
  }
  return { je, gesperrteModule };
}

/** Anzeigename eines Moduls aus der Registry; ohne Treffer der Key selbst. */
export function modulLabel(key: string | null): string {
  if (key == null) return 'Einsatz';
  return modulRegistry.find((m) => m.key === key)?.label ?? key;
}
