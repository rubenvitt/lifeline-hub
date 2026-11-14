import type { AnzeigeKonventionen } from '../anzeige/format';
import { inZone } from '../anzeige/format';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import { etbAnhangPfad } from '../api/etb';
import { dokumentDownloadPfad } from '../api/dokumente';
import type { EtbEintragAnzeige } from '../api/types';
import { formatGroesse } from '../karten/formatGroesse';
import {
  auftraegePfad,
  befehlDetailPfad,
  einheitDetailPfad,
  etbPfad,
  lageberichtDetailPfad,
  meldungenPfad,
  nachforderungenPfad,
} from '../routing/deeplinks';
import { berichtigtDurch } from './berichtigung';
import type { EtbDokument } from './EtbDokumente';
import { istNachgetragen } from './typFarben';

/**
 * Vermerke eines ETB-Eintrags (Spec `etb-zeitachse-darstellung`, „Vermerke in eigener Spalte“):
 * Verweise und Marken, die in der Spaltenzeile in der Spalte Vermerk stehen, in der
 * Handschirm-Zeile unter dem Text, und vollständig im Zeilenmenü und im Titel. EINE Liste für alle
 * drei Orte, rein — sonst stünde ein Verweis nur an einem.
 *
 * Reihenfolge nach Gewicht: erst, ob der Eintrag noch gilt (berichtigt durch, berichtigt), dann
 * der Nachtrag, dann die Verweise auf gekoppelte Vorgänge (dieselben wie `EtbBacklinkBadges`,
 * LFH-25/LFH-636/LLH-1104/LLH-1266), zuletzt Dateien. Der Wortlaut ist der zugängliche Name des
 * Verweises; das ↗ setzt die Darstellung als Zierde dahinter.
 *
 * „SOFORT“ aus dem Entwurf fehlt: ein ETB-Eintrag trägt keine Priorität (Wire unverändert,
 * `frontend/AGENTS.md`, „Keine erfundenen Daten“).
 */

export type VermerkTon = 'verweis' | 'achtung';

export interface Vermerk {
  /** Stabil je Eintrag (React-Schlüssel, Menüschlüssel). */
  schluessel: string;
  /** Sichtbarer Wortlaut, Menüeintrag und Teil des Titels. */
  text: string;
  ton: VermerkTon;
  /** Navigationsziel eines Verweises. */
  pfad?: string;
  /** Eine Datei (Anhang, Dokument) zum Herunterladen; `name` ist der zugängliche Name. */
  datei?: { href: string; dateiname: string; name: string; mime: string };
}

export interface VermerkKontext {
  einsatzId: number;
  /** Grundeintrag einer Berichtigung (`Berichtigungsindex.grundeintrag`). */
  grundeintrag: { id: number; lfd_nr: number | null } | null;
  konventionen: AnzeigeKonventionen;
  /** Dokumente der Ablage mit Bezug auf diesen Eintrag (LFH-743); fehlt ohne Modulrecht. */
  dokumente?: readonly EtbDokument[];
}

/** „Nachtrag · erfasst 1926“; über Mitternacht mit Tag (`zeitKurz` gegen die Ereigniszeit). */
function nachtragVermerk(e: EtbEintragAnzeige, konv: AnzeigeKonventionen): string {
  const ereignis = inZone(e.ereigniszeit, konv);
  return `Nachtrag · erfasst ${zeitKurz(e.received_at, konv, ereignis)}`;
}

export function vermerkeVon(e: EtbEintragAnzeige, k: VermerkKontext): Vermerk[] {
  const aus: Vermerk[] = [];
  const verweis = (schluessel: string, text: string, pfad: string) =>
    aus.push({ schluessel, text, ton: 'verweis', pfad });

  for (const b of berichtigtDurch(e)) {
    verweis(
      `durch-${b.id}`,
      `berichtigt durch Nr. ${b.lfd_nr}`,
      etbPfad(k.einsatzId, { eintrag: b.id }),
    );
  }
  if (k.grundeintrag) {
    // Der Sprung führt ohne den aktiven Filter (LFH-25): die Seite lädt nach, bis er da ist. Ohne
    // geladene Nummer wird keine erfunden.
    verweis(
      'grund',
      k.grundeintrag.lfd_nr != null
        ? `berichtigt Nr. ${k.grundeintrag.lfd_nr}`
        : 'berichtigt einen älteren Eintrag',
      etbPfad(k.einsatzId, { eintrag: k.grundeintrag.id }),
    );
  }
  if (istNachgetragen(e.ereigniszeit, e.received_at)) {
    aus.push({ schluessel: 'nachtrag', text: nachtragVermerk(e, k.konventionen), ton: 'achtung' });
  }
  const id = k.einsatzId;
  if (e.befehl_id != null) verweis('befehl', 'Befehl', befehlDetailPfad(id, e.befehl_id));
  if (e.lagebericht_id != null) {
    verweis('lagebericht', 'Lagebericht', lageberichtDetailPfad(id, e.lagebericht_id));
  }
  if (e.auftrag_id != null) {
    verweis('auftrag', 'Auftrag', auftraegePfad(id, { auftrag: e.auftrag_id }));
  }
  if (e.meldung_id != null) {
    verweis(
      'meldung',
      e.meldung_lfd_nr != null ? `Meldung #${e.meldung_lfd_nr}` : 'Meldung',
      meldungenPfad(id, { meldung: e.meldung_id }),
    );
  }
  if (e.nachforderung_id != null) {
    verweis(
      'nachforderung',
      'Nachforderung',
      nachforderungenPfad(id, { nachforderung: e.nachforderung_id }),
    );
  }
  // Ein Stand von vor LLH-1266 (Offline-Spiegel) trägt die Liste noch nicht.
  for (const einheit of e.einheiten ?? []) {
    verweis(
      `einheit-${einheit.id}`,
      `Einheit «${einheit.name}»`,
      einheitDetailPfad(id, einheit.id),
    );
  }
  for (const f of e.folgeauftraege) {
    verweis(
      `folge-${f.id}`,
      f.lfd_nr != null ? `Folgeauftrag Nr. ${f.lfd_nr}` : 'Folgeauftrag',
      auftraegePfad(id, { auftrag: f.id }),
    );
  }
  for (const a of e.anhaenge) {
    aus.push({
      schluessel: `anhang-${a.id}`,
      text: `Anhang ${a.dateiname}`,
      ton: 'verweis',
      datei: {
        href: etbAnhangPfad(id, e.id, a.id),
        dateiname: a.dateiname,
        mime: a.mime,
        // Derselbe Name wie in `EtbAnhaenge`: zwei Einträge mit `IMG_0001.jpg` blieben sonst
        // gleichnamig.
        name: `${a.dateiname}, ${formatGroesse(a.groesse)}, Anhang zu Nr. ${e.lfd_nr} herunterladen`,
      },
    });
  }
  for (const d of k.dokumente ?? []) {
    aus.push({
      schluessel: `dokument-${d.id}`,
      text: `Dokument „${d.titel}“`,
      ton: 'verweis',
      datei: {
        href: dokumentDownloadPfad(id, d.id),
        dateiname: d.dateiname,
        mime: d.mime,
        name: `Dokument „${d.titel}“, ${formatGroesse(d.groesse)}, zu Nr. ${e.lfd_nr} herunterladen`,
      },
    });
  }
  return aus;
}

/** Alle Vermerke als ein Satz — Titel der Spalte Vermerk. */
export function vermerkeTitel(vermerke: readonly Vermerk[]): string {
  return vermerke.map((v) => v.text).join(' · ');
}
