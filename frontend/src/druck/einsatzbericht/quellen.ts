import type { BenutzerAnzeige, ModulOverrides } from '../../api/types';
import { istModulGesperrt, istModulSichtbar, modulRegistry } from '../../einsatz/modulRegistry';

/**
 * Einsatzbericht (LFH-726): woraus der Bericht schöpft und ob er es abrufen darf
 * (`openspec/changes/lfh-726-einsatzbericht/design.md` D3).
 *
 * Die Weiche fällt VOR dem Abruf: ein im Einsatz ausgeblendetes Modul ist „nicht genutzt“ und
 * sperrt den Druck nicht, ein für die Rolle gesperrtes Modul sperrt ihn. Am Server sähen beide
 * gleich aus (403), deshalb unterscheidet sie der Client über die Overrides. Der Server bleibt
 * Türsteher: ein 403 trotz `abrufen` (Org-Vorgabe, Aufbewahrungsfrist) wertet der Abruf als
 * „kein Zugriff“, nie als leeren Bestand.
 */

export type BlockSchluessel =
  'stammdaten' | 'zeiten' | 'fuehrung' | 'kraefte' | 'lage' | 'bilanz' | 'etb';

/** Die Blöcke in fester Reihenfolge (Spec `einsatzbericht`, „Blöcke in fester Reihenfolge“). */
export const BLOECKE: readonly { schluessel: BlockSchluessel; titel: string }[] = [
  { schluessel: 'stammdaten', titel: 'Stammdaten' },
  { schluessel: 'zeiten', titel: 'Zeiten' },
  { schluessel: 'fuehrung', titel: 'Führung' },
  { schluessel: 'kraefte', titel: 'Kräfte' },
  { schluessel: 'lage', titel: 'Lage' },
  { schluessel: 'bilanz', titel: 'Bilanz' },
  { schluessel: 'etb', titel: 'ETB-Auszug' },
];

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
  block: BlockSchluessel;
  /** Modul-Key des Server-Gates; `null` = kein Modul-Gate (nur Lesezugriff auf den Einsatz). */
  modul: string | null;
}

/**
 * Block → Quelle → Modul. Hinter jeder Zeile steht das Gate der Route im Backend; weicht es ab,
 * zeigte der Bericht ein gesperrtes Modul als lesbar an (der Server wiese es mit 403 ab).
 */
export const QUELLEN: readonly Quelle[] = [
  // GET /api/einsaetze/{id} — `EinsatzLesezugriff` ohne Modul (src/routes/einsatz.rs:113).
  { schluessel: 'einsatz', block: 'stammdaten', modul: null },
  // GET …/mitglieder — `EinsatzLesezugriff` ohne Modul (src/routes/einsatz.rs:622).
  { schluessel: 'mitglieder', block: 'fuehrung', modul: null },
  // GET …/stab — `EinsatzLesezugriff<Stab>` (src/routes/stab.rs:122).
  { schluessel: 'stab', block: 'fuehrung', modul: 'stab' },
  // GET …/stab/lagebesprechungen — `EinsatzLesezugriff<Stab>` (src/routes/stab.rs:192).
  { schluessel: 'lagebesprechungen', block: 'fuehrung', modul: 'stab' },
  // GET …/einheiten — `EinsatzLesezugriff<Einheiten>` (src/routes/einsatz_einheit.rs:44).
  { schluessel: 'einheiten', block: 'kraefte', modul: 'einheiten' },
  // GET …/einheiten/zeitachse — `EinsatzLesezugriff<Einheiten>` (src/routes/zeitachse.rs:176).
  { schluessel: 'einheitenPerioden', block: 'kraefte', modul: 'einheiten' },
  // GET …/personal — `EinsatzLesezugriff<Personal>` (src/routes/einsatz_personal.rs:46).
  { schluessel: 'personal', block: 'kraefte', modul: 'personal' },
  // GET …/personal/zeitachse — `EinsatzLesezugriff<Personal>` (src/routes/zeitachse.rs:237).
  { schluessel: 'personalPerioden', block: 'kraefte', modul: 'personal' },
  // GET …/fahrzeuge — `EinsatzLesezugriff<Fahrzeuge>` (src/routes/einsatz_fahrzeug.rs:30).
  { schluessel: 'fahrzeuge', block: 'kraefte', modul: 'fahrzeuge' },
  // GET …/lageberichte — `fordere_lesen` mit `MODUL_KEY = "lageberichte"`
  // (src/routes/lagebericht.rs:20/30, src/routes/vorlagendokument.rs:39).
  { schluessel: 'lageberichte', block: 'lage', modul: 'lageberichte' },
  // GET …/personen — `EinsatzLesezugriff<Personen>` (src/routes/einsatz_person.rs:99).
  { schluessel: 'personen', block: 'bilanz', modul: 'personen' },
  // GET …/schaeden — `EinsatzLesezugriff<Schaeden>` (src/routes/einsatz_schaden.rs:45).
  { schluessel: 'schaeden', block: 'bilanz', modul: 'schaeden' },
  // GET …/betreuung — `EinsatzLesezugriff<Betreuung>` (src/routes/betreuung.rs:132).
  { schluessel: 'betreuung', block: 'bilanz', modul: 'betreuung' },
  // GET …/verpflegung — `EinsatzLesezugriff<Verpflegung>` (src/routes/verpflegung.rs:66).
  { schluessel: 'verpflegung', block: 'bilanz', modul: 'verpflegung' },
  // GET …/etb/zaehler — `EinsatzLesezugriff<Etb>` (src/routes/etb.rs:360).
  { schluessel: 'etbZaehler', block: 'etb', modul: 'etb' },
  // GET …/etb?typ=entscheidung — `EinsatzLesezugriff<Etb>` (src/routes/etb.rs:304).
  { schluessel: 'etbEntscheidungen', block: 'etb', modul: 'etb' },
];

export type QuellenFreigabe = 'abrufen' | 'gesperrt' | 'nicht-genutzt';

export interface BerichtFreigabe {
  je: Record<QuellenSchluessel, QuellenFreigabe>;
  /** Anzeigenamen der gesperrten Module, je Modul einmal, in Reihenfolge der Quellen. */
  gesperrteModule: string[];
}

/** Zustand einer Quelle aus den Overrides; ausgeblendet geht vor gesperrt. */
function freigabeDerQuelle(
  quelle: Quelle,
  benutzer: BenutzerAnzeige | null,
  overrides: ModulOverrides,
): QuellenFreigabe {
  if (quelle.modul == null) return 'abrufen';
  const modul = modulRegistry.find((m) => m.key === quelle.modul);
  // Ein unbekannter Key ist ein Programmierfehler (Test „nur Modul-Keys der Registry“); im
  // Betrieb fail-closed.
  if (!modul) return 'gesperrt';
  if (!istModulSichtbar(modul, overrides)) return 'nicht-genutzt';
  if (istModulGesperrt(modul, benutzer, overrides)) return 'gesperrt';
  return 'abrufen';
}

export function berichtFreigabe(
  benutzer: BenutzerAnzeige | null,
  overrides: ModulOverrides,
): BerichtFreigabe {
  const je = {} as Record<QuellenSchluessel, QuellenFreigabe>;
  const gesperrteModule: string[] = [];
  for (const quelle of QUELLEN) {
    const zustand = freigabeDerQuelle(quelle, benutzer, overrides);
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
