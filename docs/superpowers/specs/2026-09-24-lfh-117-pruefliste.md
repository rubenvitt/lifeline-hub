# Prüfliste Einsatztauglichkeit — ETB-Anhänge (LFH-117)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder umgebauten Seite. Planung und Spec liegen in
`openspec/changes/lfh-117-etb-anhaenge/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | `/einsaetze/:id/etb` (Schnellerfassung mit „Anhang", Dateiliste, Zeitachse mit Download-Verweisen) · Sprungpalette, Vorschau eines ETB-Eintrags |
| Stand | Code-Stand `60a9ba03` auf `feat/lfh-117-etb-anhaenge` (nach den Fixes aus Review C1); die Prüfliste ist der Commit danach. Erste Fassung am Stand `570ca4e4` |
| Zielkontext | Fükw (1366 px) zum Erfassen mit Datei; Führungs-Tablet (1024 px) in Stufe „Handschuh" zum Erfassen und Laden; mobil nur lesend (die Schnellerfassung ist Bestand, an ihr ändert sich nur die Chip-Leiste) |
| Nicht enthalten | Bildvorschau in der Zeitachse, Offline-Ablage von Dateien, Anhänge in der ETB-Druckansicht, Übernahme aus dem Chat — Nicht-Ziele aus proposal.md |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Schnellerfassung** („Anhang", Dateiliste, Offline-Hinweis, Fortschritt) | `etb/Schnellerfassung.tsx`, `etb/entwuerfe/EtbEntwurfsTabs.tsx` | ja: `e2e/etb-anhang.spec.ts`, `e2e/etb-anhang-pruefliste.spec.ts` |
| **2 · Zeitachse und Palettenvorschau** (Download-Verweis) | `etb/EtbAnhaenge.tsx`, `etb/EtbZeitachse.tsx`, `etb/EtbEintragVorschau.tsx` | ja: dieselben Specs |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → LFH-nnn** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus Quelltext Geschlossenes trägt im Beleg **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/etb-anhang.spec.ts` „erfasst einen Eintrag mit Anhang …" | „Anhang" per KLICK → `filechooser` (mehrfach) → Datei gesetzt → Text → Enter → Verweis „Lagefoto Süd.jpg, …, Anhang zu Nr. 1 herunterladen" in der Zeitachse → Klick löst `download` mit dem Dateinamen aus; derselbe Pfad über einen zweiten Einsatz 404, die generische Route 404, die ETB-Route liefert die Bytes |
| derselbe Spec „ohne Netz …" | `context.setOffline(true)`: „Anhang" gesperrt, Hinweis sichtbar, ein Text-Eintrag steht als „wird gesendet …" |
| `e2e/etb-anhang-pruefliste.spec.ts`, Kontrast (Messkern `kontrast-kern.ts`) | **Tag:** Verweis 7,04 · Dateiliste 16,17 · Offline-Hinweis 11,49 : 1 (Boden 7). **Nacht:** Verweis 10,55 · Dateiliste 16,15 · Offline-Hinweis 11,94 : 1 (Boden 5) |
| derselbe Spec, Stufe „handschuh" (1280 px) | „Anhang" 72 px · Entfernen 72 px · Verweis 72 px (Boden 72, Literal) |
| Gemessene Befunde beim Bau | Verweis zuerst in antds `colorLink`: nachts **4,82 : 1** → jetzt `bedienText` (Regel aus LFH-650). Offline-Hinweis zuerst als `Typography` „secondary": am Tag **5,58 : 1** → jetzt `text2` |
| Sichtprüfung (Bildschirmfotos, lokal erzeugt) | Tag/Nacht × Fükw kompakt / Tablet 1024 px Handschuh: Dateiliste mit `IMG_0412.HEIC · 4 B` und einer 20-MiB-TIFF, „Lädt hoch (1/2) …" am Knopf während des Uploads, Verweise in der Zeitachse, Offline-Hinweis neben dem gesperrten Knopf, Palettenvorschau mit Verweis. Der Pruefliste-Spec hängt dieselben Fotos an seinen Bericht |
| Mutationsproben (Frontend) | Verweis an `hatVerknuepfung` gehängt → Zeitachsen-Test rot (Falle LFH-636); WeakMap-Wiederverwendung entfernt → Teilausfall-Test rot; Leeren der Liste nach Erfolg entfernt → drei Tests rot; Offline-Abweisung entfernt → rot; Verwerfen der Zuordnung bei Ablehnung entfernt → rot; `anhang_ids` im Queue-Eintrag gestrichen → Queue-Test rot |
| Sperrzustände nach Review C1 (Vitest) | „sperrt während des Absendens JEDES Bedienelement der Erfassung ausser ‚Vorschau'" prüft die ganze Erfassung gegen eine Ausnahmeliste (gesperrt: Typ, „Feld", Chip-Aktionen und Chip-Schnellweg, „Werte behalten", „Anhang", Dateieingabe, Entfernen, der Sprung „Als strukturierten Lagebericht erfassen →"; ausgenommen nur „Vorschau" und der ladende Erfassen-Knopf), am Typ `lage`, damit der Sprung mit im Bereich steht; `EtbEntwurfsTabs.test.tsx`: nach Tabwechsel bleiben Feld `readOnly`, „Lädt hoch (1/1) …" und „Anhang" gesperrt, kein zweites Absenden; der sendende Entwurf trägt kein Schliesskreuz; ein Upload-Fehler steht nach dem Tabwechsel mit Grund; nach Erfolg trägt der nächste Eintrag die id des neuen Entwurfs. `EtbZeitachse.test.tsx`/`EtbPage.test.tsx`: „Berichtigen (erst nach dem Senden)" ist gesperrt, solange ein Entwurf sendet; Dateien überleben „Berichtigen" → „Abbrechen", auch ohne Text. `Schnellerfassung.anhaenge.test.tsx`: höchstens 10 bei der Wahl mit Grund, „Anhang" an der Grenze gesperrt mit Satz daneben, eine zu lange Liste lädt nichts hoch; dieselbe Datei nur einmal (Name + Größe + `lastModified`, Gegenprobe mit anderer Änderungszeit) |
| Mutationsproben (Review C1) | Checkbox ohne Sperre → Gesamtsperre-Test rot; Wiederverwenden der geschlossenen Entwurfs-id → client_id-Test rot; Dateien ohne Prop aus `EtbPage` → Berichtigungs-Test rot; Identitätsvergleich statt Name/Größe/`lastModified` → Dubletten-Test rot; `>` statt `>=` an der Wahlgrenze → Grenz-Test rot; Rust: `>=` im Handler → `zehn_anhaenge_gehen_durch` rot; ohne client_id-Suche → Nebenläufigkeitstest mit Anhang rot; ohne Hochladenden-Gate an GET bzw. DELETE → beide Routentests rot |
| Grep über die neuen/geänderten Quellen (ohne Tests) | Farbliterale 0 (Farben aus `rollen`) · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 (`dichte.guard.test.ts` grün) · Emoji 0 (Ikonen `PaperClipOutlined`/`CloseOutlined` in `aria-hidden`-Hülle) |

