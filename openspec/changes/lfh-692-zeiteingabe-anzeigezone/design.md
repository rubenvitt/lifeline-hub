# Design

## Context

Motivation: siehe `proposal.md` (Why). Bestand (Inventur am 01.10.2026):

- **Anzeige** läuft über `anzeige/format.ts:inZone(utc, konventionen)` mit dem Hook
  `useAnzeigeKonventionen()`. Der Provider `EinsatzAnzeigeProvider` hängt nur einmal in
  `einsatz/EinsatzLayout.tsx` um das `<Outlet/>`. Außerhalb (`/einsaetze`, `/admin/…`,
  `AlarmZentrale`) liefert der Hook die Defaults (`zeitzone: null` → Browserzone).
- **Eingabe:** 23 Stellen, alle `DatePicker showTime` bzw. ein `RangePicker`. Es gibt weder
  `TimePicker` noch reine Datumsfelder. Der Hinweg läuft über `.local()`, verteilt auf
  `etb/filterZeit.ts:alsOrtszeit`, `EinsatzdatenPage:wireZuPicker`,
  `stab/lagebesprechungZustand.ts:terminZeitpunkt` und mehrere Inline-Stellen. Der Rückweg läuft
  über `.utc().format(…)`, verteilt auf `alsBackendZeit`, `pickerZuWire` und drei Kopien von
  `dayjsZuWire`. Nirgends wird eine Wanduhrzeit in einer bestimmten Zone gelesen.
- **antd 6 und dayjs:** antds `generateConfig` erzeugt „jetzt“, „heute“ und neue Panel-Daten mit
  `dayjs()`, also browserlokal. Ein Dayjs im tz-Modus trägt einen festen `$offset`, den
  `.add`/`.set` über eine Sommerzeitgrenze nicht nachführen. Gibt man antd tz-Objekte, entstehen
  dort neue Versatzfehler.
- **Tests** laufen unter `TZ=Europe/Berlin` (`scripts/check-all.sh`). Ist die Anzeigezone
  ebenfalls Berlin, ist jeder Zonentest trivial grün. Scharf wird er erst, wenn Browser- und
  Anzeigezone verschieden sind. Node übernimmt `process.env.TZ` auch zur Laufzeit; das Muster
  steht in `pages/LageberichtDetailPage.test.tsx`.

## Goals / Non-Goals

**Goals:**

- Es gibt eine einzige Stelle, die Zeitpunkte zwischen Picker und Zone wandelt. Alle 23
  Eingabestellen nutzen sie.
- Formularwerte bleiben absolute Zeitpunkte. Validatoren (`isAfter(dayjs())`), Schnellwahlen
  (`.add(30, 'minute')`) und der Rückweg (`.utc()`) bleiben dadurch unverändert korrekt.
- Ein Guard verhindert, dass neue Picker oder `.local()`-Wandlungen am Baustein vorbeigehen.

**Non-Goals:**

- Die Uhr der Kopfleiste bleibt bewusst Browserzeit (Kommentar `Kopfleiste.tsx`), ebenso der
  „Datenstand HH:mm“ (`components/Datenstand.tsx`): er steht neben dieser Uhr und sagt, wie alt
  die geladenen Daten sind — zwei Gerätezeiten, die einander widersprächen, wenn nur eine wechselte.
- Wire-Format und Backend bleiben unverändert.
- antds Markierung „heute“ im Kalenderpanel (siehe Risiken).
- Reine Anzeigestellen, die schon über `inZone` laufen, werden nicht angefasst.
- Reine Anzeigen OHNE gepaarte Eingabe, die die freien Formatierer ohne Konventionen rufen
  (Lagekarte-Historie, Chat, Nachforderungen), stehen in LFH-913. Mitgenommen sind nur die Karten
  zu den hier umgestellten Formularen (Auftrag, Erinnerung, Meldung, Quittung) und Zeiten, die in
  gespeicherte Texte wandern (Kräfte-Stand im Lagebericht, ETB-Textbausteine).

## Decisions

### D1 Wandlung nur an der Picker-Grenze, Formularwert bleibt Zeitpunkt

Zwei Bausteine in `anzeige/`: `ZeitpunktEingabe` (für `DatePicker showTime`) und
`ZeitraumEingabe` (für `RangePicker showTime`). Ihre `value`/`onChange` tauschen **absolute
Zeitpunkte** (`Dayjs`, Modus egal) aus. Nur nach innen, zum antd-Picker, wird gewandelt:

