# Prüfliste Einsatztauglichkeit — Einstellungen, Profil und Anmeldung (LFH-345 · C10)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. C10 fasst die Einstellungs-,
Profil- und Anmelde-Gruppe an — neun Dateien, in denen es vorher **keinen einzigen
Breite-Breakpoint** gab.

**Umfang:** `pages/EinsatzEinstellungenPage.tsx`, `pages/EinsatzdatenPage.tsx`,
`pages/ProfilPage.tsx`, `pages/LoginPage.tsx`, `pages/LoginPage.css` ·
`pages/einstellungen/EinsatzDefaults.tsx`, `AnzeigeEinstellungen.tsx`, `Anmeldeverfahren.tsx`,
`ModulEinstellungsListe.tsx` · neu: `components/SpeicherHinweis.tsx`,
`components/OtpEingabe.tsx`, `pages/einstellungen/einsatzEinstellungenForm.ts` und die vier
Sektionsseiten · `App.tsx`, `routing/deeplinks.ts`.

---

## Der Ledger: was Bestand war, ist nicht geleistet

Vier Ticket-Punkte waren beim Aufsetzen bereits ganz oder halb abgetragen. Sie sind
**gemessen** ausgebucht, nicht angenommen:

| Punkt | Stand am 24.08.2026 | Träger |
| --- | --- | --- |
| **H17** Org-Standard-Hinweis unsichtbar (`cssVar` nie aktiviert) | **erledigt** — `grep -rn "var(--ant-color" frontend/src/pages/ frontend/src/components/` = **0**; `ModulEinstellungsListe` nutzt `Typography.Text type="secondary"` + `token.fontSizeSM` | LFH-328 · A2 |
| **M19** Login-Glascard: Kontrast | **abgegrenzt** — der Ticket-Absatz „Abgrenzung zu LFH-314" weist die *Gestaltung* der Anmeldeseite an A0/LFH-352; der Untertitel steht dort bereits auf 0,66 mit ausgeschriebener A1-Kontrastbegründung im Dateikopf. C10 fasst den Kartenhintergrund **nicht** an | LFH-352 · A0 |
| **M17** Trefferflächen | **halb** — `ProfilPage` trägt 0× `size="small"`, der Recovery-Knopf ist `block`; `Anmeldeverfahren` hat `zeilenzielStil` + sichtbaren Sperrgrund + Label-Klick. **C10 löst nur den Rest**: die Modulzeile | LFH-370 · B5j |
| **H16** Kein Breakpoint | **halb** — das gemeinsame Primitiv `ModulEinstellungsListe` existierte. **C10 löst den Rest**: Grid statt fester 64/180-Spalten und die Stapelung | LFH-328 · A2 |
| **M15** Gliederung | **halb** — `SektionHeader` stand statt nackter Titles, die drei Nummernkreise waren bereits eine Zeilengruppe | LFH-281 |

---

## Gemessene Baseline am 24.08.2026 (beide Stände gefahren)

| Größe | vorher | nachher |
| --- | --- | --- |
| Speicherpfade mit persistentem Fehlerzustand | **0 von 7** (alle nur Toast) | **alle** — nach der Zerlegung sind es neun Mutationspfade, die sieben aus dem Ticket-Text beschreiben den Vorzustand |
| Steuerelemente, die eine laufende Modul-Mutation sperrt | **alle 50** | **1** (die schreibende Zeile) |
| Breite-Breakpoints in den neun Dateien | **0** | Grid + Stapelung unter `md`, e2e-belegt |
| Feste Spaltenbreite der Modulzeile | **268 px** (64 + 180 + Abstände) | `minmax(0, 1fr) auto auto` |
| Felder auf einer Einstellungs-Route | **15 + Modulliste** | **5 / 9 / 1 / Liste** auf vier Sektionen |
| Anmelden-Knopf vollständig sichtbar nach | **1,06 s** | **0,35 s** (Felder und Knopf gemeinsam; die Karte darunter steht bei 0,4 s) |
| TOTP-Eingabe-Bauformen | **2** (Login mit, Profil ohne Ziffern-Tastatur) | **1** (`components/OtpEingabe.tsx`) |
| `grep -rn "var(--ant-color" pages/ components/` | 0 (Bestand seit A2) | **0** |
| `grep -c 'size="small"' ProfilPage.tsx` | 0 (Bestand seit B5j) | **0** |
| `grep -c "Platzhalter" ProfilPage.tsx` | **2** | **0** |
| Vitest (ganze Suite) | 277 Dateien / 3040 Fälle | **286 / 3138** |
| e2e-Specs | 24 | **25** (`einstellungen-schmal.spec.ts`, 6 Fälle) |

