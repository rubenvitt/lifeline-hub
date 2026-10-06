# Design

## Context

Das Frontend nutzt `localStorage` an rund 20 Stellen. Die meisten kapseln jeden Zugriff in ein
eigenes `try/catch` (`alarmTon`, `navPersistenz`, `zuletztModule`, `KlappPaneel`,
`unwetterGedaechtnis` u. a.). Drei weichen ab:

- `theme/ThemeModeProvider.tsx` liest Farbschema, Dichte und Helligkeit in den
  `useState`-Initialisierern und schreibt in den drei Settern, alles ungeschützt. Der Provider
  sitzt in `main.tsx` direkt unter `QueryClientProvider`; im Frontend gibt es keine
  Error-Boundary. Ein Wurf beim ersten Render lässt die Seite weiß. Das Bootstrap-Skript in
  `index.html` fängt denselben Zugriff ab und verlässt sich laut Kommentar auf den Provider.
- `anzeige/koordinatenSystemStore.ts` liest in `lies()`, dem `getSnapshot` von
  `useSyncExternalStore`, bei jedem Render ungeschützt. `setzeOverride` schreibt vor
  `listeners.forEach(...)`; wirft das Schreiben, erfährt kein Abonnent von der Wahl.
- `etb/entwuerfe/useEtbEntwuerfe.ts` liest den aktiven Entwurf im async-Effekt und schreibt ihn
  an drei Stellen ungeschützt, zwei davon in einem `setAktiverId`-Updater.

`offline/serveruhr.ts` (LFH-705, D4 dort: `localStorage`, damit alle Tabs dieselbe Messung
sehen) schreibt in `merkeServerzeit` bei jeder Antwort ohne `Cache`-Frische. `gemessenAt` ändert
sich jedes Mal, also ist jeder Aufruf eine echte Änderung und löst in jedem anderen Tab ein
`storage`-Ereignis aus. `serverJetzt()` nimmt die jüngere von Tab-Messung und gespeicherter
Messung, verwirft Messungen älter als 24 h und Abweichungen unter 5 s.

`offline/geraetRaeumung.guard.test.ts` (LFH-767) findet jede Datei, die in `localStorage` oder
`sessionStorage` schreibt, am Muster `…Storage.setItem`, und verlangt einen Eintrag in
`GERAETESPEICHER`.

## Goals / Non-Goals

**Goals**
- Ein gesperrter oder voller Speicher lässt die App nie ausfallen; Einstellungen fallen auf ihre
  Vorgabe zurück, eine Änderung wirkt bis zum Neuladen.
- Ein Ort für den Zugriff, ein Guard, der neue Rohzugriffe verhindert.
- Die Serveruhr schreibt im Dauerbetrieb höchstens etwa einmal je 10 min.

**Non-Goals**
- `sessionStorage`: einziger Nutzer ist `components/erfassungsSitzung.ts`, dort ist jeder Zugriff
  schon mit `globalThis.sessionStorage?.` und `try/catch` geschützt.
- Eine Error-Boundary an der Wurzel. Sie wäre ein eigenes Thema (was zeigt sie, wer meldet).
- Abgleich der Koordinatensystem-Wahl zwischen Tabs. Den gibt es heute nicht, er bleibt aus.
- `index.html`: fängt schon ab; der Kommentar dort stimmt danach wieder.

## Decisions

### D1 Helfer `lib/sichererSpeicher.ts`

```ts
sicherLesen(schluessel: string): string | null
sicherSchreiben(schluessel: string, wert: string): boolean
sicherEntfernen(schluessel: string): boolean
sicherSchluessel(): string[]
```

Jede Funktion holt `globalThis.localStorage` innerhalb des `try` (schon der Getter wirft bei
einem Storage-SecurityError) und fängt jeden Wurf. Rückfall: `null`, `false`, `false`, `[]`.
`sicherSchluessel` liefert alle Schlüssel für die beiden Präfix-Räumer in `entwurfStore.ts`.
Kein Objekt- oder JSON-Wrapper: die Aufrufer prüfen ihre Werte schon selbst
(`istThemeModus`, `alsHelligkeit`, `gueltig` …), ein generischer Parser würde das doppeln.

Alternative: ein Wrapper-Objekt `sichererSpeicher.getItem(...)`. Verworfen, weil der Guard dann
an Methodennamen hängen müsste, die auch `sessionStorage` und Fremdbibliotheken tragen.

### D2 ThemeModeProvider

Die drei `gespeichert…`-Funktionen lesen über `sicherLesen`; ohne Wert gelten die vorhandenen
Vorgaben (`MODUS_DEFAULT` = Nachtbetrieb, `startDichte(null, …)`, `alsHelligkeit(null)`). Die
Setter setzen zuerst den State und schreiben dann über `sicherSchreiben`; der Rückgabewert wird
nicht ausgewertet, die Wahl gilt im Tab ohnehin.

### D3 Koordinatensystem: Wert im Modul bevorzugt