- **hinein:** `zuWanduhr(zeitpunkt, zone)` ist ein browserlokales Dayjs, dessen Uhrzeit die
  Wanduhrzeit der Anzeigezone ist (`dayjs(inZone(…).format('YYYY-MM-DD HH:mm:ss'))`).
- **heraus:** `ausWanduhr(wanduhr, zone)` liest die Wanduhrzeit in der Zone
  (`dayjs.tz(wanduhr.format('YYYY-MM-DD HH:mm:ss'), zone)`) und gibt einen Zeitpunkt zurück.

Den Kern bilden reine Funktionen in `anzeige/zeitEingabe.ts` mit eigenem Test, darüber liegt
ein Hook `useZeitEingabe()`, der die Zone aus `useAnzeigeKonventionen()` liest.

*Verworfen:*

- **(a) tz-Dayjs direkt an antd geben.** Panel-Navigation über eine Sommerzeitgrenze verschiebt
  um eine Stunde (fester `$offset`), und antds „jetzt“ bleibt lokal.
- **(b) Formulare speichern Wire-Strings und das Feld wandelt** (Muster
  `LagedatenFelder` mit `getValueProps`/`normalize`). Damit müssten alle Validatoren,
  Schnellwahlen und Vorbelegungen auf Strings umgebaut werden. Das ist deutlich mehr Fläche,
  und die Formularwerte wären keine Dayjs mehr.
- **(c) Browserzone behalten und benennen** (Alternative aus dem Ticket). Am Checkpoint vom
  01.10.2026 verworfen: Karte und Dialog zeigten weiter verschiedene Zahlen.

### D2 Unverändertes Speichern ist am Bau ausgeschlossen

Der Baustein ruft `onChange` nur bei einer Eingabe der Person. Ohne Eingabe bleibt der
Formularwert der beim Öffnen gelesene Zeitpunkt. Damit liefern bestehende Diff-Logiken
(Verpflegung `normalisiert`, `gleicherZeitpunkt` in den Einsatzdaten, `fristModell`) weiter
„unverändert“. Der Hinweg zum Öffnen ist `dayjs.utc(wire)` und nicht mehr `.local()`. Für die
Gleichheit ist der Modus egal, denn verglichen wird am Zeitpunkt.

### D3 „Jetzt“ und Zonenhinweis im Panel-Fuß

Der Baustein schaltet antds `showNow` ab, weil es browserlokal wäre. Stattdessen setzt er in
`renderExtraFooter` einen eigenen Knopf „Jetzt“, der `dayjs()` als Zeitpunkt setzt. Weicht die
Zone ab (`Intl.DateTimeFormat().resolvedOptions().timeZone` gegen die effektive Zone), nennt der
Baustein die Zone zweimal:

- im Panel-Fuß,
- als `prefix`-Text am Feld (bleibt anders als das Suffix auch unter dem Löschkreuz stehen), damit
  sie auch bei geschlossenem Panel sichtbar ist.

Stimmen die Zonen überein, wird nichts gerendert.

### D4 Tagesgrenzen

`disabledDate` bekommt von antd Wanduhr-Dayjs. Der Baustein bietet dafür die Prop
`keineZukunftstage`. Sie vergleicht den Kalendertag der Wanduhr mit „heute“ in der Anzeigezone,
und dieses „heute“ ist ebenfalls Wanduhr. Die Prop ersetzt die beiden handgeschriebenen
`disabledDate` in `KraftZeitachse` und `BetreuungDialoge`. `kommunikation/gruppierung.ts:faelligGruppe`
bekommt die Konventionen als Parameter und rechnet „heute“ über `inZone`.

### D5 Zone außerhalb eines Einsatzes

- `AnzeigeKonventionenContext` bekommt einen zweiten Provider, `OrgAnzeigeProvider`. Er lädt
  `ladeOrgEinstellungen()` unter dem bestehenden Query-Key `globalKeys.orgEinstellungen`, den auch
  die Einstellungsseiten nutzen (kein zweiter Abruf). Bei 403 oder einem
  Fehler fällt er still auf die Defaults zurück, also auf die Browserzone. Der Endpunkt erlaubt
  nur Admin oder Führungskraft, und das sind genau die Rollen, die Einsätze anlegen oder die
  Archivakte sehen.
- Der Provider hängt an `pages/EinsaetzePage.tsx`.
- Die Archivakte (`aufbewahrung/ArchivAktePage.tsx`) bekommt den `EinsatzAnzeigeProvider` ihres
  Einsatzes. Dessen Antwort trägt `org_defaults` schon mit, Einsatz geht also vor Organisation.
  Wird sie verweigert, gilt die Kette Org-Provider → Browser.
