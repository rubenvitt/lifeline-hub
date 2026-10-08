import type { AbschlussCursor } from '../api/meldungen';
import type { Medienkontakt, MedienkontaktKennzahlen } from '../api/types';
import { ApiError } from '../api/client';

/**
 * Attrappe der Presse-Log-Lesefunktionen aus `api/presse` für Seitentests (LFH-1075): Phasen,
 * Seiten, Kennzahlen und Einzelabruf werden aus EINER Vollliste abgeleitet, so wie der Server sie
 * aus der Tabelle liest. Tests setzen weiter nur die Vollliste (`ladeMedienkontakte`).
 */

type Quelle = (einsatzId: number) => Promise<Medienkontakt[]>;

/** Jüngster Eingang zuerst, bei gleichem Eingang die höhere Kennung. */
const nachEingang = (a: Medienkontakt, b: Medienkontakt) =>
  b.eingang_at.localeCompare(a.eingang_at) || b.id - a.id;

export const MEDIENKONTAKTE_SEITE_ATTRAPPE = 100;

export function presseLeseAttrappe(quelle: Quelle) {
  return {
    ladeOffeneMedienkontakte: async (einsatzId: number) =>
      (await quelle(einsatzId)).filter((k) => k.status === 'offen').sort(nachEingang),
    ladeErledigteMedienkontakte: async (
      einsatzId: number,
      vor?: AbschlussCursor,
      limit: number = MEDIENKONTAKTE_SEITE_ATTRAPPE,
    ) =>
      (await quelle(einsatzId))
        .filter((k) => k.status !== 'offen')
        .sort(nachEingang)
        .filter(
          (k) => !vor || k.eingang_at < vor.zeit || (k.eingang_at === vor.zeit && k.id < vor.id),
        )
        .slice(0, limit),
    /** Die Ableitung, die die Medienlage vor LFH-1075 im Client aus der Vollliste rechnete. */
    ladeMedienkontaktKennzahlen: async (einsatzId: number): Promise<MedienkontaktKennzahlen> => {
      const alle = await quelle(einsatzId);
      const offen = alle.filter((k) => k.status === 'offen');
      const folge = [
        ...offen.sort(nachEingang),
        ...alle.filter((k) => k.status !== 'offen').sort(nachEingang),
      ];
      const medien: string[] = [];
      for (const k of folge) {
        const m = k.medium.trim();
        if (m && !medien.includes(m)) medien.push(m);
      }
      const zahl = (art: Medienkontakt['art']) => alle.filter((k) => k.art === art).length;
      return {
        gesamt: alle.length,
        offen: offen.length,
        offene_anfragen: offen.filter((k) => k.art === 'anfrage').length,
        je_art: {
          anfrage: zahl('anfrage'),
          abstimmung: zahl('abstimmung'),
          termin: zahl('termin'),
        },
        medien,
      };
    },
    ladeMedienkontakt: async (einsatzId: number, id: number) => {
      const treffer = (await quelle(einsatzId)).find((k) => k.id === id);
      if (!treffer) throw new ApiError(404, 'Nicht gefunden');
      return treffer;
    },
  };
}