---

## Tabelle 1 — Schnellerfassung

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | „Anhang" und Entfernen sind antd-`Button` und erben `controlHeight`; gemessen 72 px in „handschuh". Kein handgebautes Bedienziel: die Dateieingabe ist `hidden`, der Knopf ruft sie — antds `Upload` hätte den Knopf in ein zweites `role="button"` mit eigenem Tabstopp gewickelt. Die Sperren aus Review C1 setzen nur `disabled` an denselben antd-Knöpfen, die Höhe bleibt [abgeleitet] | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Siehe 1; kein punktuelles `size` (Guard) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | „Lädt hoch (n/m) …" am Erfassen-Knopf je Datei (Test „meldet den Fortschritt", Sichtbeleg mit 20-MiB-Datei), 120-s-Frist je Datei. Die Rückmeldung ist dateiweise, nicht byteweise: eine einzelne 25-MiB-Datei über Mobilfunk steht lange auf „(1/1)" | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Entfernen einer gewählten Datei ist lokal und umkehrbar (erneut wählen) → keine Rückfrage (LFH-363). Ein erfasster Anhang ist unveränderlich (Spec), es gibt keine Löschaktion | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** | Dateiliste 16,17 / 16,15, Offline-Hinweis 11,49 / 11,94 : 1 (Tag / Nacht, gemessen) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Jede Sperre hat einen Wortlaut neben dem Grau (WCAG 1.4.1): offline der Satz „Anhänge brauchen eine Verbindung. Der Text lässt sich trotzdem erfassen."; an der Grenze „Höchstens 10 Anhänge je Eintrag."; während des Sendens „Lädt hoch (n/m) …" am Erfassen-Knopf (bzw. dessen Ladezustand) — Feld, Typ, „Feld", Chips und „Anhang" sind in dieser Zeit gesperrt; im Zeilenmenü „Berichtigen (erst nach dem Senden)". Upload-, Grenz- und Offline-Fehler stehen als Wortlaut im `Alert` (Tests) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe; der Fehlerhinweis ist `Alert type="error"` (Rot = Gefahr/Fehler, bedient nichts) | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen → LFH-397** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Upload-Fehler stehen AN der Dateiliste und bleiben bis zum nächsten Versuch stehen (kein 3-s-Toast, CLAUDE.md H14), seit Review C1 auch über einen Tabwechsel hinweg (der Hinweis gehört zum Sendezustand des Entwurfs, Test); Wortlaut und Liste bleiben erhalten | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme; kein neues Live-Ereignis | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | [abgeleitet] Liste und Hinweis erscheinen unter der Chip-Leiste nach eigener Handlung (Wählen/Absenden), nie durch ein Live-Ereignis | — |
| 13 | **Fokus nie verdeckt** | **offen → LFH-373** | Die Erfassung ist die stehende Fußleiste der Seite (`.etb-erfassung-sticky`); die Dateiliste macht sie um eine Zeile höher. Ein Tab-Durchlauf durch die Zeitachse hinter der Leiste ist nicht gemessen — derselbe offene Punkt wie in der ETB-Prüfliste | LFH-373 |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Enter sendet mit Dateien wie ohne (Test); Wortlaut und Liste bleiben bei jedem Fehler; „Werte behalten" lässt Von/An/Meldeweg stehen, die Liste geht immer (Test); kein neues Tastenkürzel, die Hinweiszeile ist unverändert (Test); Dateien überleben den Wechsel der Entwurfs-Tabs und eine abgebrochene Berichtigung, nicht den Reload, und gehen nie in den Entwurfsspeicher (Tests). Während des Sendens nimmt die ganze Erfassung keine Änderung an, auch nicht nach einem Tabwechsel; der sendende Entwurf lässt sich nicht schliessen, ein zweites Absenden gibt es nicht, die Entwurfs-id ist die `client_id` (Tests). Höchstzahl 10 und Dubletten prüft schon die Wahl (Tests) | — |

