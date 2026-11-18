# Design

## Context

Zeitpunkte bildet der Kern `anzeige/zeitDarstellung.ts` mit drei Rollen und einem Wächter
(`zeitDarstellung.guard.test.ts`, nur Format-Strings mit `HH`/`mm`/`DD`/`YYYY`). Dauern, die Uhr im
Kopf und der Datenstand sind davon ausgenommen (E2 aus LLH-1045).

Bestand vom 17.11.2026 (Scope-Lauf):

| Helfer | Form heute | Aufrufer (Auswahl) |
|---|---|---|
| `einsatz/einsatzDauer.ts:einsatzDauer` | `05:01 h`, `2 d 14:20 h` | Fuß „Einsatzdauer“, Einsatzbericht |
| `pages/lage-dashboard/lagebild.ts:einsatzdauer` | `5:01` + Einheit `h`, `26:05` | Kennzahl Einsatzdauer, Großbild |
| `abloesung/dauer.ts:formatDauer` (+ `parseDauer`) | `7:30 h`, `8 h`, `45 min` | Ablösung, Schichtmodelle, Planung, Grenzwerte, Schichtplan-Druck |
| `kraefte/zeitachse.ts:dauerText` | `7 h 40`, `40 min` | Meldebild, Personal, Einheit, BR, Einsatzbericht |
| `lagebesprechung/lagebesprechungZustand.ts:dauerText` | `2 h 05 min` | Lagebesprechung, Ablösungskarte, Überblick, Lagemonitor, Meldebild |
| `pages/uhs/dringlichkeit.ts:wartezeitText` | `1 h 05 min` | UHS |
| `anzeige/abstand.ts:formatVor` | `vor 3 h 5 min` | Sichtung, Patientenkopf, Nachforderung, Spiegel, Lagemonitor |
| inline | `301 min`, `noch 5 h`, `Ereignis vor 1 h 5 min` | `lage/wasBrennt.ts`, `geraet/GeraeteKopf.tsx`, `etb/schnellerfassungModell.ts` |

Der Server schreibt `13:30 h` im Schichtplan-Export (`src/abloesung/schichtplan/ausgabe/plan.rs:dauer_text`,
eine Kopie von `formatDauer`). In die gespeicherten ETB-Texte schreibt `rhythmus_text`
(`src/abloesung/mod.rs`) bereits „6 h 30 min“.

Uhren: Die Kopfleiste nutzt `formatiereUhr` mit `HH:mm` in der Gerätezone. Der Lagebild-Titel nutzt
`lagebildZeit`, das ist `zeitKurz(Date.now())` in der Anzeigezone. Für den Datenstand gibt es drei
Wege: `components/Datenstand.tsx` (absolut), `lagebild.ts:standText` (relativ, ab 1 h absolut) und
den Lagemonitor (beides).

## Goals / Non-Goals

**Goals:**
- einen Kern für Dauern und relative Angaben, wie es ihn für Zeitpunkte gibt, dazu einen Wächter
  mit leerer Schuldmenge am Ende der Change
- eine Uhr für Kopf, Lagemonitor und Großbild
- einen Datenstand-Baustein für alle Seiten, das Alter nur, wo verlangt

**Non-Goals:**
- Zeitpunkte (Rollen `zeitpunkt`, `zeitKurz`, `uhrzeit`) bleiben unverändert.
- Schwellwert-Texte mit festen Konstanten bleiben: „alle 6 h“, „7 Tage“, „Uhr geht 3 min nach“,
  „Uhr weicht um 12 s ab“. Das sind Einstellungen bzw. Messwerte mit Sekunden, keine Dauern der Lage.
- `auth/SitzungsListe.tsx:zuletztText` bleibt im 5-min-Raster des Servers. Es nimmt aber den Kern
  für „vor …“ und behält nur seine eigene Schwelle.
- Gespeicherte ETB-Einträge werden nicht umgeschrieben.

