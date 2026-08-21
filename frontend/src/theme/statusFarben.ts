import type { GlobalToken } from 'antd';
import { farbenDunkel, farbenHell } from './tokens';
import type {
  BelegungsArt,
  BrStatus,
  EtbTyp,
  MaterialStatus,
  StatusKategorie,
  UhsStatus,
  UhsTyp,
  Verfuegbarkeit,
  Warnstufe,
} from '../api/types';

/**
 * Statusfarb-Vertrag (LFH-328 · A2). EINE Quelle für „welche Bedeutung hat welche
 * Statusfarbe" — vorher lagen dieselben Abbildungen in bis zu fünf Dateien parallel.
 *
 * DIESE DATEI TRÄGT KEINEN FARBWERT. Sie bildet Domänen-Enums auf **Rollen** ab
 * (`alarm`/`achtung`/`normal`/`neutral`/`bedien`/`marke`); die Werte stehen
 * ausschließlich in `tokens.ts` bzw. `rollen.css`. {@link rollenFarbe} ist die einzige
 * Übersetzung Rolle → Farbwert, und sie liest den aktiven Modus aus dem antd-Token.
 *
 * JEDER EINTRAG TRÄGT EINEN ZWEITEN KANAL. `label` ist Pflichtfeld, nicht optional
 * (WCAG 1.4.1, A1 Festlegung 5): ein Eintrag, der nur eine Farbe liefert, bricht den
 * Typcheck. `Record<Enum, StatusDarstellung>` bricht zusätzlich bei einer neuen
 * Enum-Variante — beides ist Absicht, nicht Strenge um ihrer selbst willen.
 *
 * ── DIE GRENZE DES VERTRAGS, und sie ist Teil des Vertrags ──────────────────────
 *
 * Für Fahrzeug- und Personalstatus kommt die Farbe NICHT von hier, sondern **aus der
 * Datenbank**: `status_farbe` (`types.generated.ts:598/694`, `status_farbe?: string | null`)
 * wird im Backend (`src/routes/fahrzeug_status.rs`, `src/routes/personal_status.rs`) nur
 * getrimmt — **keine Wertevalidierung, kein Enum, kein Hex-Format-Check**. Es ist
 * mandantengepflegter Freitext aus den Stammdaten-Tabs, und ein getypter `Record` kann
 * das nicht einfangen: der Tag rendert am Ende einen beliebigen String.
 *
 * Dieser Vertrag deckt deshalb die **Fallback-Achse** ({@link statusKategorie}, früher
 * `KATEGORIE_FALLBACK` in `FahrzeugePage`/`PersonalPage`, byte-identisch dupliziert) —
 * **die DB-Achse bleibt draußen.** Ohne diesen Satz behauptet die Exhaustivität etwas,
 * das nicht gilt. Dass die DB-Farbe gegen die Rollen validiert werden sollte, ist ein
 * eigener Befund mit eigenem Ticket, nicht Teil von A2.
 *
 * Ebenfalls bewusst draußen: die rund 20 Farb-/Label-Maps außerhalb der hier gelisteten
 * Enums (`personen/personMeta.ts`, `pages/schaeden/schadenHelfer.tsx`,
 * `kommunikation/phase.ts`, `TierePage`, `clusterDonut.ts`, `taktischesZeichen.ts` u. a.).
 * Sie hineinzuziehen wäre der Bestands-Sweep, den A2 ausdrücklich verbietet.
 * Der Materialstatus (`pages/MaterialPage.tsx`) stand bis LFH-341/C6 in dieser Liste —
 * seither trägt er seine Karte HIER ({@link materialStatus}), nicht mehr draußen.
 *
 * ── DIE DRITTE DARSTELLUNGSSORTE: FLÄCHE (aufgelöst mit LFH-368 · B5h) ──────────
 *
 * Bis B5h lag sie außerhalb dieses Vertrags: `pages/gefahren/gefahrenSchema.ts`
 * hielt vier Pastell-Hex für die Matrixzellen — begründet (ein gesättigter Rollenton
 * macht den Zellinhalt unlesbar), aber am falschen Ort und OHNE Nachtmodus-Gegenwert.
 * Beides ist erledigt: {@link warnstufeFlaeche} bildet die Stufen auf die
 * Füllungsrollen aus `tokens.ts` ab, {@link flaechenFarbe} löst sie je Modus auf.
 *
 * Die Sorte bleibt getrennt, der Ort nicht mehr: „eine Quelle für Statusfarbe" gilt
 * jetzt für Etikett UND Fläche, und die Fläche kommt mit einem eigenen Typ
 * ({@link Flaechendarstellung}), weil eine Füllung keine {@link Statusrolle} ist.
 * Wer eine VIERTE Sorte braucht, benennt sie hier — still danebenzubauen ist der
 * Fehler, nicht das Danebenbauen selbst.
 *
 * Gefunden im Code-Review zu LFH-328: `pages/lagekarte/ZonenInspector.tsx` benutzte
 * `warnstufeFarbe` für ein Status-Etikett und ist auf {@link warnstufeKarte} gezogen
 * worden. LFH-368 hat denselben Fehlgriff in `pages/gefahren/GefahrenPage.tsx`
 * gefunden und behandelt ihn im selben Umbau. Ein Guard „kein `Tag color=` über
 * einem Vertrags-Enum außerhalb `theme/`" wäre die maschinelle Fassung dieser
 * Grenze und ist als Folge-Ticket erfasst.
 */

