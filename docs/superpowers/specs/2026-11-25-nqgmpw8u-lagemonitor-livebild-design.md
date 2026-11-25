# Lagemonitor-Kachel „Livebild“ – Design

- **Stand:** 25.11.2026 · Zunder LLH-2109 (`https://zunder.rubeen.dev/#/aufgabe/nqgmpw8u15lq7b7a9h2ibjkr`),
  Unteraufgabe von LLH-2116
- **Grundlage:** Konzeptnotiz [`docs/konzepte/2026-11-24-drohnenbild-ueber-suchlage.md`](../../konzepte/2026-11-24-drohnenbild-ueber-suchlage.md)
  (D4, Schritt 6), Design-Doc des Parents
  [`2026-11-24-incls23v-drohnenbild-suchlage-design.md`](2026-11-24-incls23v-drohnenbild-suchlage-design.md)
  (§5.3, §5.5), Phase-1-Checkpoint mit Ruben am 25.11.2026 (Punkte 1a, 2a, 3, 4, 5a, 6, 7).
- **UI-Entwurf:** [`docs/design/2026-11-25-lagemonitor-livebild/`](../../design/2026-11-25-lagemonitor-livebild/README.md)
  (Canvas https://claude.ai/artifact/9bBNFbWPKHxXjnJrfQDEBt).

## 1. Zweck

Das Livebild der Drohne soll auch auf dem Großbild im Stab laufen (D4). Auf dem Bild können
Personen zu sehen sein. Der Lagemonitor zeigt sonst keine Namen und keine Personenkennungen. Das
Bild kommt deshalb nur dann auf den Monitor, wenn die Einsatzleitung es für diesen Einsatz eigens
einschaltet. Standardmäßig ist es aus.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Ein Schalter „Livebild auf dem Lagemonitor“ je zugeschalteter Drohnenquelle, nur für die
  Einsatzleitung, aus als Vorgabe.
- Bei eingeschaltetem Schalter eine Kachel „Livebild“ auf dem gekoppelten Lagemonitor: stumm, ohne
  Bedienung, mit Datenstand, eigene `KachelGrenze`, „Kein Livebild“ ohne Alarm.
- Abschalten wirkt am Monitor binnen Sekunden, nicht erst mit dem nächsten Abruf.
- Wer das Bild auf das Großbild legt oder wegnimmt, steht im ETB.

**Nicht-Ziele**

- Livebild im Lagebild für Externe, in der API v1 oder in anderen Funktionsansichten.
- Mehrere Videos nebeneinander; der Monitor zeigt eines.
- WHEP, Aufzeichnung, Ton.

**Anti-Ziele**

- Das Bild erscheint auf dem Monitor, ohne dass jemand es eingeschaltet hat (auch nicht nach einem
  Neustart, einer neuen Kopplung oder einer neuen Zuschaltung).
- Ein ausgefallener Stream löst Alarm aus oder lässt die übrigen Kacheln ausfallen.
- Eine Kachel schneidet bei 1920 × 1080 ihren Inhalt ab.

## 3. Rahmenbedingungen (Bestand)

- `adapter_einsatz.lagemonitor` (Migration 0373) und `PUT /api/incidents/{id}/drone/sources/{aid}`
  mit `{ lagemonitor: bool }` gibt es seit LLH-2105; `DroneSourceView.lagemonitor` liefert den Wert.
  Die Oberfläche (`pages/lagekarte/DrohnenQuelle.tsx`) sendet bisher immer `false`.
- Der Video-Proxy `GET /api/incidents/{id}/drone/video/{key}/hls/{*file}` (`routes/drohne.rs::video`,
  `EinsatzLesezugriff<Lagekarte>`) prüft Einsatz aktiv und Zuschaltung, nicht den Schalter.
- Der Lagemonitor liest nur `GET …/situation-monitor` (`routes/lagemonitor.rs::lagebild`); seine
  Routenliste ist `geraet::LAGEMONITOR`. Er fragt alle 30 s ab (`ABRUF_TAKT_MS`).
- `DrohnenVideoFenster` an der Lagekarte spielt HLS mit hls.js (dynamischer Import) bzw. nativ in
  Safari, stumm, mit „Kein Livebild“.
- Der Speicher (`drohne::Store`) hält je Adapter den letzten Stand mit `lage.stand_ms` (Zeit des
  Abrufs bei uns) und `lage.videos` (eigene Kennungen).

## 4. Ansätze

Am Phase-1-Checkpoint abgestimmt (Ruben, 25.11.2026):

| Frage | Gewählt | Verworfen |
|---|---|---|
| Ort des Schalters | **a: In der Liste der Drohnenquellen an der Lagekarte**, unter der zugeschalteten Quelle | b: Einsatzeinstellungen – weit weg von der Quelle, die er betrifft |
| ETB | **a: Systemeintrag beim Ein- und Ausschalten** | b: kein Eintrag – nicht nachvollziehbar, wer Personen aufs Großbild gelegt hat |
| Kachelung | **a: links Karte und Livebild übereinander**, rechte Spalte unverändert | b: Karte und Livebild nebeneinander (Bild nur ~310 px hoch); c: Livebild statt Karte (Lage geht verloren) |

Wie der Monitor von den Videos erfährt, war nicht offen: Die Konzeptnotiz legt die Kennungsliste
`drohne.videos` in `situation-monitor` fest; eine eigene Route für den Monitor hätte die Regel
„eine Quelle für die Daten“ ohne Not weiter aufgeweicht.

## 5. Bausteine

### 5.1 Schalter (Frontend)

- `DrohnenQuelle.tsx`: Unter einer zugeschalteten Quelle, zwischen „Livebild“ und „Abschalten“, ein
  antd-`Switch` mit Beschriftung „Livebild auf dem Lagemonitor“ und einer Zeile darunter: aus
  „Aus (Vorgabe): das Großbild zeigt kein Livebild.“, an „Das Großbild zeigt das Livebild; Personen
  im Bild sind dort sichtbar.“ (Wortlaut nach `frontend/AGENTS.md`, „Vorgabe“). Nur bei
  `darfSchalten` (Einsatzleitung); sonst zeigt die Liste den Zustand als Text.
- Der Schalter ruft das bestehende `PUT …/sources/{aid}` mit dem neuen Wert; während der Anfrage
  `loading`, ein Fehler erscheint wie bei Zu- und Abschalten.
- Zuschalten sendet weiter `lagemonitor: false`.

### 5.2 ETB (Backend)

- `routes/drohne.rs::zuschalten`: Ändert sich der Wert gegenüber der bestehenden Zuschaltung, in
  derselben Transaktion ein Systemeintrag „Livebild auf dem Lagemonitor eingeschaltet“ bzw.
  „… ausgeschaltet“. Wird mit `lagemonitor: true` neu zugeschaltet, folgt auf „Drohnenbild aus
  Suchlage zugeschaltet“ der Eintrag „eingeschaltet“. Gleicher Wert erneut gesendet: kein Eintrag.
- `abschalten`: Stand der Schalter an, sagt der bestehende Eintrag es mit
  („Drohnenbild aus Suchlage abgeschaltet“ bleibt, ein zweiter Eintrag entfällt; das Abschalten
  nimmt das Bild ohnehin vom Monitor).

### 5.3 Block `drohne` in `situation-monitor` (Backend)

- `LagemonitorAnzeige` bekommt `drohne: Option<LagemonitorDrohne>` mit
  `skip_serializing_if = "Option::is_none"`; `LagemonitorDrohne { videos: Vec<String>, stand_at: String }`
  (englische Wire-Felder für den neuen Typ nach `AGENTS.md`, „Bezeichner-Sprache“, bis auf den
  Blocknamen, den die Notiz festlegt).
- Nur der Handler `lagebild` füllt ihn, `verdichte` nie (Lagebild für Externe, API v1).
- Gefüllt nur, wenn der Einsatz aktiv ist und eine Zuschaltung mit `lagemonitor = 1` besteht.
  Bei mehreren gilt die zuerst zugeschaltete (`zugeschaltet_at`), wie an der Karte.
- `videos`: die Kennungen aus dem Speicher dieses Adapters (leer, wenn kein Stand oder kein Stream);
  `stand_at`: `lage.stand_ms` im SQLite-Format; ohne Stand der Zeitpunkt der Zuschaltung. Der Block
  steht auch mit leerer Liste da: der Schalter ist an, die Kachel zeigt „Kein Livebild“.
- Ist das Modul `lagekarte` im Einsatz ausgeblendet, fehlt der Block (Muster LLH-2072); eine
  eigene `LagemonitorKachel`-Variante braucht es dafür nicht, weil ohne Block keine Kachel steht.
- Typ-Codegen (`scripts/check-typ-codegen.sh`) und beide generierten Dateien mitcommitten.

### 5.4 Video-Proxy für das Gerät (Backend)

- `geraet::LAGEMONITOR` bekommt `("GET", "/api/incidents/{id}/drone/video/{key}/hls/{*file}")`.
  Keine andere Funktionsansicht bekommt die Route.
- `routes/drohne.rs::video`: Ist der Aufrufer ein Gerät, muss die Zuschaltung des Adapters
  `lagemonitor = true` tragen, sonst 404. Personen bleiben wie heute (Zuschaltung genügt).
- Weil die Playlist nur 1 s gebündelt wird, bricht das Bild nach dem Ausschalten binnen weniger
  Sekunden ab; der nächste Abruf von `situation-monitor` nimmt dann die Kachel weg.
- Der Test der Routenlisten (`geraet/mod.rs`) prüft: Lagemonitor darf die Route, jede andere Ansicht
  nicht.

### 5.5 Kachel und Kachelung (Frontend)

- Neuer Baustein `geraet/LagemonitorLivebild.tsx`: Kachel „Livebild“ mit Datenstand rechts in der
  Titelzeile (Großbild-Schrift; älter als 2 Minuten nach `istVeraltet` in der Achtungsfarbe),
  darunter das Bild in 16 : 9 auf Schwarz, `muted`, `autoPlay`, `playsInline`, ohne `controls`.
  Wiedergabe über denselben Weg wie `DrohnenVideoFenster` (hls.js oder nativ). Das Abspielen
  ziehen wir dafür in einen gemeinsamen Hook (`pages/lagekarte/useHlsWiedergabe.ts` o. ä.), statt es
  zu kopieren.
- „Kein Livebild“: wenn `videos` leer ist oder der Player aufgibt; ein neuer Versuch, sobald eine
  Kennung (wieder) da ist oder der nächste Datenstand kommt. Kein Eintrag in „Was brennt“, keine
  Alarmfarbe.
- Eigene `KachelGrenze` in Form `gross`, Neuversuch mit dem nächsten Datenstand.
- Kachelung nach dem Entwurf: in der linken Spalte unter der Karte eine Zeile von 440 px mit der
  Kachel „Livebild“ (734 px breit) und rechts daneben „Sofortmeldungen“ über „Ablauf“. Fehlen
  beide, nimmt „Livebild“ die Zeile allein (Bild mittig). Ohne Block `drohne` bleibt alles wie heute.
- Beim Monitor die `pointerEvents: 'none'` der Kacheln gilt auch für das Video.

### 5.6 Regel (E2)

`frontend/src/geraet/AGENTS.md`, Abschnitt Lagemonitor, wird fortgeschrieben: Neben
`situation-monitor` gibt es eine zweite Quelle, das Medium aus dem Video-Proxy. Welche Videos es
gibt, erfährt der Monitor nur über `drohne.videos` in `situation-monitor`; der Block steht nur bei
eingeschaltetem Schalter „Livebild auf dem Lagemonitor“ (Einsatzleitung, Standard aus), und nur dann
liefert der Proxy einem Gerät Bilder. Andere Ansichten erreichen den Proxy nicht. Das Bild kann
Personen zeigen; deshalb der eigene Schalter.

## 6. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Schalter aus | kein Block, keine Kachel; Proxy liefert dem Gerät 404 |
| Schalter an, Suchlage liefert kein Video | Kachel mit „Kein Livebild“ |
| Proxy 502/503 | Player gibt auf → „Kein Livebild“; neuer Versuch beim nächsten Datenstand |
| Adapter angehalten oder gestört | `videos` leer oder Proxy 503 → „Kein Livebild“; Datenstand altert sichtbar |
| Einsatz abgeschlossen | Zuschaltung wirkt nicht mehr: kein Block, Proxy 404 |
| Ausschalten während der Wiedergabe | Proxy 404 binnen Sekunden; nach dem nächsten Abruf (≤ 30 s) fehlt die Kachel |
| Die Kachel wirft | nur sie fällt aus (`KachelGrenze`) |

## 7. Sicherheit und Datenschutz

- Standard aus, Einschalten nur durch die Einsatzleitung, im ETB festgehalten.
- Kein neuer Personenbezug in der Antwort: Videokennungen sind eigene Kennungen, keine
  Seriennummern.
- Die Route kommt nur in die Liste des Lagemonitors; der Handler prüft für Geräte zusätzlich den
  Schalter. Review nach Ermessen greift (gekoppelte Geräte, Berechtigung).

## 8. Tests

- Backend: `situation-monitor` ohne Zuschaltung, mit Zuschaltung und Schalter aus, mit Schalter an
  (Block da, auch mit leerer Liste), bei ausgeblendeter Lagekarte (kein Block), `verdichte` ohne
  Block. Video-Proxy: Gerät mit Schalter aus 404, mit Schalter an erreicht den Abruf; andere
  Ansicht 403 über die Routenliste. ETB-Einträge beim Umschalten, keiner bei gleichem Wert.
- Frontend: Schalter sendet den Wert, nur mit `darfSchalten`; Kachel fehlt ohne Block, zeigt
  „Kein Livebild“ bei leerer Liste, Datenstand hervorgehoben bei Alter > 2 min.
- e2e `geraet-lagemonitor.spec.ts`: Antwort von `situation-monitor` mit Block `drohne` (per
  `page.route` ergänzt, die HLS-Route beantwortet mit 503) → Kachel „Livebild“ mit „Kein Livebild“
  steht, keine Kachel schneidet ab, kein Bildlauf; ohne Block keine Kachel.

## 9. Dem Builder überlassen

- Name und Form des gemeinsamen HLS-Hooks.
- Genaue Pixelwerte, solange keine Kachel abschneidet und Texte ≥ 28 px, Zahlen ≥ 72 px bleiben.
- Ob „Sofortmeldungen“ in der schmalen Spalte die Zahl in 72 px statt 96 px zeigt (im Entwurf 72).
