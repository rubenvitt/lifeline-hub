import type { GlobalToken } from 'antd';
import { raeumungszustand, rollenFarbe, warnstufeKarte } from '../../theme/statusFarben';
import type { Evakuierungsbezirk, Warnstufe, ZoneTyp } from '../../api/types';

export interface ZoneStil {
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
  lineWidth: number;
}

/**
 * Voreingestellter Stil je typisierter Zone (eine Wahrheit; nicht gespeichert).
 *
 * Bewusst nicht auf die Rollen gezogen: `ZoneTyp` ist kein Enum des Statusfarb-Vertrags. Gleiches
 * gilt für {@link FREIE_SKIZZE_VORGABEFARBE} (`#1677ff`, in `zonenStil.test.ts` gepinnt) — die Grenze
 * zwischen Rollenfarbe und Nutzer-/Katalogfarbe.
 */
const STILE: Record<Exclude<ZoneTyp, 'freie_skizze'>, ZoneStil> = {
  gefahrengebiet: { fillColor: '#cf1322', fillOpacity: 0.2, lineColor: '#cf1322', lineWidth: 2 },
  absperrbereich: { fillColor: '#fa8c16', fillOpacity: 0.2, lineColor: '#fa8c16', lineWidth: 2 },
  absperrgrenze: { fillColor: '#cf1322', fillOpacity: 0, lineColor: '#cf1322', lineWidth: 4 },
  sperrgebiet: { fillColor: '#8c8c8c', fillOpacity: 0.3, lineColor: '#595959', lineWidth: 2 },
  // Siena-Braun (LFH-673, design.md D9), der einzige noch freie Farbton der Karte: nicht Violett
  // (`#722ed1` ist der Stil der Abschnittsflächen), nicht Petrol (Hochwasser), kein Rot/Orange/Grau
  // der Gefahren- und Sperrflächen. Linie gegen beide Blindkarten-Gründe: 3,36 : 1 nachts, 4,58 : 1
  // tags, also ≥ 3 : 1 (WCAG 1.4.11). Den Räumungszustand trägt die Beschriftung.
  evakuierungsbezirk: {
    fillColor: '#a0522d',
    fillOpacity: 0.15,
    lineColor: '#a0522d',
    lineWidth: 2,
  },
};

/**
 * Vorgabefarbe der freien Skizze: mit ihr startet das Zeichnen (Paneel und Zeichnen-Deeplink,
 * LFH-825), eine Skizze ohne gespeicherte Farbe wird in ihr gezeigt, und das Farbfeld im
 * `ZonenInspector` vergleicht gegen sie (LFH-797, Spec `lagekarte-zeichnen`: EINE Quelle, sonst
 * löste ein bloßer Blur ein PATCH aus). Ein persistierter Datenwert, kein Laufzeit-Token — sonst
 * deutete ein Themenwechsel gespeicherte Zonen um.
 */
export const FREIE_SKIZZE_VORGABEFARBE = '#1677ff';

/** Stil einer Zone: typisierte aus `typ`, freie Skizze aus gespeicherter `farbe`. */
export function zoneStil(typ: ZoneTyp, farbe: string | null | undefined): ZoneStil {
  if (typ === 'freie_skizze') {
    const c = farbe && farbe.trim() ? farbe : FREIE_SKIZZE_VORGABEFARBE;
    return { fillColor: c, fillOpacity: 0.2, lineColor: c, lineWidth: 2 };
  }
  return STILE[typ];
}

interface ZoneTypInfo {
  typ: ZoneTyp;
  label: string;
  /** Geometrie, die der Typ erzwingt; `beides` = Nutzer wählt Fläche/Linie. */
  geometrie: 'Polygon' | 'LineString' | 'beides';
}

/** Typ-Katalog für die Zeichen-UI (Reihenfolge wie Spec-Tabelle). */
export const ZONE_TYPEN: ZoneTypInfo[] = [
  { typ: 'gefahrengebiet', label: 'Gefahrengebiet', geometrie: 'Polygon' },
  { typ: 'absperrbereich', label: 'Absperrbereich', geometrie: 'Polygon' },
  { typ: 'absperrgrenze', label: 'Absperrgrenze', geometrie: 'LineString' },
  { typ: 'sperrgebiet', label: 'Sperrgebiet', geometrie: 'Polygon' },
  { typ: 'freie_skizze', label: 'Freie Skizze', geometrie: 'beides' },
  // Fläche eines Evakuierungsbezirks; zugeordnet wird im Zonen-Inspector.
  { typ: 'evakuierungsbezirk', label: 'Evakuierungsbezirk', geometrie: 'Polygon' },
];

/** Sprechendes Label eines Typs (für Inspector/Legende). */
export function zoneTypLabel(typ: ZoneTyp): string {
  return ZONE_TYPEN.find((t) => t.typ === typ)?.label ?? typ;
}