/** Eine A0-Statusrolle. Farbwerte stehen ausschließlich in `tokens.ts`/`rollen.css`. */
export type Statusrolle = 'alarm' | 'achtung' | 'normal' | 'neutral' | 'bedien' | 'marke';

/** Zweiter Kanal ist Pflicht (WCAG 1.4.1): `label` trägt ihn immer, `form` optional zusätzlich. */
export interface StatusDarstellung {
  rolle: Statusrolle;
  /** Pflicht — nie weglassbar. Der Text IST der zweite Kanal. */
  label: string;
  form?: 'dreieck' | 'kreis' | 'balken';
}

/**
 * Kräfte-Statuskategorie. Vereint fünf bisher getrennt gepflegte Maps:
 * `KAT_FARBE` (`KraefteuebersichtPage`), `KATEGORIE_FARBEN` (`StatusKatalogTab`,
 * `PersonalStatusTab`) und `KATEGORIE_FALLBACK` (`FahrzeugePage`, `PersonalPage`).
 *
 * DIVERGENZ AUFGELÖST: `gebunden` war in `KraefteuebersichtPage` `'gold'`, in den vier
 * anderen `'orange'` — zwei Farben für einen Zustand. Hier ist es EINE Zeile.
 */
export const statusKategorie: Record<StatusKategorie, StatusDarstellung> = {
  verfuegbar: { rolle: 'normal', label: 'verfügbar' },
  gebunden: { rolle: 'achtung', label: 'gebunden' },
  nicht_verfuegbar: { rolle: 'alarm', label: 'nicht verfügbar' },
};

/** Verfügbarkeit eines UHS-Platzes (früher `VERF_FARBE`, `pages/uhs/Grundriss.tsx`).
 *  `gesperrt` war dort Grau — die A0-Entsprechung ist `neutral`, nicht `alarm`:
 *  ein gesperrter Platz ist ein bewusster Zustand, keine Gefahr. */
export const verfuegbarkeit: Record<Verfuegbarkeit, StatusDarstellung> = {
  frei: { rolle: 'normal', label: 'frei' },
  defekt: { rolle: 'alarm', label: 'defekt' },
  aufbereitung: { rolle: 'achtung', label: 'in Aufbereitung' },
  gesperrt: { rolle: 'neutral', label: 'gesperrt' },
  reserviert: { rolle: 'bedien', label: 'reserviert' },
};

/**
 * ETB-Eintragstyp (früher `TYP_FARBE`/`TYP_LABEL`, `etb/typFarben.ts`).
 *
 * BEWUSSTER AUFLÖSUNGSVERLUST: `lage` (Cyan) und `entscheidung` (Violett) hatten
 * antd-Presets ohne A0-Gegenstück. Sie werden `neutral` — ein Eintragstyp ist eine
 * KATEGORIE, keine Dringlichkeit, und eine gesättigte Farbe ohne Bedeutung verbraucht
 * Aufmerksamkeit, die der Alarm braucht (ASM, A1 Festlegung 5). Der Text trägt die
 * Unterscheidung; er ist hier Pflichtfeld und damit garantiert vorhanden.
 */
export const etbTyp: Record<EtbTyp, StatusDarstellung> = {
  meldung: { rolle: 'bedien', label: 'Meldung' },
  anordnung: { rolle: 'achtung', label: 'Anordnung' },
  lage: { rolle: 'neutral', label: 'Lage' },
  entscheidung: { rolle: 'neutral', label: 'Entscheidung' },
  system: { rolle: 'neutral', label: 'System' },
  berichtigung: { rolle: 'alarm', label: 'Berichtigung' },
};

