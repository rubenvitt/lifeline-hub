# Prüfliste LFH-435: Layout-Gates × Rolle

Inventar vom 29.09.2026. Stand vor der Change: **jede** Layout-Spec meldet sich über eine
lokale `anmelden()` als `admin` an. Nicht-privilegiert liefen nur der LFH-460-Block in
`gate1-ueberlauf` und der LFH-337-Test in `kopfzeile-schmal`, beide ausschließlich auf
`/einsaetze` und mit einem Benutzer, der in keinem Einsatz Mitglied ist.

Rechte-Ableitung: `frontend/src/einsatz/schreibrecht.ts`
- `darfImEinsatzSchreiben` :52
- `darfEinsatzLeiten` :43
- `darfVerwaltung` :80

## Inventar

| Spec | Rolle vorher | gemessen | rollenabhängig? (Zweig) | Durchgang (Aufgabe) | Verdikt |
|---|---|---|---|---|---|
| gate1-ueberlauf | admin (+ LFH-460 ohne Mitgliedschaft, nur `/einsaetze`) | 16 Routen × 4 Breiten | ja: Kopf-Tag ab lg (`AppLayout.tsx:86-97`), ETB ohne Erfassung (`EtbPage.tsx:446`), RechteHinweis auf Ablösung (`AbloesungPage.tsx:319`), Verpflegung (`VerpflegungPage.tsx:332`), Betreuung (`BetreuungPage.tsx:422`), Überblick (`UeberblickPage.tsx:406`), Stammdaten für Führungskraft (`FahrzeugeTab.tsx:106`) | Beobachter + Führungskraft (2.2–2.5), dazu Route `ueberblick` für alle Rollen | erfüllt |
| gate3-trefflaeche | admin | Kopf, Rail, Stab, Ablösung, Kräfte, Betreuung, Verpflegung, Betroffene … | ja: Kopf-Verwaltung als Text + Tag (`AppLayout.tsx:153`), Stab „Besetzung ändern“ versteckt (`StabPage.tsx:203`), Ablösung Primär gesperrt (`AbloesungPage.tsx:313`), Kräfte „Einheit bilden“ versteckt (`KraefteuebersichtPage.tsx:839`) | Beobachter (2.6, 2.7) | erfüllt |
| trefflaeche-tablet | admin | Personal-Modulzeilen, Anmeldeverfahren | ja: Sperrgrund „nur Admins“ je Zeile (`Anmeldeverfahren.tsx:96-133`) | Führungskraft + Beobachter (2.8) | erfüllt; Befund: Seite war für die Führungskraft nicht ladbar (403), behoben |
| kopfzeile-schmal | admin + LFH-337 (390) | `/einsaetze`, etb | ja: Tag erst ab lg (`AppLayout.tsx:86`) | 1024 px (2.1) | erfüllt |
| einstellungen-schmal | admin | Einsatz-Einstellungen | ja: `SeitenHinweise` bei `!darfBearbeiten` (`EinsatzAllgemein.tsx:84` u. a.), Module `darfEinsatzLeiten` (`EinsatzModule.tsx:86`) | Führungspersonal + Beobachter (3.1) | erfüllt |
| uhs-hoehe, uhs-grundriss-touch | admin | UHS-Detail | ja: Kopfaktionen versteckt (`UhsDetailPage.tsx:135-164`), Platzkarte öffnet Person (`Grundriss.tsx:504`) | Beobachter (3.2) | erfüllt; Befund: Detailkopf lief bei langem Namen 11–13 px über (auch Admin), behoben |
| leisten-flaeche | admin | ETB-Leiste, Lagekarte, Gefahren | ja: Alert „Nur Lesezugriff“ (`GefahrenPage.tsx:266`); ETB-Leiste nur mit Schreibrecht | Beobachter Gefahren/Lagekarte (3.3) | erfüllt (ETB-Leiste: nicht anwendbar, existiert ohne Schreibrecht nicht) |
| kraefte-schmal, datensicht-schmal | admin | Kräfteseiten, Personal | ja: Statusbedienung null (`PersonalPage.tsx:488`), Position als Text (:310) | Beobachter (3.4) | erfüllt |
| betroffene-schmal | admin | Personen, Tiere | ja: Kopfaktionen versteckt (`PersonenPage.tsx:597`, `TierePage.tsx:307`) | Beobachter (3.5) | erfüllt |
| lagebericht-schmal | admin | Lageberichte | ja: „Neuer Bericht“ versteckt (`LageberichtePage.tsx:213`) | Beobachter (3.6) | erfüllt |
| lagekarte-leiste-dichte | admin | Kartenleiste | ja: Inspector-Aktionen null (`FachebenenInspector.tsx:217`) | Beobachter (3.7) | erfüllt; Pegel-Aktion im Inspector (`FachebenenInspector.tsx:217`) braucht externe Lagedaten → LFH-821 |
| katalogtabelle-schmal, verwaltung-vereinheitlicht | admin | Stammdaten, Einsatz-Vorgaben | ja: `SeitenHinweise rechteFehlt` (`EinsatzDefaults.tsx:120`) | Führungskraft (3.8) | erfüllt |
| chat-layout | admin | Chat | ja: Alert statt Eingabe (`ChatPage.tsx:488-505`) | Beobachter (3.9) | erfüllt |
| nav-schmal | admin | Drawer | nur mit Modulsperre per Override | — | nicht rollenabhängig (Override-Achse, s. design.md Open Questions) |
| seitenrinne | admin | Rinne, ETB-Leiste | Rinne nein; ETB-Leiste existiert nur mit Schreibrecht | — | nicht rollenabhängig |
| dichte | ohne Anmeldung | `/login` | nein | — | nicht anwendbar |
| lage-dashboard-schmal, meldebild-tabelle, wetter-pegel | admin | Dashboard, Meldebild, Wetter | nur per Modulsperre bzw. ohne Rechtezweig; Meldebild von Gate 1 für den Beobachter mitgemessen | — | nicht rollenabhängig |