## Decisions

**D1 Kern `anzeige/dauer.ts` mit drei Funktionen.**
- `dauer(minuten, { tage?: boolean })` liefert „45 min“, „8 h“, „5 h 01 min“, mit `tage` ab 24 h
  „2 d 14 h“. Die Funktion rechnet mit ganzen Minuten, abgerundet wie bisher.
- `relativ(minuten, vorwort)` liefert „vor …“ / „seit …“ / „in …“ / „noch …“. Unter einer Minute
  steht „gerade eben“ bzw. „in < 1 min“. Tage zeigt es immer ab 24 h. `vorText(zeit, jetzt)`
  liest dazu einen Wire-Zeitpunkt oder eine Epoche, `dauerAusgeschrieben` liefert den zugänglichen
  Namen („5 Stunden 12 Minuten“).
- `dauerZwischen(beginn, ende, jetztMs)` ersetzt `einsatzDauer` (Wire-Strings als UTC lesen) und
  zeigt die Tage.

Die alten Helfer verschwinden und werden nicht als dünne Hüllen behalten. `formatVor` zieht als
`vorText` in den Kern um. `parseDauer` bleibt in `abloesung/dauer.ts`, weil es eine Eingabe ist,
lernt aber die Form „7 h 30 min“ bzw. „7 h 30“.
*Alternative:* die sieben Helfer behalten und nur ihren Rumpf auf den Kern umlenken. Verworfen,
denn dann bleiben sieben Namen für eine Sache, und der Wächter muss sie alle kennen.

**D2 Tage nur für die Einsatzdauer des Einsatzes und für relative Angaben.**
Kräfte-Dauern stehen neben Höchstdienst und Mindestruhe in Stunden. „1 d 02 h“ neben „12 h“ zwänge
zum Umrechnen. Der Kopf der Kräfte-Zeitachse begründet „keine Tage“ schon heute mit dem Lagevortrag.
Rhythmus und Grenzwerte sind eingestellte Längen und laufen deshalb ebenfalls in Stunden weiter
(„167 h 59 min“). Das präzisiert die Abstimmung vom 17.11.2026 („ab 24 h 2 d 14 h“) und wird am
Freigabe-Checkpoint vorgelegt.

**D3 Die Kennzahl Einsatzdauer im Lagebild bleibt eine Zahl mit Einheit.**
Die Kennzahl trennt Wert und Einheit (`5:01` + `h`). In der neuen Form ist der ganze Text der Wert:
„5 h 01 min“ ohne gesonderte Einheit, ab 24 h „2 d 14 h“. Mono mit Tabellenziffern bleibt.
*Alternative:* Wert „5 h 01“ mit Einheit „min“. Verworfen, das liest sich als Minutenangabe.

**D4 Uhr: `formatiereUhr(ms, konv)` in `anzeige/zeitDarstellung.ts`.**
Die Uhr nimmt die Rolle `uhrzeit` in der wirksamen Darstellung, rechnet aber in der Gerätezone, wie
`Datenstand` (Zone `null`). Die Kopfleiste liest die Darstellung aus `useAnzeigeKonventionen()`.
Ohne Einsatz (AppLayout) gilt Gerät vor Organisation vor Vorgabe. Die Ausnahme `formatiereUhr` im
Wächter entfällt. Lagemonitor und Großbild verwenden denselben `Uhr`-Baustein. `lagebildZeit`
fällt weg. Außerhalb eines Einsatzes legt `AppLayout` den `OrgAnzeigeProvider` um die Uhr
(Gerät vor Organisation vor Vorgabe, dieselbe Abfrage wie die Einsatzliste). Gekoppelte Geräte
und der Lagemonitor haben bewusst keinen Einsatz-Provider (`frontend/src/geraet/AGENTS.md`, 403
auf `/einstellungen`); ihre Uhr folgt der Gerätewahl vor der Vorgabe.