/** Status einer Unfallhilfsstelle (früher `STATUS_META`, `pages/UnfallhilfsstellenPage.tsx`). */
export const uhsStatus: Record<UhsStatus, StatusDarstellung> = {
  geplant: { rolle: 'neutral', label: 'geplant' },
  aktiv: { rolle: 'normal', label: 'aktiv' },
  aufgeloest: { rolle: 'alarm', label: 'aufgelöst' },
};

/** Typ einer Unfallhilfsstelle. Im Bestand gab es dafür NUR Labels
 *  (`UHS_TYP_LABEL`), nie eine Farbe — der Typ ist eine Kategorie, keine Lage.
 *  Er bleibt deshalb durchgängig `neutral`; unterschieden wird über den Text und
 *  über das taktische Zeichen (`pages/lagekarte/taktischesZeichen.ts`). */
export const uhsTyp: Record<UhsTyp, StatusDarstellung> = {
  patientenablage: { rolle: 'neutral', label: 'Patientenablage' },
  behandlungsplatz: { rolle: 'neutral', label: 'Behandlungsplatz' },
  verletztensammelstelle: { rolle: 'neutral', label: 'Verletztensammelstelle' },
  sonstige: { rolle: 'neutral', label: 'Sonstige' },
};

/**
 * Status eines Einsatzmaterials (früher `STATUS_META`, `pages/MaterialPage.tsx`).
 *
 * ── DIE FRAGE, DIE C4 OFFEN GELASSEN HAT, IST HIER BEANTWORTET (LFH-341 · C6) ────
 *
 * LFH-339/C4 hat für diesen Katalog bewusst KEINE Rolle vergeben und den Grund
 * hingeschrieben: `im_einsatz` war Blau, „Rot bedient nichts, `bedien` ist blau" —
 * also schien es für diesen Zustand keine ehrliche Rolle zu geben. C4 hat daraus
 * nicht „nie" gemacht, sondern „eine eigene Entscheidung, kein Nebenprodukt".
 *
 * Die Entscheidung ist getroffen, und sie erfindet nichts: `bedien` ist in DIESER
 * Datei bereits dreimal Kategoriefarbe für eine aktive Beziehung — `verfuegbarkeit
 * .reserviert`, `belegungsArt.wechsel`, `etbTyp.meldung`. Material im Einsatz ist
 * derselbe Zustand, nicht ein neuer. Die Rolle war da, sie war nur nicht erkannt.
 *
 * `defekt` und `verbraucht` teilen sich `alarm` — dasselbe Muster wie bei
 * {@link warnstufeKarte}, wo fünf Stufen auf drei Rollen fallen. Der zweite Kanal ist
 * das Pflichtfeld `label`; eine sechste Farbe gibt es dafür nicht.
 *
 * EIN Behandlungsweg für dieses Enum: `pages/MaterialPage.tsx` (Kräfte) und
 * `pages/uhs/MaterialTab.tsx` (UHS) lesen beide von hier. Zwei Farbbehandlungen
 * desselben Enums wären der Fehlerfall, nicht der Kompromiss.
 */
export const materialStatus: Record<MaterialStatus, StatusDarstellung> = {
  einsatzbereit: { rolle: 'normal', label: 'einsatzbereit' },
  im_einsatz: { rolle: 'bedien', label: 'im Einsatz' },
  defekt: { rolle: 'alarm', label: 'defekt' },
  verbraucht: { rolle: 'alarm', label: 'verbraucht' },
  desinfektion_noetig: { rolle: 'achtung', label: 'Desinfektion nötig' },
};

/** Status eines Bereitstellungsraums (früher `STATUS_META`,
 *  `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx`). */
export const brStatus: Record<BrStatus, StatusDarstellung> = {
  geplant: { rolle: 'neutral', label: 'geplant' },
  aktiv: { rolle: 'normal', label: 'aktiv' },
  aufgeloest: { rolle: 'alarm', label: 'aufgelöst' },
};

/** Bewegungsart einer UHS-Belegung (früher `ART_FARBE`/`ART_LABEL`,
 *  `pages/uhs/BewegungenTab.tsx`). */
export const belegungsArt: Record<BelegungsArt, StatusDarstellung> = {
  eintritt: { rolle: 'normal', label: 'Eintritt' },
  wechsel: { rolle: 'bedien', label: 'Wechsel' },
  austritt: { rolle: 'achtung', label: 'Austritt' },
};