---

## Die 15 Kriterien

| # | Verdikt | Begründung |
| --- | --- | --- |
| 1 · Treffläche | **erfüllt** | Die Modulzeile ist ein handgebautes Bedienziel und trägt die ZWEI Angaben aus LFH-365 (`modulZeilenStil`: `minHeight: controlHeight` **plus** Polsterung, rein und exportiert). Das `<label htmlFor>` entsteht **nur an der bedienbaren Zeile** — an einer gesperrten leitet der Browser den Label-Klick ohnehin nicht weiter, er wäre eine Aufforderung ohne Reaktion (Regel aus LFH-370). Kein neues `size` an interaktiven Elementen; `dichte.guard.test.ts` steht unverändert auf einer Datei. `OtpEingabe` verzichtet bewusst auf das `size="large"`, das beide Aufrufer vorher trugen. In Playwright gegen die Staffel gemessen (48 / 72), nicht gegen die 44 aus dem AK-Text — die wäre schwächer als der Bestand |
| 2 · Handschuh-Modus | **erfüllt für den Umfang** | Die Dichtestufe greift über den `ConfigProvider`; die Modulzeile ist die einzige Fläche der Gruppe, die ihre Höhe selbst tragen musste, und tut es über zwei Dichtestufen (e2e). Offen bleibt wie überall die Ableitung der Stufe aus dem Einsatzkontext → **LFH-373** |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt, verbessert** | `isPending` an allen Mutationen unverändert. **Neu:** die Sofort-Speichern-Zeile sperrt nur noch **sich selbst** statt aller 50 Steuerelemente (`laeuftKey`), und ein Fehlschlag markiert genau die betroffene Zeile (`fehlerKey` → `data-fehler` + linker Rand aus `token.colorError`). Der Wert selbst springt ohnehin zurück — es gibt kein optimistisches Update — was fehlte, war die Angabe **welche** Zeile |
| 4 · Kritische Aktion hat eine zweite Handlung | **nicht anwendbar** | C10 führt keine unumkehrbare Aktion ein. Die einzige sicherheitsrelevante Stelle ist die TOTP-Bestätigung, und die hat seit C10 einen **Riegel** statt einer Rückfrage: zwei Absendewege (sechste Ziffer und Knopf) liefen sonst beide gegen einen Code, der serverseitig genau einmal gültig ist |
| 5 · Kontrast in beiden Modi | **erfüllt** | C10 führt **keinen** Farbwert ein. Die Zeilenmarke nimmt `token.colorError`, die Hinweise antds `error`/`info`-Presets. Kein Hexwert, kein `var(--lfh-*)` in TSX; `theme/gate5.guard.test.ts` grün. Der Kartenhintergrund der Anmeldeseite bleibt unberührt (M19 → A0) |
| 6 · Kein Status allein über Farbe | **erfüllt** | Die Fehlermarke an der Zeile trägt **zwei** Kanäle: den Rand (Farbe) und den Fehlertext im Klartext. Beide zeigen auf **denselben** Vorgang — das war zunächst nicht so: `EinsatzDefaults` verkettete Formular- und Modulfehler mit `??` in einem Kopf-Alert, und nach einem gescheiterten Formular-Speichern beschrieb der Text einen anderen Vorgang als der rote Rand darunter. Im eigenen Review gefunden; der Modulfehler steht jetzt **bei der Liste**. Der Rechte-Hinweis ist reiner Text mit Icon; der Einsatz-Status steht als **Wort** statt als Wire-Wert |
| 7 · Eine Farbe = eine Bedeutung | **erfüllt** | Der linke Zeilenrand trägt in dieser Gruppe genau eine Bedeutung — „hier ist das Speichern gescheitert". Dieselbe Bauform wie an den Kommunikations-Karten (LFH-343 · C8), dort mit Vorrangregel; hier gibt es keinen zweiten Anwärter auf den Rand |
| 8 · Helligkeits-/Kontrastregler | **offen, unverändert** | Weiterhin keiner in der Anwendung → **LFH-397**, app-weit |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt** | Der Speicherfehler steht **über der Aktion, an der er entsteht** — im Kopf-Hinweis-Slot der Verwaltungsseiten, direkt über der Knopfreihe bei den Einsatzdaten. Er verfällt nicht mehr nach drei Sekunden; das war der Kern von H14 |
| 10 · Alarmbudget | **erfüllt, mit Verbesserung** | Die Zahl der ungefragten Meldungen **sinkt**: sieben Fehlerpfade melden sich nicht mehr als Toast, sondern als stehender Zustand an der Seite. Der Erfolgs-Toast bleibt — er quittiert eine abgeschlossene Handlung, ist also die Fortsetzung einer Nutzeraktion und keine Zustandsmeldung im Sinne von EEMUA 191 (dieselbe Abgrenzung wie beim handlungsfähigen Rückgängig-Toast in C8) |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton, keine neue Eskalationsstufe. Die Anmelde-Animation ist **kürzer und entstaffelt** geworden (1,06 s → 0,35 s), der `prefers-reduced-motion`-Block bleibt unangetastet |
| 12 · Kein Sprung unter dem Cursor | **erfüllt** | C10 fügt keine Live-Aktualisierung hinzu. Der einzige Zustandswechsel ohne Nutzeraktion ist der nachlaufende Organisations-Abruf auf der Profilseite; er füllt eine bereits stehende Zeile, statt Inhalt einzuschieben |
| 13 · Fokus nie verdeckt | **erfüllt, gemessen** | Die sticky Speicherleiste der Sektionen ist ein **neues** `position: sticky` und damit genau die Konstruktion, auf die WCAG 2.4.11 zielt: eine unten verankerte Leiste über einem langen Formular. `e2e/fokus-verdeckung.spec.ts` trägt dafür jetzt einen eigenen Fall auf `…/einstellungen/verhalten` (neun Felder, 390 × 420 px) — Tabulaturdurchlauf mit drei Vorbedingungen (Bildlaufreserve > 0, mindestens ein `sticky`-Knoten im Baum, mindestens acht Stopps), sonst wäre „0 verdeckte Ziele" trivial wahr. **Die erste Fassung dieser Zeile stand ohne Beleg** — sie verwies auf einen Spec, der die Einstellungen gar nicht enthielt; im eigenen Review aufgefallen und nachgeholt |
| 14 · Tabellenseite vollständig | **nicht anwendbar** | Keine der Seiten ist eine Vergleichsfläche. Die Modul-/Provider-Listen sind Schalterlisten („was ist mit diesem hier?"), keine Tabellen — sie werden gelesen und geschaltet, nicht verglichen |
| 15 · Erfassungsmaske vollständig | **nicht anwendbar für C10** | Die Gruppe trägt keine Erfassungsmaske im Sinne von B4 — es sind Einstellungsformulare mit Sammel-Speichern und Sofort-Speichern-Schaltern, keine Anlage-Dialoge. Der Enter-Vertrag greift trotzdem: die Speichern-Knöpfe der Sektionsseiten liegen **im** `<form>` und tragen `htmlType="submit"`. Das ist die Nebenwirkung der sticky Leiste, die den Kopf-Slot geleert hat — ein Knopf dort wäre ein DOM-Geschwister außerhalb des `<form>` und könnte nichts übermitteln |

---

## Die Falle, die den Routen-Umbau teuer gemacht hätte

`PUT /api/einsaetze/{id}/einstellungen` ist **Vollersatz, kein PATCH**. Auf einer Route mit
allen fünfzehn Feldern fällt das nicht auf; auf vier Sektions-Routen ist es der Fehlerfall,
der **keinen roten Test und kein Fehlerbild** erzeugt: wer in „Aufbewahrung" speichert, nullt
sonst still die Nummernkreise. Betroffen sind zusätzlich `basemap_modus`,
`karten_zoom_start` und `fachebenen_sichtbar` — sie leben seit LFH-319 auf der Lagekarte, sind
aber weiter Spalten dieses Datensatzes und müssen in **jedem** Payload mitfahren.

Deshalb ist `zuUpdate` (in `einstellungen/einsatzEinstellungenForm.ts`) **zuerst** entstanden,
mit den drei Kartenfeldern namentlich im Test — dieselbe Bauform, die die Org-Ebene seit
LFH-281 fährt. Zweite Hälfte derselben Frage: jede Sektion stellt ihre Queries **selbst**
statt sie über `useOutletContext` zu erben. `Form initialValues` wird genau einmal beim Mount
gelesen; eine Sektion, die ohne Daten montiert, zeigt ein leeres Formular, und der nächste
Klick auf Speichern schickt einen Vollersatz-PUT aus lauter `null`.

---

## Zwei benannte AK-Abweichungen

### 1. Die Fake-Timer-Prüfung ist in dieser Umgebung nicht möglich

Das AK verlangt: „Vitest je Seite belegt, dass die Fehlermeldung nach Vorlauf der Toast-Dauer
(Fake-Timer) noch im DOM ist." **Beide Bauformen dieser Prüfung sind Attrappen**, und das ist
gemessen, nicht vermutet:

1. Fake-Timer **nach** dem Klick aktiviert — antds Message-Timer läuft dann längst mit echten
   Timern, `advanceTimersByTime` erreicht ihn nicht mehr. Alle drei Seiten waren so grün,
   bevor eine Zeile Produktivcode existierte.
2. Fake-Timer **ab dem Rendern**, mit `shouldAdvanceTime: true` (ohne das bleibt die Seite im
   Ladeskelett und der Speichern-Knopf existiert nie) — auch dann bleibt der Toast beim
   Vorlauf stehen.

Entschieden hat die **Mutationsprobe**: mit zurückgedrehtem `message.error` statt des Alerts
blieb genau dieser Test grün, während die beiden Aussagen daneben rot wurden. Ein Test, der
nicht rot werden kann, behauptet eine Deckung, die er nicht hat.

**An seiner Stelle stehen zwei mutationsgeprüfte Aussagen je Seite:**
- die Meldung steht **außerhalb** von antds Message-Container (`closest('.ant-message')` ist
  `null`) — sie ist also kein Toast und hat keine Queue-Lebensdauer;
- sie verschwindet **erst beim nächsten Absenden** — ein Alert, der nie geht, wäre so falsch
  wie einer, der zu früh geht.

Die Begründung steht ausführlich im Kopfkommentar von
`pages/einstellungen/EinsatzDefaults.test.tsx`.

### 2. „Passwort ändern" ist herausgeschnitten, nicht vergessen

Das AK zu N5 verlangt „einen Weg ‚Passwort ändern', wenn der Passwort-Provider aktiv ist".
Das Backend hat dafür **keinen Endpunkt**, und zwar ausdrücklich nicht: `PatchBenutzer` in
`src/routes/benutzer.rs:29` trägt den Kommentar „`benutzername` (Login-Identität) und Passwort
sind bewusst nicht änderbar"; `passwort_hash = ` trifft im ganzen Backend nur `src/dev/seed.rs`.

Ein Self-Service-Weg ist neues Backend — Route, Verifikation des alten Passworts,
Session-Entscheidung, Tests, Codegen. C10 rendert dafür **keinen toten Knopf**: dieselbe Regel
wie beim Kopieren-Knopf ohne Zwischenablage (LFH-370). Alle anderen Hälften von N5 sind
geliefert. → **LFH-471**

---

## Nachzüge

| Nummer | Inhalt |
| --- | --- |
| **LFH-471** | Self-Service-Passwortänderung: Backend-Route mit Alt-Passwort-Verifikation + Abschnitt auf der Profilseite (s. Abweichung 2) |
| **LFH-472** | Einsatzdaten je Zeile bearbeiten statt Alles-oder-nichts-Formular. C10 hat die Gliederung geliefert und die Form bewusst gelassen — das Ticket bot beide Wege an; Inline-Edit an Pflichtfeldern mit `DatePicker`/`Select`/Koordinaten ist ein eigener Umbau, den `BemerkungZelle` (optionale Freitexte) nicht trägt |
| **LFH-373** | Dichtestufe aus dem Einsatzkontext ableiten (Prüflisten-Zeile 2), app-weit |
| **LFH-397** | Helligkeits-/Kontrastregler (Prüflisten-Zeile 8), app-weit |
