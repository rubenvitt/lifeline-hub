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
  wartet_auf_bestaetigung: 'wartet auf Bestätigung',
  gueltig: 'gültig',
  widerrufen: 'widerrufen',
  // Von einem Admin hier zurückgewiesen; „abgelehnt“ heißt in der Spur schon das automatische
  // Verwerfen eines Schlüssels ohne gültige Gegenzeichnung.
  abgelehnt: 'zurückgewiesen',
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

/** Zeile zur Stammdaten-Verteilung (LLH-1493): an der meldenden Seite der übernommene Stand, an der
 *  erreichten, an wie viele Konten Geheimnisse gingen. `null`, wenn es nichts zu sagen gibt. */
export function stammdatenZeile(k: InstanzKopplungAnzeige): string | null {
  const s = k.org.stammdaten;
  if (k.richtung === 'meldet_sich')
    return s.stand > 0 ? `Stammdaten übernommen bis Stand ${s.stand}` : null;
  if (s.konten_mit_geheimnis > 0) {
    return `Kontogeheimnisse dort: ${s.konten_mit_geheimnis} ${s.konten_mit_geheimnis === 1 ? 'Konto' : 'Konten'}`;
  }
  return null;
}

/** Hinweise, die an einer Kopplung stehen müssen; leer, wenn alles passt. `datentraegerBestaetigt`
 *  sagt, ob diese Instanz ihre Datenträgerverschlüsselung bestätigt hat (LLH-1493). */
export function kopplungHinweise(
  k: InstanzKopplungAnzeige,
  datentraegerBestaetigt = true,
): string[] {
  const aus: string[] = [];
  const aktiv = k.zustand === 'aktiv' && k.org.widerrufen_at == null;
  // Ohne bestätigte Plattenverschlüsselung kommen Konten ohne Passwort an (D6): hier sagen, warum.
  if (aktiv && k.richtung === 'meldet_sich' && !datentraegerBestaetigt) {
    aus.push('Geheimnisse nicht verteilt: Datenträgerverschlüsselung nicht bestätigt');
  }
  if (aktiv && k.richtung === 'wird_gemeldet' && !k.org.stammdaten.geheimnisse_verteilt) {
    aus.push(
      'Kontogeheimnisse gehen nicht hinaus: Datenträgerverschlüsselung dort nicht bestätigt',
    );
  }
  aus.push(...k.org.stammdaten.hinweise);
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
  // LLH-1605: nachgelieferte Schlüssel warten auf einen Menschen hier; ohne gültigen eigenen
  // Schlüssel (etwa nach dem Deaktivieren des letzten Halters) hilft nur neues Koppeln.
  if (k.wartende_schluessel === 1) {
    aus.push('1 neuer Unterschriftsschlüssel wartet auf Bestätigung');
  } else if (k.wartende_schluessel > 1) {
    aus.push(`${k.wartende_schluessel} neue Unterschriftsschlüssel warten auf Bestätigung`);
  }
  if (k.ohne_gueltigen_schluessel) {
    aus.push('Kein gültiger Unterschriftsschlüssel mehr: Kopplung widerrufen und neu koppeln');
  }
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
    // Fingerabdruck des Unterzeichners und Zeitpunkt zeigt der Bestätigungsdialog (LLH-1605).
    s.gegengezeichnet_von ? `gegengezeichnet von ${s.gegengezeichnet_von}` : null,
  ];
  return teile.filter(Boolean).join(' · ');
}