## Mutationsproben

Je Durchgang: Mutation nur am Nicht-Admin-Zweig, Erwartung „Nicht-Admin rot, Admin grün“. Die
Mutation wird nie committet.


Befehle (29.09.2026, lokal, `PW_BINAER` auf den Debug-Build): je Batch wurden die Mutationen per
Skript eingespielt, die Nicht-Admin-Tests und ihre Admin-Geschwister mit
`playwright test <specs> -g <muster>` gefahren, danach `git checkout -- frontend/src`. Batches mit
disjunkten Produktdateien: A (Hinweis, Tag 700, Personal-Aktionen), A2 (Tag 2000), B1, B2, C, F
(Freistellung). Die Rot-Ursache jedes Tests ist aus seiner Fehlermeldung zugeordnet (Spalte
„Nicht-Admin“), nicht aus dem bloßen Rot.

| Durchgang | Mutation | Befehl | Nicht-Admin | Admin |
|---|---|---|---|---|
| Gate 1 · 390 · Beobachter + Führungskraft | `RechteHinweis` (`SpeicherHinweis.tsx`) `minWidth: 2000` | A | rot (Gate 1 verletzt) | grün |
| Gate 1 · Freistellung mit Rolle (D6) | `BESTAND_OFFEN` = etb@390 nur `beobachter` | F | Beobachter rot (tote Freistellung) | Admin + Führungskraft grün |
| kopfzeile-schmal 1024 ohne Verwaltungsrecht | Tag „Keine Berechtigung“ (`AppLayout.tsx`) `minWidth: 2000` (700 reichte nicht: Kopf bricht um) | A2 | rot (waagerecht) | grün; 390-px-Durchgang grün (Tag unter lg nicht gerendert) |
| gate1 LFH-460 1024 ohne Verwaltungsrecht (Bestand) | Tag `minWidth: 700` | A | rot (nicht mehr einzeilig) | grün |
| einstellungen-schmal Führungspersonal + Beobachter | `RechteHinweis` `minWidth: 2000` | A | rot (aufbewahrung/allgemein) | grün |
| einstellungen-schmal Führungspersonal + Beobachter, verwaltung-vereinheitlicht Führungskraft | Kurzwort `sperrGrund === 'rechte'` (`ModulEinstellungsListe.tsx`) `nowrap` + `minWidth: 2000` | B2 | rot (module / Modulzeilen) | grün |
| trefflaeche-tablet Beobachter (Modulzeilen) | Aktionsspalte `...(darfSchreiben` → `...(true` (`PersonalPage.tsx`) | A | rot (Vorbedingung „Entfernen“) | grün |
| trefflaeche-tablet Führungskraft (Anmeldeverfahren) | Sperrgrund-Kurzwort `nowrap` + `minWidth: 2000` bei `!istAdmin` | B1 | rot (Zeile „passwort“ läuft über) | grün (Kippschalter-Tests) |
| gate3 Globale Kopfzeile ohne Verwaltungsrecht | `gesperrt={!darfVerwaltung(…)}` → `false` (`AppLayout.tsx`); Verbreitern des Tags wirkt auf Treffflächen nicht, deshalb Vorbedingungsprobe | B1 | rot (Vorbedingung) | grün |
| gate3 Stab Beobachter | gesperrte Kopfaktion `height: 30` bei `!abschlussErlaubt` | B1 | rot (30 px < 48) | grün |
| gate3 Ablösung / Betreuung / Verpflegung Beobachter | gesperrte Primäraktion `height: 30` bei `!darfSchreiben` | B2 | rot (30 px < 48) | grün |
| gate3 Kräfteübersicht Beobachter | `{darfSchreiben && (` → `{true && (` (`KraefteuebersichtPage.tsx`) | B2 | rot (Vorbedingung) | grün |
| gate3 Betroffene Liste Beobachter | `!bedienung?.darfSchreiben ||` gestrichen (`personenSpalten.tsx`) | B2 | rot (Vorbedingung) | grün |
| kraefte-schmal Beobachter | Nur-Lese-Zweig `FahrzeugePage.tsx` bekommt Span `minWidth: 2000` | B1 | rot (fahrzeuge läuft über) | grün |
| datensicht-schmal Beobachter | Position `darfSchreiben ?` → `true ?` (`PersonalPage.tsx`) | B2 | rot (Vorbedingung) | grün |
| betroffene-schmal Beobachter | `{darfSchreiben && (` → `{true && (` (`PersonenPage.tsx`); ein Span im Aktions-Slot wirkt nicht (Slot bricht um) | C | rot (Vorbedingung) | grün |
| lagebericht-schmal Beobachter | `aktionen={darfSchreiben && (` → `true && (` (`LageberichtePage.tsx`); Span im Aktions-Slot wirkt nicht | C | rot (Vorbedingung) | grün |
| chat-layout Beobachter | Hinweis `marginTop: 2000` (`ChatPage.tsx`) | B1 | rot (`toBeInViewport`) | grün |
| uhs-hoehe Beobachter | Span `minWidth: 2000` im Aktions-Slot bei `schreibgeschuetzt` (`UhsDetailPage.tsx`) | B1 | rot (1024 und 390) | grün |
| uhs-grundriss-touch Beobachter | `kartenPerson = undefined` (`Grundriss.tsx`) | B2 | rot (Vorbedingung, 4 Tests) | grün |
| leisten-flaeche Lagekarte Beobachter | „Abspielen“ 20 × 20 bei `!darfSichern` (`SnapshotLeiste.tsx`) | B1 | rot (Trefffläche) | grün |
| leisten-flaeche Gefahren Beobachter | Nur-Lese-Hinweis `marginBottom: -80` (`GefahrenPage.tsx`) | B1, C | rot (Hinweis überlappt Matrix) | grün („Laden ohne Sprung“) |
| lagekarte-leiste-dichte Beobachter | Zentrieren-Knopf im Nur-Lese-Zweig `minWidth: 400` (`Sidebar.tsx`) | B1 | rot (Bildname verdrängt, 3 Stufen) | grün |
| katalogtabelle-schmal Führungskraft | `if (!istAdmin) return [{ ...status, fixed: 'left' }]` (`dienststatus.tsx`) | B1 | rot (zwei fixierte Spalten) | grün |

