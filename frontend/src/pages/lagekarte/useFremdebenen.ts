import { useCallback, useMemo, useState } from 'react';
import { theme } from 'antd';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  aktualisiereFremdebene,
  ladeFremdebeneDaten,
  listeFremdebenen,
  loescheFremdebene,
  type Fremdebene,
} from '../../api/fremdebenen';
import { einsatzKeys } from '../../api/queryKeys';
import { sicherLesen, sicherSchreiben } from '../../lib/sichererSpeicher';
import { fremdebeneFarbe } from '../../theme/statusFarben';
import type { AktiveFremdebene } from './fremdebenenLayer';

/**
 * Fremdebenen-Leg der Lagekarte (LLH-2099, Entwurf „Oberfläche“): Liste, Sichtbarkeit je
 * Arbeitsplatz, Daten der sichtbaren Ebenen und die Schreibwege des ⋮ (Umbenennen, Farbe,
 * Entfernen). Das Anlegen hängt die Seite über `einsatzKeys.fremdebenen` an dieselbe Liste.
 */

/** Takt einer sichtbaren URL-Ebene: der Server holt beim Lesen nach (bedingt, mit ETag). */
const URL_TAKT_MS = 60_000;

/**
 * Speicherort der ausgeblendeten Ebenen, je Einsatz (`<schluessel>:<einsatzId>`, `GERAETESPEICHER`).
 * Gemerkt wird, was aus ist: eine neue Ebene ist sichtbar, ohne dass jemand sie einschaltet.
 */
export const FREMDEBENEN_SICHT_SCHLUESSEL = 'lfh:lagekarte:fremdebenen-aus';

const sichtSchluessel = (einsatzId: number) => `${FREMDEBENEN_SICHT_SCHLUESSEL}:${einsatzId}`;

/** Die ausgeblendeten Ebenen dieses Arbeitsplatzes; ein kaputter Eintrag zählt als leer. */
export function leseAusgeblendet(einsatzId: number): Set<number> {
  const roh = sicherLesen(sichtSchluessel(einsatzId));
  if (!roh) return new Set();
  try {
    const gelesen: unknown = JSON.parse(roh);
    if (!Array.isArray(gelesen)) return new Set();
    return new Set(gelesen.filter((x): x is number => Number.isInteger(x)));
  } catch {
    return new Set();
  }
}

export function schreibeAusgeblendet(einsatzId: number, ids: ReadonlySet<number>): void {
  sicherSchreiben(sichtSchluessel(einsatzId), JSON.stringify([...ids].sort((a, b) => a - b)));
}

/**
 * Abruftakt der Daten einer Ebene: nur eine sichtbare URL-Ebene in einem sichtbaren Tab; eine
 * Datei-Ebene ändert sich nur über die Liste (Live-Kanal).
 */
export function fremdebeneTakt(
  ebene: Pick<Fremdebene, 'source'>,
  sichtbar: boolean,
): number | false {
  if (ebene.source !== 'url' || !sichtbar) return false;
  return document.visibilityState === 'visible' ? URL_TAKT_MS : false;
}

interface FremdebenenOptionen {
  /** Aus im gesicherten Stand (Snapshot): der kennt keine Fremdebenen. Vorgabe an. */
  aktiv?: boolean;
}

