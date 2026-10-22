/**
 * Quellenadapter des Vorschlagsfelds `components/StammdatenFeld.tsx` (LLH-1144, Spec
 * `stammdaten-feld`, Herleitung `/mnt/project-files/llh-1022/LLH-1144/design.md` D2/D4/D5).
 *
 * Jeder Adapter liefert eine `Vorschlagsquelle` (`{ id, gruppe, eintraege, uebernahme? }`); das
 * Feld kennt keine einzelne Quelle. Eine neue Quelle kommt hier dazu, ohne das Feld zu ändern.
 * Die reinen Abbildungen stehen getrennt von den Hooks, damit sie ohne Abruf zu prüfen sind.
 *
 * - `funkrufnamenEinsatz`: im Einsatz disponierte Fahrzeuge (Funkrufname, OPTA in Klammern) und
 *   Einheiten (vormals `etb/funkrufnamen.ts`), Gruppe „Im Einsatz“.
 * - `sachgebieteEinsatz`: die Sachgebiete mit Besetzung (LFH-545/549), eingesetzt wird das Kürzel.
 * - `fahrzeugeStammdaten`: Funkrufnamen der Fahrzeuge im Dienst, Demo hinten. Ohne Übernahme: eine
 *   fremde Gegenstelle ist kein eigenes Fahrzeug (D4).
 * - `externeStellen`: Katalog „Externe Stellen“ (LFH-1194), Bezeichnung und Funkrufname; Übernahme
 *   legt eine Stelle der Art „Sonstige“ an.
 * - `zuletztVerwendet`: am Gerät gemerkte Werte, Gruppe „Zuletzt verwendet“ (`GERAETESPEICHER`).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { EXTERNE_STELLE_BEZEICHNUNG_MAX } from '../api/eingabegrenzen';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { createExterneStelle } from '../api/externeStellen';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzFahrzeug, Einheit, ExterneStelle, Fahrzeug } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import type { Vorschlag, Vorschlagsquelle } from '../components/stammdatenFeldKern';
import {
  etbStabVorschlaege,
  KEINE_VORSCHLAEGE,
  type FunktionsVorschlaege,
} from '../fuehrung/funktionsOptionenKern';
import { useExterneStellen } from './externeStellenVorschlaege';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { KONTEXT_FUNKRUFNAME, useZuletztQuelle } from './zuletztVerwendet';

export {
  KONTEXT_FUNKRUFNAME,
  ladeZuletzt,
  merkeZuletzt,
  useZuletztQuelle,
  ZULETZT_MAX,
  zuletztRaeumen,
} from './zuletztVerwendet';

// ─── Einsatz ────────────────────────────────────────────────────────────────────────────────────

/** Funkrufname wie im Einsatz und in den Stammdaten gleich geschrieben, damit Doppel zusammenfallen. */
function funkrufnameMitOpta(f: { funkrufname: string; opta?: string | null }): string {
  return f.opta ? `${f.funkrufname} (${f.opta})` : f.funkrufname;
}

/** Disponierte Fahrzeuge und Einheiten, ohne Doppel, alphabetisch (de). */
export function funkrufnamenAusEinsatz(
  fahrzeuge: readonly EinsatzFahrzeug[],
  einheiten: readonly Einheit[],
): Vorschlag[] {
  const namen = new Map<string, Vorschlag>();
  for (const f of fahrzeuge) {
    const name = funkrufnameMitOpta(f);
    if (!namen.has(name))
      namen.set(name, { label: name, wert: name, ...(f.ist_demo ? { demo: true } : {}) });
  }
  for (const e of einheiten) {
    if (!namen.has(e.name)) namen.set(e.name, { label: e.name, wert: e.name });
  }
  return [...namen.values()].sort((a, b) => a.wert.localeCompare(b.wert, 'de'));
}

/** Die Funkrufnamen des Einsatzes (disponierte Fahrzeuge + Einheiten). */
export function useFunkrufnamenEinsatz(einsatzId: number, aktiv = true): Vorschlag[] {
  const fahrzeuge = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: aktiv,
  });
  const einheiten = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: aktiv,
  });
  return useMemo(
    () => funkrufnamenAusEinsatz(fahrzeuge.data ?? [], einheiten.data ?? []),
    [fahrzeuge.data, einheiten.data],
  );
}

/** Sachgebiete mit Besetzung im Label, übernommen wird das Kürzel (LFH-549). */
export function sachgebieteAusStab(funktionen: FunktionsVorschlaege): Vorschlag[] {
  return etbStabVorschlaege(funktionen).map((o) => ({ label: o.label, wert: o.value }));
}

// ─── Stammdaten ─────────────────────────────────────────────────────────────────────────────────