/**
 * Warnstufe als **Objektsignatur auf der Karte** (früher `WARNSTUFE_KARTE`,
 * `pages/lagekarte/zonenStil.ts`).
 *
 * `keine` ist bewusst `alarm`: ein noch unbewertetes Gefahrengebiet wird vorsichtshalber
 * als Gefahr dargestellt, nicht „ruhiger" als `niedrig`. Wer hier auf `normal` zieht,
 * dreht eine Sicherheitsentscheidung zurück — die Gegenlesart steht als
 * {@link warnstufeKennzahl} daneben, nicht statt dessen.
 *
 * AUFLÖSUNGSVERLUST: der Bestand hatte fünf verschiedene Rot-/Gelbtöne, A0 hat drei
 * Statusrollen. `niedrig`/`mittel` fallen damit auf dieselbe Rolle, ebenso
 * `keine`/`hoch`/`akut`. Wer die fünf Stufen visuell unterscheiden muss, nutzt `label`
 * (immer vorhanden) oder `form` — nicht eine sechste Farbe.
 */
export const warnstufeKarte: Record<Warnstufe, StatusDarstellung> = {
  keine: { rolle: 'alarm', label: 'keine' },
  niedrig: { rolle: 'achtung', label: 'niedrig' },
  mittel: { rolle: 'achtung', label: 'mittel' },
  hoch: { rolle: 'alarm', label: 'hoch' },
  akut: { rolle: 'alarm', label: 'akut' },
};

/**
 * Warnstufe als **Kennzahl im Lagebild** (Werte aus `WARNSTUFE_STUFE`,
 * `pages/lage-dashboard/lagebild.ts`).
 *
 * `keine` ist hier `normal` — und das widerspricht {@link warnstufeKarte} mit Absicht:
 * die Karte zeigt ein OBJEKT (dieses eine Gebiet ist unbewertet ⇒ vorsichtshalber
 * Gefahr), das Dashboard eine KENNZAHL (nichts gemeldet ⇒ kein Alarmbeitrag). Beide
 * Lesarten sind für ihren Kontext richtig; sie stehen deshalb als zwei benannte Exporte
 * nebeneinander statt als eine stille Mehrheitsentscheidung.
 *
 * Die Werte sind hier KOPIERT, nicht importiert: `theme/` darf nicht von `pages/`
 * abhängen. Die Gegenrichtung — `lagebild.ts` liest von hier — ist der Zielzustand.
 */
export const warnstufeKennzahl: Record<Warnstufe, StatusDarstellung> = {
  keine: { rolle: 'normal', label: 'keine' },
  niedrig: { rolle: 'normal', label: 'niedrig' },
  mittel: { rolle: 'achtung', label: 'mittel' },
  hoch: { rolle: 'alarm', label: 'hoch' },
  akut: { rolle: 'alarm', label: 'akut' },
};

/**
 * Übersetzt eine Rolle in den Farbwert des aktiven Modus.
 *
 * Vier Rollen liegen als antd-Token vor, weil `antdToken()` sie dorthin ableitet.
 * `neutral` hat keine eigene Farbrolle — es ist der gedämpfte Grauwert, den antd aus
 * der Textskala liefert. `marke` dagegen kennt antd gar nicht (`tokens.ts`: „Was antd
 * nicht kennt (Marke, …), lebt allein in `rollen.css`") und darf NICHT auf `colorError`
 * ausweichen: `alarm` trüge dann Gefahr UND Ortssignatur, und „eine Farbe = eine
 * Bedeutung" wäre verletzt. Der Wert kommt deshalb direkt aus den Rollen.
 *
 * Den Modus erkennen wir über die Helligkeit von `colorBgBase` (`#fff` hell, `#000`
 * dunkel). NICHT über einen Vergleich mit `farbenDunkel.bedien`: `colorPrimary` ist ein
 * Seed-Token, und der `darkAlgorithm` rechnet es um — gemessen wird aus dem gesetzten
 * `#6fb4ec` ein `#619ccc`, aus `alarm` `#ff7a7f` ein `#dc6b6f`. Ein Gleichheitstest auf
 * die Rollenwerte schlägt dort also immer fehl. Ein fremdes Theme (z. B. blanker
 * `ConfigProvider` im Test) landet damit im Hellmodus, statt zu werfen.
 */
export function rollenFarbe(rolle: Statusrolle, token: GlobalToken): string {
  switch (rolle) {
    case 'alarm':
      return token.colorError;
    case 'achtung':
      return token.colorWarning;
    case 'normal':
      return token.colorSuccess;
    case 'bedien':
      return token.colorPrimary;
    case 'neutral':
      return token.colorTextTertiary;
    case 'marke':
      return (istDunklerModus(token) ? farbenDunkel : farbenHell).marke;
  }
}

