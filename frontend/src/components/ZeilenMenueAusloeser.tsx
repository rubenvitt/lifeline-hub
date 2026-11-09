/**
 * ⋮ einer Zeile aus ihrer Beschreibung (LLH-1599, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/lor2qhep-kontextmenue-tabellen/design.md` D2/D3).
 *
 * Dieselbe Beschreibung (`WeitereAktionen`) speist das Kontextmenü der Zeile
 * (`KatalogTabelle.zeilenMenue`, `useDatensatzKontextMenue`); so zeigen ⋮ und Kontextmenü dieselben
 * Einträge aus einer Quelle. `laeuft` sperrt den Auslöser und zeigt sich an ihm, wie im Kartenfuß
 * der `Datensicht` (LFH-654).
 */
import type { WeitereAktionen } from './Datensicht';
import { MenueAusloeser } from './MenueAusloeser';

export interface ZeilenMenueAusloeserProps<T> {
  menue: WeitereAktionen<T>;
  zeile: T;
  onOffenAenderung?: (offen: boolean) => void;
}

export function ZeilenMenueAusloeser<T>({
  menue,
  zeile,
  onOffenAenderung,
}: ZeilenMenueAusloeserProps<T>) {
  const laeuft = menue.laeuft?.(zeile) ?? false;
  return (
    <MenueAusloeser
      eintraege={menue.eintraege(zeile)}
      zugaenglicherName={menue.zugaenglicherName(zeile)}
      gesperrt={laeuft}
      laeuft={laeuft}
      onWahl={(key) => menue.onWahl(key, zeile)}
      {...(onOffenAenderung ? { onOffenAenderung } : {})}
    />
  );
}