## Laufzeit

| Stand | Befehl | Dauer |
|---|---|---|
| vorher (`86c80cf0`, Wegwerf-Worktree) | `playwright test --reporter=dot`, 3 Worker | 803 s, 346 Tests (340 grün, 3 rot, 3 übersprungen), Last 33–67 |
| nachher (`20780cc3`) | derselbe Befehl | 702 s, 386 Tests (380 grün, 3 rot, 3 übersprungen), Last 21–50 |

Die Dauern sind wegen der stark schwankenden Maschinenlast (parallele Sitzungen) nicht belastbar
vergleichbar: Sie liegen unter der Messunsicherheit, der Nachher-Lauf war trotz 40 zusätzlicher
Tests schneller. Einen spürbaren Mehraufwand hat der Vergleich nicht gezeigt, ausgedünnt wurde
deshalb nichts. Die roten Tests sind in beiden Läufen andere und je für sich unauffällig:
- vorher `kopfzeile-schmal` 1024/handschuh, `lagekarte-betreuung`, `palette-oeffnung`
- nachher `fokus-verdeckung` ×2 (einzeln grün) und `dokumente` „Tastaturweg“. Das ist ein
  vorbestehender Flake, auf alpha 2 von 6 rot → LFH-810.

## Gesamtlauf `check-all.sh`

- Lauf 1: rustfmt rot (behoben), ein Energie-Quellen-Test rot unter Last (einzeln grün). Mitten in
  der e2e-Suite verschwand das Cargo-Target im Scratchpad; Ursache unbekannt, der Lauf war damit
  nicht auswertbar.
- Lauf 2: 11 von 12 Schritten grün. e2e: 380 grün, 6 rot. Davon ging `fokus-verdeckung` ×2 auf
  diese Change zurück: Die langen Anzeigenamen der Rollen-Benutzer in der globalen Benutzerliste
  machten die fixierte Namensspalte in `/admin/benutzer` so breit, dass „Bearbeiten“ beim Tabben
  vollständig dahinter lag. Die Rollen-Hilfe nimmt jetzt kurze Namen. Der Produktfehler selbst ist
  **LFH-819**.
- Lauf 3 (`--nur e2e`): 385 grün, 1 rot (`abloesung-kontrast` dark, Klick-Timeout bei Last 132,
  einzeln 3 von 3 grün).

## Nachzüge

- LFH-810: `dokumente` „Tastaturweg“ ist ein vorbestehender Flake.
- LFH-819: Die fixierte Namensspalte der Benutzerverwaltung hat keinen Deckel.
- LFH-820: Modulsperre per Override (`benoetigte_rolle`) als eigene Achse (design.md, Open
  Questions).
- LFH-821: Pegel-Aktion im Fachebenen-Inspector ohne Schreibrecht (braucht externe Lagedaten).
- LFH-822: `verwaltung-vereinheitlicht`, Messung 3 (1280 px), als Führungskraft.
