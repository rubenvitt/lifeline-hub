# Prüfliste Einsatztauglichkeit: Kartenverwaltungen mit Spaltenschalter (LFH-374)

Gate 7 der Bedien-Leitlinie. **Umfang:** `karten/OnlineQuellenVerwaltung.tsx` und
`karten/OfflineKartenVerwaltung.tsx` (Admin → Karten → Online-Quellen / Offline-Karten),
dazu die Primitive, die diese Änderung anfasst: `components/KatalogTabelle.tsx` (Opt-in
`spaltenSchalter`) und `components/SpaltenSchalter.tsx` (Zählung und Menü, gemeinsam mit
`Datensicht`). Die Lagekarte gehört nicht zum Umfang. Ihre Zeilen stehen weiter in
`docs/superpowers/specs/2026-07-30-lagekarte-karten-pruefliste.md`.

Die Kartenverwaltungen sind Verwaltungsflächen im Admin-Bereich. Kontext ist der Fükw, selten
das Führungs-Tablet. Im Einsatz werden sie kaum geöffnet.

| #  | Kriterium | Verdikt | Beleg / Zielticket |
| -- | --------- | ------- | ------------------ |
| 1 | Treffläche | **erfüllt** | Der Schalter ist ein antd-`Button` ohne `size` und erbt `controlHeight` vom `ConfigProvider` (30/48/72). Die Menüeinträge sind antd-Menüzeilen (`itemHeight` ← `controlHeightLG`). Neue `size="small"`: 0, `dichte.guard.test.ts` bleibt grün |
| 2 | Handschuh-Modus | **erfüllt für diese Änderung** | Keine feste Höhe, kein festes Maß am Schalter. Die Werkzeugzeile ist eine umbrechende Flex-Zeile (`flexWrap: 'wrap'`, `gap` aus `paddingXS`) und wird bei höherer Stufe höher statt abgeschnitten. Die gerenderte Höhe im Handschuh wird für alle Primitive in **LFH-373** gemessen |
| 3 | Rückmeldung vor der Serverantwort | **nicht anwendbar** | Das Umschalten von Spalten ist rein clientseitig, ohne Request. Die Ladezustände der Tabellen bleiben unverändert (`isLoading` an beiden) |
| 4 | Kritische Aktion hat eine zweite Handlung | **erfüllt, unverändert** | Die Löschwege (Popconfirm, `okButtonProps.danger`, `size="middle"`) sind nicht angefasst. Die Aktionsspalte ist `immerSichtbar` und lässt sich also nicht wegschalten |
| 5 | Kontrast in beiden Modi | **erfüllt** | Kein neuer Farbwert. Der Zähler steht als Text im Knopfnamen und nicht als `Badge`, das auf `colorError` rendern würde. `theme/gate5.guard.test.ts` ist grün |
| 6 | Kein Status allein über Farbe | **erfüllt** | Der Zähler ist Text („Spalten · 2 ausgeblendet“). Das Häkchen im Menü zeigt die wirkliche Sichtbarkeit (D9) und trägt als Zweitkanal den Spaltennamen |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Keine neue Farbbelegung |
| 8 | Helligkeits-/Kontrastregler | **offen** | Weiterhin keiner in der Anwendung → Folge-Task aus A0 (unverändert zur B5f-Prüfliste) |
| 9 | Kritische Anzeigen im Blickfeld | **nicht anwendbar** | Verwaltungsfläche ohne kritische Laufzeitanzeige |
| 10 | Alarmbudget | **nicht anwendbar** | Die Kartenverwaltungen alarmieren nicht |
| 11 | Warnverhalten | **nicht anwendbar** | Kein Blinken, kein Ton |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** | Die Werkzeugzeile steht, sobald Suche oder Schalter da sind, und erscheint nicht erst beim Eintreffen von Daten. Der Zähler hängt an den Spalten, nicht an den Zeilen. Das 2-s-Polling der Offline-Karten bewegt ihn also nicht. Spalten verschwinden nur auf eine Handlung hin (Klick, Fensterbreite) |
| 13 | Fokus nie verdeckt | **offen** | Die stehende Kopfzeile ist dasselbe Konstrukt wie an allen Katalogtabellen. Ein Tab-Durchlauf auf diesen beiden Routen ist nicht gemessen → **LFH-373** |
| 14 | Tabellenseite vollständig | **erfüllt** | Stehende Kopfzeile, Scrollcontainer und fixierte **menschenlesbare** Kennung (Name, nie die DB-`id`) kommen aus `KatalogTabelle`. **Neu ist der umschaltbare Spaltensatz mit Zähler ausgeblendeter Spalten.** Handauswahl und Breite (`abBreite: 'lg'` an URL/Attribution) laufen durch eine Funktion (`SpaltenSchalter.tsx:sichtbareSpalten`). Belegt durch `OnlineQuellenVerwaltung.test.tsx` („unter lg fallen URL und Attribution weg und zählen, zusammen mit der Handauswahl“: 2, dann 3), `OfflineKartenVerwaltung.test.tsx` („Größe abwählen“, „Attribution von Hand zurückholen“) und `KatalogTabelle.spaltenschalter.test.tsx` („Breite und Handauswahl laufen in EINEN Zähler“, „… die danach auch per Breite wegfällt, zählt einmal“, per Mutationsprobe belegt). **Keine Auflösung in Karten:** `e2e/kartenverwaltung-spaltenschalter.spec.ts` misst bei 390 px eine Tabelle ohne Karten, ohne Überbreite von Tabelle, Werkzeugzeile und Seite (`documentElement.scrollWidth`), mit fixiertem „Name“, und bedient den Schalter per Klick. Dass der Zähler nicht lügen kann, halten zusätzlich die Typsperre plus der Guard gegen antds `responsive`/`hidden` fest (`katalogTabelle.guard.test.ts`) |
| 15 | Erfassungsmaske vollständig | **erfüllt (außerhalb dieser Änderung)** | Der B5f-Befund H69 ist behoben: `OnlineQuelleFormModal` und `OfflineDownloadUrlModal` laufen über `ErfassungsModal` (LFH-376). Diese Änderung fasst sie nicht an |

**0 Zeilen ohne Verdikt:** 9 erfüllt, 4 nicht anwendbar, 2 offen. Jede offene Zeile hat ein Ziel:

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 8 | kein Helligkeitsregler | Folge-Task aus A0 |
| 13 | Tab-Durchlauf unter der stehenden Kopfzeile nicht gemessen | **LFH-373** |

## Was ausdrücklich nicht behauptet wird

- Die sechzehn übrigen Katalogtabellen haben weiterhin **keinen** Schalter. Für sie gilt die
  Ausnahme aus dem Dateikopf von `KatalogTabelle` (alle Spalten sichtbar). Seit dieser
  Änderung steht diese Ausnahme unter einer Bedingung, die maschinell gehalten wird:
  `abBreite` wirkt ohne Opt-in nicht, und `responsive`/`hidden` sind gesperrt.
- Das Tastaturumschalten im Menü (Pfeil, Eingabe) ist für die geteilte Komponente in
  `e2e/datensicht-schmal.spec.ts` belegt, nicht ein zweites Mal an den Kartenverwaltungen.
- Die Handauswahl wird nicht gespeichert und ist nach einem Neuladen weg. Das ist dieselbe
  Lage wie in `Datensicht`.