/** antd hat keinen Modus-Token; die Helligkeit der Basisfläche ist das einzige Signal,
 *  das ohne zweiten Provider auskommt und den Algorithmus-Umbau der Seeds übersteht. */
function istDunklerModus(token: GlobalToken): boolean {
  const kurz = token.colorBgBase.trim().replace('#', '');
  const hex = kurz.length === 3 ? [...kurz].map((z) => z + z).join('') : kurz;
  if (hex.length < 6) return false;
  const wert = Number.parseInt(hex.slice(0, 6), 16);
  if (Number.isNaN(wert)) return false;
  // Relative Helligkeit nach ITU-R BT.709 — dieselbe Gewichtung, die WCAG 1.4.3 nutzt.
  const helligkeit = 0.2126 * ((wert >> 16) & 255) + 0.7152 * ((wert >> 8) & 255) + 0.0722 * (wert & 255);
  return helligkeit < 128;
}

/** Eine Flächen-Füllungsrolle. Bewusst enger als `keyof Farbrollen`: `markeGlut` ist
 *  ein Schatten, keine Fläche, und `text` schon gar nicht. */
export type Fuellungsrolle =
  | 'achtungFuellung'
  | 'achtungFuellungStark'
  | 'alarmFuellung'
  | 'alarmFuellungStark'
  | 'normalFuellung';

/**
 * Die dritte Darstellungssorte: eine FLÄCHE, kein Etikett.
 *
 * Eigener Typ statt {@link StatusDarstellung}, weil eine Füllung keine
 * {@link Statusrolle} ist. Sie in `rolle` zu pressen hätte den Kanal-Vertrag der
 * Etikett-Maps verwässert und `rollenFarbe` einen Fall gegeben, den es nicht
 * bedienen kann (`antdToken()` bildet die Füllungsrollen nicht ab).
 */
export interface Flaechendarstellung {
  /** `null` = keine Fläche. Kein `'transparent'` als Rollenname — das ist ein Wert. */
  fuellung: Fuellungsrolle | null;
  /** Pflicht, zweiter Kanal (WCAG 1.4.1). */
  label: string;
  /** Ein Zeichen für die Zelle, in der der volle Text nicht steht. Zweiter Kanal dort. */
  kuerzel: string;
}

/**
 * Warnstufe als **Fläche der Gefahrenmatrix** (LFH-368 · B5h; früher
 * `pages/gefahren/gefahrenSchema.ts:warnstufeFarbe`).
 *
 * FÜNF STUFEN AUF DREI FARBTÖNE, unterschieden durch die INTENSITÄT derselben Rolle
 * und durch {@link Flaechendarstellung.kuerzel}. Damit hält die Festlegung bei
 * {@link warnstufeKarte} („nicht eine sechste Farbe") auch hier, wo fünf Flächen
 * gebraucht werden.
 *
 * `keine` ist leer und NICHT `alarm` wie auf der Karte: dort steht ein unbewertetes
 * Gebiet (⇒ vorsichtshalber Gefahr), hier bedeutet die Stufe ausdrücklich „für dieses
 * Schutzobjekt besteht keine Gefahr". Eine Matrix, in der 58 unbewertete Zellen rot
 * stehen, zeigt nichts an.
 */
export const warnstufeFlaeche: Record<Warnstufe, Flaechendarstellung> = {
  keine: { fuellung: null, label: 'keine', kuerzel: '–' },
  niedrig: { fuellung: 'achtungFuellung', label: 'niedrig', kuerzel: 'N' },
  mittel: { fuellung: 'achtungFuellungStark', label: 'mittel', kuerzel: 'M' },
  hoch: { fuellung: 'alarmFuellung', label: 'hoch', kuerzel: 'H' },
  akut: { fuellung: 'alarmFuellungStark', label: 'akut', kuerzel: 'A' },
};

/**
 * Fläche → Farbwert des aktiven Modus.
 *
 * Folgt dem `marke`-Zweig in {@link rollenFarbe}, nicht dem antd-Zweig: `antdToken()`
 * bildet die Füllungsrollen auf KEINEN antd-Token ab, ein `token.colorXxx` gibt es
 * hier also nicht. Der Modus kommt deshalb über {@link istDunklerModus} — dieselbe
 * Helligkeitsprobe, mit demselben Verhalten bei fremdem Theme (Rückfall auf Hell,
 * statt zu werfen).
 */
export function flaechenFarbe(w: Warnstufe, token: GlobalToken): string {
  const rolle = warnstufeFlaeche[w].fuellung;
  if (rolle === null) return 'transparent';
  return (istDunklerModus(token) ? farbenDunkel : farbenHell)[rolle];
}
