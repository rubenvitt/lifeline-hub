import { useCallback, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { einsatzIdAusPfad } from '../command-palette/einsatzPfad';
import { modulAusPfad } from './modulRegistry';
import { merkeModulBesuch } from './zuletztModule';

/**
 * Verdrahtet eine Seite mit Modulzielen (Führung · Überblick, Lage-Dashboard) mit dem
 * „Zuletzt"-Speicher (LFH-436, Zugangstabelle in `zuletztModule.ts`).
 *
 * - `beiLinkKlick` kommt als `onClickCapture` an die SEITENWURZEL: jeder `<a href>` darunter
 *   merkt sein Modul, auch ein künftig ergänzter. Ein Prop je Kennzahl vergäße der nächste Link
 *   still. Strg/⌘-Klick zählt mit, die Wahl ist dieselbe.
 * - `waehle` ersetzt `navigate` an Knöpfen, die in ein Modul führen; die sieht der Fänger nicht.
 *
 * Nur auf diesen Seiten, nicht layoutweit: ein Querverweis in einem Modulinhalt folgt einem
 * Datensatz, keiner Modulwahl. Der Einsatz kommt aus dem ZIEL, nicht aus der aktuellen Route.
 */
export function useModulWahl() {
  const { benutzer } = useAuth();
  const benutzerId = benutzer?.id ?? null;
  const navigate = useNavigate();

  const merkeZiel = useCallback(
    (pfad: string) => {
      // Die Registry zerlegt nur den Pfad; Query und Fragment gehören nicht zum Segment.
      const pathname = pfad.split(/[?#]/)[0];
      const einsatzId = einsatzIdAusPfad(pathname);
      const modul = modulAusPfad(pathname);
      if (benutzerId == null || einsatzId == null || !modul) return;
      merkeModulBesuch(benutzerId, einsatzId, modul.key);
    },
    [benutzerId],
  );

  /** Merken VOR dem Navigieren, wie am Modulklick des Rahmens. */
  const waehle = useCallback(
    (pfad: string) => {
      merkeZiel(pfad);
      navigate(pfad);
    },
    [merkeZiel, navigate],
  );

  const beiLinkKlick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const anker = (e.target as Element | null)?.closest?.('a[href]');
      if (!anker) return;
      // `getAttribute` statt `.href`: der rohe Wert ist der App-Pfad, `.href` hängt die Origin an.
      const href = anker.getAttribute('href');
      if (href) merkeZiel(href);
    },
    [merkeZiel],
  );

  return { merkeZiel, waehle, beiLinkKlick };
}