/**
 * Stil einer gefahrengebiet-Zone, abgeleitet aus der höchsten Warnstufe ihres Gebiets. Die Skala
 * steht als `warnstufeKarte` im Statusfarb-Vertrag (`theme/statusFarben.ts`); dass `keine` die
 * Alarmrolle trägt (ein unbewertetes Gebiet wird vorsichtshalber als Gefahr gezeigt), ist dort
 * begründet.
 *
 * Dieses Modul erzeugt MapLibre-`paint`-Werte, keine DOM-Styles — es hat keinen `useToken()`-Zugang
 * und bekommt den Token von `useLagekarteDaten` durchgereicht, statt den Modus aus
 * `document.documentElement` zu raten.
 */
export function gefahrengebietStil(warnstufe: Warnstufe, token: GlobalToken): ZoneStil {
  const c = rollenFarbe(warnstufeKarte[warnstufe].rolle, token);
  return { fillColor: c, fillOpacity: 0.25, lineColor: c, lineWidth: 2 };
}

/**
 * Beschriftung einer Zone auf der Kartenfläche (LFH-357).
 *
 * Die Farbe trägt die Skala nicht: `warnstufeKarte` bildet fünf Stufen auf zwei unterscheidbare
 * Rollen ab (`achtung`: niedrig/mittel · `alarm`: keine/hoch/akut), und `form` hat nur drei Zeichen
 * für fünf Stufen. Der tragende zweite Kanal ist deshalb der Text (WCAG 1.4.1); sein Wortlaut kommt
 * allein aus {@link warnstufeKarte}`[stufe].label` — wer das Wort dort ändert, ändert die
 * Kartenbeschriftung mit.
 *
 * „keine" heißt „keine Stufe gesetzt", nicht „keine Gefahr" und nicht „unbewertet": im Backend
 * (`src/gefahr/repo.rs`, Severity-MAX) entsteht Rang 0 sowohl ohne Bewertung als auch aus lauter
 * `keine`-Zellen, die Fälle sind nicht trennbar. Die rote Fläche ist die Vorsichtsentscheidung aus
 * {@link gefahrengebietStil}.
 *
 * Drei Zustände: `null` ist der Normalfall jeder anderen Zonenart (Name unverändert). `'unbekannt'`
 * heißt, der Nachschlag geht ins Leere — das Ladegate der Karte hängt nicht an der
 * Gefahrengebiete-Query (`useLagekarteDaten.ts`), Zonen werden also gezeichnet, während die Gebiete
 * laden oder gescheitert sind. Die Farbe behandelt das vorsichtshalber wie `keine`, der Text nicht:
 * „keine" wäre dort eine Behauptung über fehlende Daten.
 */
export function zonenBeschriftung(
  label: string | null | undefined,
  warnstufe: Warnstufe | 'unbekannt' | null,
): string {
  const name = label?.trim() ?? '';
  if (warnstufe === null) return name;
  const stufe = stufenWort(warnstufe);
  return name ? `${name} · ${stufe}` : stufe;
}

/**
 * Beschriftung einer Bezirksfläche (LFH-673) — Muster „NAME · STUFE" wie oben.
 *
 * Der Name ist der Zonenname, sonst die Bezeichnung des Bezirks, sonst das Typwort. Den
 * Räumungszustand trägt der Text, nicht die Farbe; das Wort kommt aus {@link raeumungszustand},
 * derselben Quelle wie auf der Betreuungsseite.
 *
 * `bezirk = null` heißt nicht zugeordnet oder nicht lesbar (kein Modulrecht, Betreuung lädt noch).
 * Beides zeigt nur Name bzw. Typwort — sonst stünden Bezirksname oder Zustand bei Personen ohne
 * Modulrecht auf der Karte.
 */
export function bezirkBeschriftung(
  label: string | null | undefined,
  bezirk: Pick<Evakuierungsbezirk, 'bezeichnung' | 'raeumung'> | null,
): string {
  const eigen = label?.trim();
  if (!bezirk) return eigen || 'Evakuierungsbezirk';
  const name = eigen || bezirk.bezeichnung;
  return `${name} · Räumung: ${raeumungszustand[bezirk.raeumung].label}`;
}

/**
 * Das Stufenwort der Plakette „NAME · STUFE" (Versalien per Layer-Stil).
 *
 * Eine echte Stufe steht allein („hoch"). Die Sonderzustände brauchen das Bezugswort: „WERK ·
 * KEINE" läse sich als „keine Gefahr", und „unbekannt" allein sagte nicht, was unbekannt ist. Der
 * Wortlaut der Stufe bleibt der des Vertrags.
 */
function stufenWort(warnstufe: Warnstufe | 'unbekannt'): string {
  if (warnstufe === 'unbekannt') return 'Stufe unbekannt';
  const wort = warnstufeKarte[warnstufe].label;
  return warnstufe === 'keine' ? `${wort} Stufe` : wort;
}
