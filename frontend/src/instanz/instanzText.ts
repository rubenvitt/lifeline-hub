import type {
  InstanzKopplungAnzeige,
  InstanzKopplungZustand,
  InstanzUebersicht,
  UnterschriftSchluesselAnzeige,
  UnterschriftSchluesselZustand,
} from '../api/types';

/**
 * Wortlaut der Seite „Instanzkopplung“ (LLH-1490). Exhaustive `Record`s: ein neuer Wert im Backend
 * bricht hier den Typecheck, statt als Rohwert zu erscheinen. Zustände stehen als Wort; Hinweise
 * nennen, was zu tun ist, in wenigen Wörtern.
 */

export const KOPPLUNG_ZUSTAND_TEXT: Record<InstanzKopplungZustand, string> = {
  angebahnt: 'wartet auf erste Meldung',
  aktiv: 'aktiv',
  widerrufen: 'widerrufen',
  vom_gegenueber_widerrufen: 'vom Gegenüber widerrufen',
};

export const SCHLUESSEL_ZUSTAND_TEXT: Record<UnterschriftSchluesselZustand, string> = {
  wartet_auf_gegenzeichnung: 'wartet auf Gegenzeichnung',
  gueltig: 'gültig',
  widerrufen: 'widerrufen',
};

/** Ab dieser Abweichung der Uhren (Sekunden) steht ein Hinweis an der Kopplung. */
export const UHR_HINWEIS_AB_S = 120;

/** Richtung aus Sicht dieser Instanz, ohne Hub und ELW zu unterscheiden (Entscheidung 13). */
export function richtungText(k: InstanzKopplungAnzeige): string {
  return k.richtung === 'meldet_sich' ? 'diese Instanz meldet sich dort' : 'meldet sich hier';
}

/** Zustandszeile einer Kopplung: Zustand, zuletzt gesehen, Stand. Rein, für den Test exportiert. */
export function kopplungZustandZeile(
  k: InstanzKopplungAnzeige,
  zeit: (wert: string) => string,
): string {
  const teile: (string | null)[] = [
    KOPPLUNG_ZUSTAND_TEXT[k.zustand],
    k.zuletzt_gesehen_at ? `zuletzt gesehen ${zeit(k.zuletzt_gesehen_at)}` : 'noch nie gesehen',
    k.gegenueber_softwarestand ? `Stand ${k.gegenueber_softwarestand}` : null,
    `Org dort: ${k.org.fremde_org_name}`,
  ];
  return teile.filter(Boolean).join(' · ');
}

/** Hinweise, die an einer Kopplung stehen müssen; leer, wenn alles passt. */
export function kopplungHinweise(k: InstanzKopplungAnzeige): string[] {
  const aus: string[] = [];
  // Meldet sich diese Instanz und ist widerrufen, meldet sie nur noch den Widerruf; ein Fehler
  // heißt dann, dass er noch nicht zugestellt ist (design.md D9, wird nachgestellt).
  if (k.zustand === 'widerrufen' && k.richtung === 'meldet_sich' && k.letzter_fehler) {
    aus.push('Widerruf noch nicht beim Gegenüber, wird nachgereicht');
  }
  if (k.protokoll === 'update_hier') aus.push('Update nötig: diese Instanz ist zu alt');
  if (k.protokoll === 'update_gegenueber') aus.push('Update nötig: das Gegenüber ist zu alt');
  if (k.uhr_abweichung_s != null && Math.abs(k.uhr_abweichung_s) > UHR_HINWEIS_AB_S) {
    aus.push(`Uhr weicht um ${Math.abs(k.uhr_abweichung_s)} s ab`);
  }
  if (k.letzter_fehler) aus.push(`Letzte Meldung: ${k.letzter_fehler}`);
  if (k.hinweis) aus.push(k.hinweis);
  return aus;
}

/** Warum „Code ausstellen“ gesperrt ist; `undefined`, wenn es geht. */
export function codeAusstellenSperre(u: InstanzUebersicht): string | undefined {
  if (!u.passkeys_eingerichtet) return 'Passkeys sind an dieser Instanz nicht eingerichtet';
  if (!u.eigener_schluessel) return 'Erst einen eigenen Unterschriftsschlüssel registrieren';
  return undefined;
}

/** Zustandszeile eines Unterschriftsschlüssels. */
export function schluesselZeile(
  s: UnterschriftSchluesselAnzeige,
  zeit: (wert: string) => string,
): string {
  const teile: (string | null)[] = [
    SCHLUESSEL_ZUSTAND_TEXT[s.zustand],
    s.herkunft === 'gegenueber'
      ? `von ${s.fremde_org_name ?? 'gekoppelter Instanz'}`
      : `registriert ${zeit(s.erstellt_at)}`,
    s.gegengezeichnet_von ? `gegengezeichnet von ${s.gegengezeichnet_von}` : null,
  ];
  return teile.filter(Boolean).join(' · ');
}