export function fahrzeugeAlsVorschlaege(fahrzeuge: readonly Fahrzeug[]): Vorschlag[] {
  return fahrzeuge.map((f) => {
    const name = funkrufnameMitOpta(f);
    return {
      label: name,
      wert: name,
      ref: { quelle: 'fahrzeugeStammdaten', id: f.id },
      ...(f.ist_demo ? { demo: true } : {}),
    };
  });
}

export function useFahrzeugeStammdatenQuelle(aktiv = true): Vorschlagsquelle {
  const { data } = useQuery({
    queryKey: globalKeys.fahrzeugeListe('im-dienst'),
    queryFn: () => listeFahrzeuge(true),
    enabled: aktiv,
  });
  return useMemo(
    () => ({
      id: 'fahrzeugeStammdaten',
      gruppe: 'stammdaten',
      eintraege: fahrzeugeAlsVorschlaege(data ?? []),
    }),
    [data],
  );
}

export function externeStellenAlsVorschlaege(stellen: readonly ExterneStelle[]): Vorschlag[] {
  return stellen
    .filter((s) => s.aktiv)
    .flatMap((s) => {
      const ref = { quelle: 'externeStellen', id: s.id };
      const eintraege: Vorschlag[] = [{ label: s.bezeichnung, wert: s.bezeichnung, ref }];
      const frn = s.funkrufname?.trim();
      if (frn) eintraege.push({ label: `${frn} · ${s.bezeichnung}`, wert: frn, ref });
      return eintraege;
    });
}

/**
 * Katalog „Externe Stellen“. Mit `uebernahme` legt „In Stammdaten übernehmen“ eine Stelle der
 * Art „Sonstige“ an (D4; umstellen in der Verwaltung). Recht wie die Stammdaten-Seiten
 * (`system_rolle === 'admin'`, Server `AdminUser`), sonst gesperrt mit ihrem Grund.
 */
export function useExterneStellenQuelle({
  uebernahme,
  aktiv = true,
}: {
  uebernahme: boolean;
  aktiv?: boolean;
}): Vorschlagsquelle {
  const { data } = useExterneStellen(aktiv);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const istAdmin = benutzer?.system_rolle === 'admin';
  return useMemo(
    () => ({
      id: 'externeStellen',
      gruppe: 'stammdaten',
      eintraege: externeStellenAlsVorschlaege(data ?? []),
      ...(uebernahme
        ? {
            uebernahme: {
              ziel: 'Externe Stellen',
              maxLaenge: EXTERNE_STELLE_BEZEICHNUNG_MAX,
              gesperrt: istAdmin ? null : STAMMDATEN_RECHTE_TEXT,
              anlegen: async (text: string) => {
                const neu = await createExterneStelle({ bezeichnung: text, art: 'sonstige' });
                await qc.invalidateQueries({ queryKey: globalKeys.externeStellen() });
                return neu;
              },
            },
          }
        : {}),
    }),
    [data, uebernahme, istAdmin, qc],
  );
}

// ─── Zusammenstellung ───────────────────────────────────────────────────────────────────────────

/**
 * Die Quellen für Funkrufname/Stelle (ETB Von/An, Meldung Absender/Empfänger): Einsatz
 * (Fahrzeuge, Einheiten, Sachgebiete), Stammdaten (Fahrzeuge, externe Stellen), zuletzt verwendet.
 * `uebernahme` nur, wo „In Stammdaten übernehmen“ Platz und Sinn hat (D4: nicht im ETB). `aktiv`
 * aus: nichts abrufen (Formular zugeklappt).
 */
export function useFunkrufnamenQuellen({
  einsatzId,
  funktionen = KEINE_VORSCHLAEGE,
  uebernahme,
  aktiv = true,
}: {
  einsatzId: number;
  funktionen?: FunktionsVorschlaege;
  uebernahme: boolean;
  aktiv?: boolean;
}): Vorschlagsquelle[] {
  const funkrufnamen = useFunkrufnamenEinsatz(einsatzId, aktiv);
  const fahrzeuge = useFahrzeugeStammdatenQuelle(aktiv);
  const stellen = useExterneStellenQuelle({ uebernahme, aktiv });
  const zuletzt = useZuletztQuelle(KONTEXT_FUNKRUFNAME);
  return useMemo(
    () => [
      { id: 'funkrufnamenEinsatz', gruppe: 'einsatz', eintraege: funkrufnamen },
      { id: 'sachgebieteEinsatz', gruppe: 'einsatz', eintraege: sachgebieteAusStab(funktionen) },
      fahrzeuge,
      stellen,
      zuletzt,
    ],
    [funkrufnamen, funktionen, fahrzeuge, stellen, zuletzt],
  );
}