- `AlarmZentrale` rückt in `EinsatzLayout` unter den Einsatz-Provider.

### D6 Alte Helfer

- `alsBackendZeit` bleibt der eine Rückweg (`Dayjs` → Wire). Es liegt künftig in
  `anzeige/zeitEingabe.ts`, und `etb/filterZeit.ts` reicht es nur weiter.
- `alsOrtszeit` wird `alsZeitpunkt` (`dayjs.utc(s)`, ohne `.local()`, Ungültiges weiterhin
  `undefined`).
- `wireZuPicker`/`pickerZuWire` und die `dayjsZuWire`-Kopien entfallen zugunsten von
  `alsZeitpunkt`/`alsBackendZeit`.
- `terminZeitpunkt` verliert sein `.local()`. Seine Aufrufer vergleichen nur Zeitpunkte. Wo einer
  formatiert, geht das über `inZone`.

### D7 Guard

`anzeige/zeitEingabe.guard.test.ts` durchsucht `src/` ohne Tests:

- Ein Import von `DatePicker` aus `antd` außerhalb von `anzeige/` ist rot.
- `.local()` außerhalb von `anzeige/format.ts` ist rot. Ausnahmen werden namentlich mit Grund
  gelistet, etwa die Uhr der Kopfleiste, falls sie darauf läuft.

Dazu kommt eine Regel in `frontend/AGENTS.md` (Abschnitt Inline-Bearbeitung, ersetzt den Verweis
auf `wireZuPicker`/`pickerZuWire`).

### D8 Tests gegen die Akzeptanzkriterien

- **Kern (`zeitEingabe.test.ts`):** läuft unter `process.env.TZ='UTC'` mit Anzeigezone
  Europe/Berlin und prüft Hin- und Rückweg, beide Umstellungen und „jetzt“. Zur Gegenprobe
  laufen dieselben Fälle unter Berlin mit Anzeigezone UTC.
- **Integration:** Verpflegung-Dialog unter TZ=UTC. Der Bearbeiten-Dialog zeigt die
  Kartenzeit, Speichern ohne Änderung sendet keinen Zeitraum, eine Korrektur sendet den
  richtigen UTC-Zeitpunkt.
- Die Einsatzdaten-Zeile bekommt dieselbe Probe.
- **Modulstellen:** Jede umgestellte Stelle bekommt mindestens einen Test, der unter
  abweichender Zone rot würde. Das zeigt eine Mutationsprobe: der Baustein wird auf `.local()`
  zurückgedreht, und der Test muss rot werden.

## Risks / Trade-offs

- **[Wanduhr existiert in der Browserzone nicht]** Ein Beispiel: Anzeigezone Berlin, Browser
  New York, und 02:30 fällt auf den US-Umstellungstag. Ein lokales Dayjs kann diese Uhrzeit
  nicht darstellen. → Der Fall ist sehr selten (zwei Zonen mit verschiedenen Umstellungstagen
  und genau diese Stunde). `zuWanduhr` prüft das per Rundweg-Test und fällt sonst auf die
  nächste darstellbare Minute zurück. Ein Test pinnt das.
- **[Doppelte Stunde im Oktober]** Für 02:30 am 25.10. gibt es in Berlin zwei Zeitpunkte.
  `dayjs.tz` wählt einen davon. → Unverändertes Speichern ist davon nicht betroffen (D2), nur
  eine aktive Eingabe in genau dieser Stunde. Der Fall wird im Test festgehalten, nicht
  verhindert.
- **[antds Hervorhebung „heute“]** Das Panel markiert den lokalen Kalendertag. → Die
  Abweichung ist nur kosmetisch, und auch nur an einem Tageswechsel. Hingenommen; Wahl und
  Sperrung laufen über D3/D4.
- **[Großer PR über 23 Stellen]** → Die Gruppen in `tasks.md` sind je Modul abgeschlossen und
  einzeln testbar. Der Guard verhindert einen Mischzustand am Ende.
- **[Org-Einstellungen nicht lesbar]** Für Rollen ohne Leserecht greift die Browserzone (D5).
  → Diese Rollen können weder Einsätze anlegen noch die Archivakte öffnen, der Fall ist also
  praktisch leer.

## Migration Plan

Reine Frontend-Änderung ohne Datenmigration. Gespeicherte Zeitpunkte bleiben gültig, falsch
eingegebene Altwerte werden nicht korrigiert, weil sie nicht erkennbar sind. Zurückrollen
heißt, den PR zurückzunehmen.
