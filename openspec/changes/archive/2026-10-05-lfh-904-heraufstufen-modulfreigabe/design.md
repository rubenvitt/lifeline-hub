# Design

## Context

Die Gates der Chat-Routen sitzen im Extractor `EinsatzSchreibzugriff<Chat>` (Org-Floor,
Schreibrecht, Modul `chat`, aktiv). Das Heraufstufen schreibt aber in ein zweites Modul. Für solche
Querwege gibt es im Backend schon ein Muster: Die Personenaufnahme mit UHS verlangt zusätzlich
`unfallhilfsstellen` (`src/routes/einsatz_person.rs`, `anlegen`), der Verbleib in einer
Betreuungsstelle verlangt `betreuung`, die Bezirkszuordnung einer Zone ebenfalls `betreuung`
(`src/routes/lage_zone.rs`). Sie rufen dafür im Handler `ctx.fordere_modul_zugriff(pool, key)`.
Im Client sperren Menüs ein Ziel in einem gesperrten Modul schon so: `StellenBlock.tsx` setzt
`gesperrt: true` und hängt `KEINE_BERECHTIGUNG` ans Etikett; die Freigaben kommen aus dem Cache
des Einsatzrahmens (`useModulFreigaben`, Lesart `istSprungGesperrt`: unbekannt heißt offen).

## Goals / Non-Goals

**Goals:**
- Die Entscheidung festhalten: Heraufstufen verlangt die Freigabe des Zielmoduls.
- Server und Chat-Menü folgen ihr gleich.

**Non-Goals:**
- Kein Durchgang durch alle übrigen Querwege zwischen Modulen. Personen, Verbleib und Zonen
  folgen der Regel bereits; „Auftrag erteilen“ aus ETB und Meldungen prüft `auftraege` noch nicht
  und bekommt einen eigenen Nachzug (LFH-1051).
- Keine Änderung am Extractor oder an den Modul-Markern.
- Die Prüfung fremder Dateien beim Verknüpfen im Chat bleibt beim eigenen Nachzug.

## Decisions

**D1 — Ja, das Zielmodul muss frei sein.** Die Modulfreigabe soll sagen, wer im ETB bzw. in den
Aufträgen schreibt. Ein Umweg über den Chat höhlt das aus, und seit LFH-700 trägt er auch Dateien
ins unveränderliche Tagebuch. Die Alternative „Chat-Schreibrecht genügt“ würde eine Ausnahme
schaffen, die keine andere Querroute hat (s. Context), und müsste erklärt werden, wenn eine
Org-Vorgabe das ETB ausdrücklich auf Führungskräfte beschränkt.

**D2 — Zum Auftrag nur `auftraege`, nicht zusätzlich `etb`.** Der Weg gleicht `POST …/auftraege`;
auch dort entsteht die ETB-Anordnung als Nebeneffekt, ohne ETB-Gate. Ein strengerer Chat-Weg wäre
ein zweiter Maßstab für dieselbe Handlung.

**D3 — Prüfung im Handler, als erste Zeile nach dem Extractor.** Wie in den genannten Querwegen
ruft der Handler `ctx.fordere_modul_zugriff(&state.pool, <Marker>::KEY)`, mit den vorhandenen
Markern `Etb` bzw. `Auftraege` statt eines Stringliterals. Vor der Zugehörigkeitsprüfung der
Nachricht, damit ein Nicht-Berechtigter keine Auskunft über Nachrichten-IDs bekommt (403 vor 404)
und keine Daten geladen oder geschrieben werden. Der Body ist dann schon gelesen: ein kaputter
Body ohne Freigabe ergibt 400 statt 403, wie bei den übrigen Prüfungen im Handler. Der Extractor-Typ bleibt `EinsatzSchreibzugriff<Chat>`: Ein zweiter
Marker im Typ wäre ein Umbau des Guards (`tests/einsatz_kontext_guard.rs`) für zwei Routen.

**D4 — Menü: gesperrt mit Grund im Etikett.** `NachrichtenStrom` bekommt zwei Schalter
(`etbGesperrt`, `auftragGesperrt`), die `ChatPage` per `useSprungSperre(einsatzId)` füllt. Ein
gesperrter Eintrag erscheint als `Zu ETB (Keine Berechtigung)` mit `gesperrt: true` (antd
`disabled`), wie in `StellenBlock.tsx`. Ausblenden wäre M16 zuwider: das Fehlen verwirrt mehr als
ein erklärter gesperrter Eintrag. Unbekannte Freigaben lassen den Eintrag offen; der Server
antwortet dann 403, die vorhandene Fehlerbehandlung des Dialogs zeigt das.

## Risks / Trade-offs

- [Laufende Einsätze] Eine Rolle, die bisher über den Chat ins ETB geschrieben hat, kann das nach
  dem Update nicht mehr. → Gewollt (D1); der gesperrte Menüeintrag erklärt es vor dem Klick.
- [Gerätesitzungen] Gekoppelte Geräte bekommen ihre Rolle aus der Ansicht; `fordere_modul_zugriff`
  prüft dieselben Freigaben wie für Personen. → Kein Sonderweg nötig; der Test deckt Personen ab.