**Bilanz:** 11 erfüllt · 2 offen · 2 nicht anwendbar.

## Tabelle 2 — Zeitachse und Palettenvorschau

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1–2 | **Treffläche / Handschuh** | **erfüllt** | Der Verweis nimmt `verweisStil` (Boden `controlHeight`), gemessen 72 px in „handschuh"; Vitest prüft den gesetzten Stil bei `controlHeight` 72 | — |
| 3 | **Rückmeldung** | **erfüllt** | Download ist ein `<a download>`, die Rückmeldung gibt der Browser | — |
| 4 | **Zweite Handlung** | **nicht anwendbar** | Laden ändert nichts | — |
| 5 | **Kontrast** | **erfüllt** | Verweis 7,04 (Tag) / 10,55 (Nacht) : 1, gemessen gegen den Grund der Zeitachse | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Der Verweis sagt Name, Größe und im zugänglichen Namen die Handlung („… herunterladen"); die Zahl „2 Anhänge" an einer ausstehenden Zeile ist Wort | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau = Bedienung (`bedienText`); kein ↗, weil ein Download nicht navigiert | — |
| 8 | **Regler** | **offen → LFH-397** | App-weit | LFH-397 |
| 9 | **Blickfeld** | **erfüllt** | Die Anhänge stehen in der Hinweiszeile des Eintrags, auch ohne jede Kopplung (Test gegen die Falle aus LFH-636) | — |
| 10–11 | **Alarm / Warnung** | **nicht anwendbar** | Keine Alarme, kein Blinken, kein Ton; ein Verweis warnt nicht | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | [abgeleitet] Kein neues Live-Ereignis; ein Eintrag kommt mit seinen Anhängen, die Zeitachse friert wie bisher ein | — |
| 13 | **Fokus nie verdeckt** | **offen → LFH-373** | Siehe Tabelle 1 | LFH-373 |
| 14 | **Tabellenseite** | **nicht anwendbar** | Zeitachse, keine Tabelle | — |
| 15 | **Erfassungsmaske** | **nicht anwendbar** | Lesefläche | — |

**Bilanz:** 8 erfüllt · 2 offen · 5 nicht anwendbar (Mehrfachzeilen einzeln gezählt).

## Was ausdrücklich nicht behauptet wird

- Die Palettenvorschau ist nur per Bildschirmfoto und Vitest belegt, ihr Kontrast nicht
  eigens gemessen; sie nimmt dasselbe Bauteil mit derselben Farbrolle wie die Zeitachse.
- Der Verweis liegt am Tag mit 7,04 : 1 knapp über dem Boden. Eine Änderung an
  `bedienText` oder am Zeitachsengrund färbt `etb-anhang-pruefliste` rot, nicht still.
- HEIC ist als Datei angenommen und ladbar; eine Darstellung im Browser gibt es nicht (keine
  Bildvorschau, Nicht-Ziel).
- Die Sperrzustände aus Review C1 sind per Vitest belegt, nicht per Bildschirmfoto und nicht
  im Browser gemessen. Der Satz „Höchstens 10 Anhänge je Eintrag." nimmt dieselbe Rolle
  (`text2`) auf demselben Grund wie der gemessene Offline-Hinweis; sein Kontrast ist daraus
  [abgeleitet], nicht eigens gemessen.
- Ein Chip-Editor, der beim Absenden schon offen war, ist nicht gesperrt. Enter sendet aus
  ihm nicht (die Sendetaste greift nur ohne offenen Editor), ein Klick auf „Erfassen" aber
  schon; sein Übernehmen steigt während des Sendens früh aus, und nach dem Erfolg schliesst
  der Editor, ohne dass sein Wert mitging. Das Verhalten nach dem Erfolg ist Bestand, keine
  Folge von LFH-117.
- Ein Entwurf, der nur Dateien trägt, wird beim Wählen gesichert, damit er eine
  Berichtigung überlebt. Tippt man danach Text und löscht ihn wieder ganz, entfernt das
  leere Aktualisieren den Entwurf wie bisher aus dem Speicher, und die Dateien hängen nach
  der nächsten Berichtigung an keinem Reiter mehr. Nicht gemessen, nicht gelöst.
- Ein Upload-Fehler bleibt über einen Tabwechsel stehen, nicht über eine Berichtigung: der
  Sendezustand liegt in `EtbEntwurfsTabs`. Während des Sendens ist „Berichtigen" gesperrt;
  nach einem Fehler nicht mehr, und dann geht der Hinweis mit dem Wechsel.
- Die Bildschirmfotos der Sichtprüfung sind nicht eingecheckt; der Spec erzeugt sie bei jedem
  Lauf als Anlage seines Berichts neu.