`setzeOverride` merkt die Wahl in einer Modulvariablen (`gewaehlt`, mit Kennung „nicht gesetzt“),
schreibt bzw. entfernt über den Helfer und benachrichtigt danach die Abonnenten, gleich ob das
Schreiben gelang. `lies()` liefert die Modulvariable, sobald sie gesetzt ist, sonst den
gespeicherten Wert. Der Snapshot bleibt ein String oder `null`, also stabil für
`useSyncExternalStore`. Für Tests kommt `koordinatenSystemVergessenFuerTests()` dazu.

### D4 Serveruhr: Schreiben gegen die gespeicherte Messung prüfen

`merkeServerzeit` setzt `imSpeicher` wie bisher bei jeder Antwort. Vor dem Schreiben liest sie
die gespeicherte Messung (`ausSpeicherLesen`, gleich aus welchem Tab) und schreibt nur, wenn

- keine gültige gespeicherte Messung vorliegt, oder
- `|neu.versatzMs − gespeichert.versatzMs| > 1 000`, oder
- `neu.gemessenAt − gespeichert.gemessenAt > 10 min` oder `< 0` (Geräteuhr zurückgestellt).

Geprüft wird gegen den Speicher, nicht gegen die letzte eigene Schreibung: So schreiben sechs Tabs
zusammen etwa einmal je 10 min statt je einmal. Das kostet je Antwort ein `getItem` und ein
`JSON.parse` von rund 60 Byte, ohne `storage`-Ereignis.

`serverJetzt()` bleibt wörtlich gleich. Der eigene Tab hat immer die frischeste Messung im
Speicher des Moduls; ein Tab ohne eigene Antwort sieht eine höchstens 10 min alte Messung, deren
Versatz höchstens 1 s abweicht. Die Rauschgrenze liegt bei 5 s, die Haltbarkeit bei 24 h: Die
Vorbelegung der Ereigniszeit (Spec `ereigniszeit-vorgabe`) ändert sich dadurch nicht messbar.

### D5 Guard `lib/sichererSpeicher.guard.test.ts`

Nach dem Muster von `offline/clientId.guard.test.ts`: Das Wort `localStorage` in Code ohne
Kommentare (`test/ohneKommentare`) außerhalb von `lib/sichererSpeicher.ts` macht den Guard rot,
mit Datei, Zeile und Hinweis auf den Helfer. Tests und `src/test/` sind ausgenommen. Mit dem
Wort fallen auch `window.localStorage`, `globalThis.localStorage` und `Object.keys(localStorage)`
auf. Eine Ausnahmeliste gibt es nicht, der Sweep lässt keine übrig; wer eine braucht, legt sie
mit Begründung im Guard an. Dazu der Selbst-Beweis mit Positiv- und Negativfällen.

Alternative ESLint `no-restricted-globals`/`no-restricted-properties`: verworfen, weil
`no-restricted-globals` `window.localStorage` nicht sieht und die Projekt-Guards dieses Musters
(`clientId`, `useViewport` …) als Vitest laufen.

### D6 Gerätespeicher-Guard erkennt den Helfer

`SCHREIBT` in `offline/geraetRaeumung.guard.test.ts` erkennt zusätzlich `sicherSchreiben(`; der
Helfer selbst ist ausgenommen (er speichert nichts aus eigenem Antrieb). Ohne diese Erweiterung
fiele nach dem Sweep jede Datei aus dem Gerätespeicher-Verzeichnis heraus, und der zweite Fall
des Guards („verzeichnet keine Datei, die nichts speichert“) würde rot. Der Selbst-Beweis bekommt
einen Fall für `sicherSchreiben`.

### D7 Sweep

Jede übrige Stelle wird mechanisch umgestellt: `try { localStorage.getItem(k) } catch {…}` wird
`sicherLesen(k)`, das Schreiben `sicherSchreiben`. Ein `try/catch` bleibt, wo es auch ein
`JSON.parse` schützt. Verhalten und Schlüssel ändern sich nicht. Die Stellen: `alarm/alarmTon`,
`components/direkteinstiegKern`, `einsatz/navPersistenz`, `einsatz/zuletztModule`,
`etb/entwuerfe/entwurfStore`, `etb/entwuerfe/useEtbEntwuerfe`, `geraet/geraetMarke`,
`offline/ereignisse`, `pages/lagekarte/{KlappPaneel,SnapshotLeiste,leistenWahl,zuletztVerwendet}`,
`wetter/unwetterGedaechtnis` sowie D2 bis D4.

## Risks / Trade-offs

- **Der Sweep berührt viele Dateien.** Jede Änderung ist wenige Zeilen und verhaltensgleich; die
  vorhandenen Tests der Speicher laufen unverändert mit.
- **Tests, die `localStorage.setItem` stubben**, um ein Scheitern zu prüfen, greifen weiter, weil
  der Helfer zur Laufzeit dasselbe globale Objekt nutzt.
- **Ein Tab ohne eigene Antwort** stempelt mit einer bis zu 10 min alten Messung. Bei stabiler
  Abweichung ist das gleichwertig; springt die Uhr, schreibt der nächste Tab mit Antwort sofort.
