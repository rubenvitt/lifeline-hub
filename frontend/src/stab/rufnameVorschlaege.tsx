import type { ReactNode } from 'react';
import type { EinsatzFahrzeug, Fahrzeug } from '../api/types';
import { monoStil, useRollen } from '../components/instrument';
import { DEMO_GRUPPE, DemoLabel, trenneDemo } from '../stammdaten/demoAuswahl';
import { istFuehrungsfahrzeug } from './fernmeldeskizze';

/**
 * Vorschläge für den Rufnamen der eigenen Führungsstelle aus vorhandenen Stammdaten (LFH-1187):
 * die Funkrufnamen der Führungsfahrzeuge. Freitext bleibt erlaubt; ein Vorschlag wird nie still
 * gesetzt.
 *
 * Reihenfolge der Gruppen: die der Führungsstelle zugeordneten Fahrzeuge (jede Fachaufgabe, die
 * Zuordnung ist selbst die Aussage, wie LFH-1106), dann die übrigen disponierten
 * Führungsfahrzeuge, dann die nicht disponierten der Organisation, deren Demo-Daten zuletzt
 * (`stammdaten/demoAuswahl.tsx`). Führungsfahrzeug heißt: Fachaufgabe Führung im Zeichen
 * (`istFuehrungsfahrzeug`, dieselbe Regel wie Lagekarte und Skizze).
 */

export const RUFNAME_GRUPPE = {
  fuehrungsstelle: 'Fahrzeuge der Führungsstelle',
  disponiert: 'Disponierte Führungsfahrzeuge',
  organisation: 'Führungsfahrzeuge der Organisation',
} as const;

export interface RufnameVorschlag {
  funkrufname: string;
  typ: string | null;
  istDemo: boolean;
}

export interface RufnameGruppe {
  titel: string;
  vorschlaege: RufnameVorschlag[];
}

export interface RufnameQuellen {
  /** Die der Führungsstelle zugeordneten Fahrzeuge (`fahrzeug_ids`). */
  fahrzeugIds: readonly number[];
  /**
   * Die disponierten Fahrzeuge des Einsatzes; `null` ohne Freigabe der Fahrzeuge oder ohne
   * Daten. Dann fehlen die ersten beiden Gruppen — abwesend, nicht als leer behauptet.
   */
  disponiert: readonly EinsatzFahrzeug[] | null;
  /** Die Fahrzeuge der Organisation; `null` ohne Lesezugriff oder ohne Daten: Gruppe 3 fehlt. */
  stamm: readonly Fahrzeug[] | null;
}

type MitRufname = Pick<Fahrzeug, 'funkrufname' | 'fahrzeugtyp' | 'ist_demo'>;

export function rufnameVorschlaege({
  fahrzeugIds,
  disponiert,
  stamm,
}: RufnameQuellen): RufnameGruppe[] {
  // Ein Funkrufname steht nur einmal da, in der ersten Gruppe, die ihn nennt.
  const gesehen = new Set<string>();
  const vorschlaege = (fahrzeuge: readonly MitRufname[]): RufnameVorschlag[] =>
    fahrzeuge.flatMap((f) => {
      const funkrufname = f.funkrufname.trim();
      if (funkrufname === '' || gesehen.has(funkrufname)) return [];
      gesehen.add(funkrufname);
      return [{ funkrufname, typ: f.fahrzeugtyp?.trim() || null, istDemo: f.ist_demo }];
    });

  const gruppen: RufnameGruppe[] = [];
  const gruppe = (titel: string, fahrzeuge: readonly MitRufname[]) => {
    const liste = vorschlaege(fahrzeuge);
    if (liste.length > 0) gruppen.push({ titel, vorschlaege: liste });
  };

  if (disponiert) {
    const zugeordnet = new Set(fahrzeugIds);
    gruppe(
      RUFNAME_GRUPPE.fuehrungsstelle,
      disponiert.filter((f) => zugeordnet.has(f.id)),
    );
    gruppe(
      RUFNAME_GRUPPE.disponiert,
      disponiert.filter((f) => !zugeordnet.has(f.id) && istFuehrungsfahrzeug(f)),
    );
  }
  if (stamm) {
    const imEinsatz = new Set((disponiert ?? []).map((f) => f.fahrzeug_id));
    const { echte, demo } = trenneDemo(
      stamm.filter((f) => !imEinsatz.has(f.id) && istFuehrungsfahrzeug(f)),
    );
    gruppe(RUFNAME_GRUPPE.organisation, echte);
    gruppe(DEMO_GRUPPE, demo);
  }
  return gruppen;
}

/**
 * Der Platzhalter bei leerem Rufnamen: trägt die Führungsstelle genau ein Fahrzeug, dessen
 * Funkrufname — nur gezeigt, nie gesetzt (kein Rückschluss ohne Bestätigung).
 */
export function rufnamePlatzhalter(
  fahrzeugIds: readonly number[],
  disponiert: readonly EinsatzFahrzeug[] | null,
): string | undefined {
  const zugeordnet = (disponiert ?? []).filter((f) => fahrzeugIds.includes(f.id));
  return zugeordnet.length === 1 ? zugeordnet[0].funkrufname.trim() || undefined : undefined;
}

export interface RufnameOption {
  value: string;
  label: ReactNode;
  /** Gefiltert wird nach Funkrufname und Typ; das Label ist ein ReactNode. */
  suche: string;
}

export interface RufnameOptionGruppe {
  label: string;
  title: string;
  options: RufnameOption[];
}

function VorschlagLabel({ vorschlag }: { vorschlag: RufnameVorschlag }) {
  const { token, rollen } = useRollen();
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: token.marginXS, minWidth: 0 }}>
      <span style={monoStil(13)}>{vorschlag.funkrufname}</span>
      {vorschlag.typ && <span style={{ color: rollen.text2 }}>{vorschlag.typ}</span>}
    </span>
  );
}

const suchtext = (t: string) => t.toLocaleLowerCase('de');

/** Die Gruppen als Optionen für antds `AutoComplete`. */
export function rufnameOptionen(gruppen: readonly RufnameGruppe[]): RufnameOptionGruppe[] {
  return gruppen.map(({ titel, vorschlaege }) => ({
    label: titel,
    title: titel,
    options: vorschlaege.map((v) => {
      const label = <VorschlagLabel vorschlag={v} />;
      return {
        value: v.funkrufname,
        label: v.istDemo ? <DemoLabel>{label}</DemoLabel> : label,
        suche: suchtext([v.funkrufname, v.typ].filter(Boolean).join(' ')),
      };
    }),
  }));
}

/**
 * Filter für `AutoComplete`: im Combobox-Modus filtert antd sonst gar nicht. Gruppen tragen kein
 * `suche` und fallen durch; rc-select prüft dann ihre Optionen einzeln.
 */
export function rufnameFilter(
  eingabe: string,
  option?: RufnameOption | RufnameOptionGruppe,
): boolean {
  return option != null && 'suche' in option && option.suche.includes(suchtext(eingabe.trim()));
}