export function useFremdebenen(einsatzId: number, { aktiv = true }: FremdebenenOptionen = {}) {
  const qc = useQueryClient();
  const { token } = theme.useToken();
  // Gemerkt je Einsatz; ein Einsatzwechsel liest den Stand des neuen beim Rendern nach.
  const [sicht, setSicht] = useState(() => ({
    einsatzId,
    aus: leseAusgeblendet(einsatzId),
  }));
  if (sicht.einsatzId !== einsatzId) setSicht({ einsatzId, aus: leseAusgeblendet(einsatzId) });
  const ausgeblendet = sicht.einsatzId === einsatzId ? sicht.aus : leseAusgeblendet(einsatzId);

  const liste = useQuery({
    queryKey: einsatzKeys.fremdebenen(einsatzId),
    queryFn: () => listeFremdebenen(einsatzId),
    enabled: aktiv,
    // Alter und Abruffehler einer URL-Ebene stehen in der Liste; sie läuft im Takt ihrer Daten mit.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((e) => fremdebeneTakt(e, !ausgeblendet.has(e.id)) !== false)
        ? URL_TAKT_MS
        : false,
  });
  const ebenen = useMemo(() => (aktiv ? (liste.data ?? []) : []), [aktiv, liste.data]);

  const sichtbar = useMemo(
    () => new Set(ebenen.filter((e) => !ausgeblendet.has(e.id)).map((e) => e.id)),
    [ebenen, ausgeblendet],
  );

  const toggle = useCallback((id: number) => {
    setSicht((alt) => {
      const aus = new Set(alt.aus);
      if (aus.has(id)) aus.delete(id);
      else aus.add(id);
      schreibeAusgeblendet(alt.einsatzId, aus);
      return { ...alt, aus };
    });
  }, []);

  const daten = useQueries({
    queries: ebenen.map((e) => ({
      queryKey: einsatzKeys.fremdebeneDaten(einsatzId, e.id),
      queryFn: () => ladeFremdebeneDaten(einsatzId, e.id),
      enabled: sichtbar.has(e.id),
      refetchInterval: () => fremdebeneTakt(e, sichtbar.has(e.id)),
    })),
  });
  // Stabil über Renders: die Karte spielt nur bei neuem Inhalt Daten ein (LFH-945).
  const datenStand = daten.map((d) => d.dataUpdatedAt).join(',');
  // Der Modus als Wert: ein Wechsel Tag ↔ Nacht färbt die Ebenen um.
  const modusMarke = fremdebeneFarbe('fremd-1', token);
  const aktive = useMemo<AktiveFremdebene[]>(
    () =>
      ebenen.flatMap((e, i) => {
        const fc = daten[i]?.data;
        return sichtbar.has(e.id) && fc
          ? [{ id: e.id, name: e.name, daten: fc, farbe: fremdebeneFarbe(e.color, token) }]
          : [];
      }),
    // `daten` und `token` stehen über `datenStand` und `modusMarke` in den Deps.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [ebenen, sichtbar, datenStand, modusMarke],
  );

  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.fremdebenen(einsatzId) });
  const aendern = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; color?: string } }) =>
      aktualisiereFremdebene(einsatzId, id, patch),
    onSettled: invalidiere,
  });
  const entfernen = useMutation({
    mutationFn: (id: number) => loescheFremdebene(einsatzId, id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: einsatzKeys.fremdebeneDaten(einsatzId, id) });
    },
    onSettled: invalidiere,
  });

  return {
    /** Alle Ebenen des Einsatzes (leer im gesicherten Stand). */
    ebenen,
    /** IDs der Ebenen, die dieser Arbeitsplatz zeigt. */
    sichtbar,
    toggle,
    /** Sichtbare Ebenen mit Daten, für Karte und Legende. */
    aktive,
    /** Die Ebene einer ID (Detailkarte). */
    finde: (id: number) => ebenen.find((e) => e.id === id),
    umbenennen: (id: number, name: string) => aendern.mutate({ id, patch: { name } }),
    setzeFarbe: (id: number, color: string) => aendern.mutate({ id, patch: { color } }),
    entfernen: (id: number) => entfernen.mutate(id),
    /** Letzte Ablehnung eines Schreibwegs, für den Hinweis in der Gruppe. */
    fehler: aendern.error ?? entfernen.error ?? null,
    /** Fehler der Liste, für den Fehler-Slot der Gruppe. */
    listenFehler: liste.error,
    neuLaden: () => void liste.refetch(),
  };
}

export type FremdebenenStand = ReturnType<typeof useFremdebenen>;