**D5 Datenstand: ein Baustein mit Option `alter`.**
`components/Datenstand.tsx` bekommt `alter?: boolean`. Damit erscheint ab 1 min „· vor 2 min“ über
`relativ`, getaktet mit `useMinutenTakt`; das reicht für Minuten. Das Lagebild, beide Großbilder
und der Lagemonitor nehmen den Baustein. `standText` entfällt. Damit bekommt das Lagebild die
Offline-Marke, die `Datenstand` schon führt. Der Lagemonitor behält seine Marke „Veraltet“ ab 2 min
(Spec `lagemonitor`) und setzt sie vor den Baustein. Die Reihenfolge lautet
„Stand 1731 · vor 2 min · offline“.

**D6 Wächter `anzeige/dauer.guard.test.ts` nach dem Muster von `zahl.guard`.**
Er durchsucht Quelltext außerhalb von `anzeige/` auf
- Template-Literale, die eine Interpolation direkt mit ` min`, ` h` oder ` d` verbinden
  (`/\$\{[^}]+\}\s?(min|h|d)\b/`),
- Vorwörter vor einer Interpolation (`/(vor|seit|noch|in) \$\{[^}]*(min|minuten|stunden)/i`).

Eine Liste `AUSNAHMEN` nennt Konstanten und Einstellungen samt Begründung. Die Schuldmenge `OFFEN`
startet mit dem Bestand und ist am Ende der Change leer. Was der Wächter nicht sieht (Text ohne
Interpolation, Rust), steht im Kopf der Datei.

**D7 Server: `dauer_text` in `src/zeitdarstellung.rs`.** Die Restzeit einer Gerätekopplung
bleibt in ganzen Stunden abgerundet („noch 5 h“, Spec `feldgeraet-bedienung`, LLH-1734); das ist
eine gültige Form der Dauer, gebildet über `relativ`.

Eine Funktion `dauer_text(minuten)` mit derselben Form wie der Kern im Frontend (ohne Tage, weil
nur Längen). `plan.rs` und `abloesung::rhythmus_text` rufen sie auf. Ein gemeinsamer Satz
Testfälle (Rust-Test plus Vitest mit denselben Paaren) hält beide Seiten gleich. `rhythmus_text`
schreibt danach Minuten zweistellig („6 h 05 min“ statt „6 h 5 min“); geschriebene ETB-Einträge
bleiben, wie sie sind.

## Risks / Trade-offs

- [Die Rhythmuszeile wird breiter: „167 h 59 min“ statt „167:59 h“, und die Spec verlangt eine Zeile
  bei 390 px] → Der bestehende Komponententest bzw. e2e-Fall für diese Zeile läuft mit dem neuen
  Wert. Reicht der Platz nicht, kürzt die Zeile weiter nur das Quellenwort. Das erlaubt die Spec schon.
- [Spalten mit „2 h“ und „7 h 40 min“ werden ungleich breit] → Tabellenziffern und Rechtsbündigkeit
  wie bisher. Die Form ist entschieden.
- [Viele Tests prüfen die alten Texte wörtlich] → Sie werden mit dem Aufrufer umgestellt, je Gruppe
  in tasks.md.
- [e2e `lagebild-offline.spec.ts` liest fünf Zeichen nach „Stand “] → Der Test liest künftig die
  Uhrzeit per Muster.
- [LLH-1748 baut parallel in `lagebild.ts`] → Diese Change ändert dort nur Form und Stand. Bei einem
  Konflikt `alpha` mergen, nicht rebasen.
- [Anwenderdoku-Bilder zeigen alte Uhr und alte Dauern] → Die betroffenen Bilder per Bildlauf
  neu aufnehmen (`docs/anwender/AGENTS.md`).

## Migration Plan

Keine Daten und keine Schnittstelle. Gespeicherte ETB-Texte bleiben. Rückweg: den Commit
zurücknehmen.
