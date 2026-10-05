# Prüfliste Einsatztauglichkeit: Taktische Fernmeldeskizze (LFH-893)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder umgebauten Seite. Sie gilt für die Darstellung
„Skizze“ des Funkplans (`/einsaetze/:id/stab/funkplan?ansicht=skizze`, Branch
`claude/project-thread-7a47sr`) mit allen ihren Flächen: Zeichenfläche (`stab/skizze/SkizzenFlaeche.tsx`,
`SkizzenElemente.tsx`), Werkzeugleiste, Palette, Eigenschaftspaneel, Dialoge (Anlegen, „Verbinden
mit …“, Artwahl, Rückfrage, Kontextmenü) und Druck A3/A4 quer. Geprüft wird für drei Kontexte:
**Fükw** (1366 × 768 mit offenem Modulpanel, Tastatur und Maus, kompakt), **Tablet**
(Führungs-Tablet, 1024 bzw. 768 px, Touch, komfortabel oder Handschuh) und **mobil** (390 px, nur
lesen, D6). Pfade sind relativ zu `frontend/`. Gerechnetes und aus dem Quelltext Geschlossenes
trägt **[abgeleitet]**. Die e2e-Läufe sind Chromium (tasks.md 9.1), Firefox und WebKit liefen
lokal nicht. Die e2e-Suite misst im Nachtbetrieb (`MODUS_DEFAULT = 'dark'`,
`theme/ThemeModeProvider.tsx`); Werte des hellen Modus sind aus `theme/tokens.ts` gerechnet.

**Verdikte:** **erfüllt** (mit Beleg) · **teilweise erfüllt** bzw. **offen → O*n*** (Punkt unter
„Offene Punkte“) · **nicht anwendbar** (mit Begründung).

| # | Kriterium | Verdikt | Beleg |
|---|---|---|---|
| 1 | Treffläche | Fükw **erfüllt** · Tablet **erfüllt** [abgeleitet] · mobil **offen → O2** | Fükw: `e2e/fernmeldeskizze.spec.ts` „Prüfliste 1: …“, 8 Abschnitte × 3 Einheiten eingepasst, 0 Ziele unter 24 × 24 px, kleinstes 47 × 29 px (design.md, Nachträge). Die Bedienung um die Fläche (Werkzeugleiste, Ebenen, Palette, Paneel, Lücken-Wahl, Umschalter, Drucken) hält 30/48/72 px: `e2e/gate3-trefflaeche.spec.ts` „Fernmeldeskizze: …“ und „Fernmeldeskizze (Beobachter): …“. Linien und Schienen treffen am Schirm mindestens 24 px breit (`FernmeldeskizzeBild.test.tsx` „Trefferflächen: …“). Griffe (Anschluss, Ecke) treffen mit dem Durchmesser `controlHeight`, unabhängig vom Maßstab (`SkizzenFlaeche.tsx`, `Griff`). Keine zeitkritische Aktion, die 48-px-Regel greift nicht. Wer bis 0,25 herauszoomt, macht das kleinste Element rechnerisch etwa 36 × 22 px groß [abgeleitet]; „Einpassen“ (Taste 0) stellt den gemessenen Zustand her. Tablet: Messung 1.1 eingepasst, kleinste Einheit 48 × 30 px (1024) bzw. 49 × 30 px (768). „Prüfliste 1“ selbst läuft nur bei 1366 und 390 px. Mobil: 33 Ziele unter 24 px, kleinstes 24 × 15 px. Tippen wählt und hebt hervor, das Element ist also ein Ziel. Der Test meldet die Zahl der Ziele ohne freien 24-px-Kreis nur als Annotation und prüft sie nicht. Im Messbestand (`seedeGross`) fehlen Komponenten und externe Stellen (O6) |
| 2 | Handschuh-Modus | Fükw **nicht anwendbar** · Tablet **teilweise erfüllt, offen → O3** · mobil **nicht anwendbar** | Gate 3 misst die Stufe 72 für Werkzeugleiste, Palette, Paneel, Lücken-Wahl und Umschalter, auch als Beobachter. Kein neues punktuelles `size="small"` in den Quellen der Skizze (Grep). Griffe wachsen mit `controlHeight` auf 72 px, Linientreffer auf `max(24, 2/3 · controlHeight)` = 48 px [abgeleitet, `SkizzenFlaeche.tsx`]. Die Elemente AUF der Fläche skalieren mit dem Maßstab, nicht mit der Dichte (Kommentar in Gate 3). Eingepasst am Tablet ist das kleinste Element 48 × 30 px statt 72 px hoch, der Spaltenabstand 32 E. × 0,338 ≈ 11 px statt 16 px [abgeleitet]. In der Stufe Handschuh ist die Fläche nicht gemessen. Fükw: kompakt, Maus. Mobil: nur lesen; Zoom und Einpassen sitzen in der Werkzeugleiste, die die Staffel hält |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt** (alle drei) | Verschieben zeigt die neue Lage vor der Antwort: die eigene Lage steht über dem Netz (`useSkizzenHandlungen.ts`; Test „solange das Netz die Antwort noch nicht trägt, steht die eigene Lage …“). Läuft eine Anfrage, nennt die Statuszeile (`role="status"`) sie, etwa „Verschieben von EA 1 …“ (Test „ein zweiter Pfeil wartet auf die Antwort des ersten …“). Dialoge zeigen `loading` am Knopf und den Fehler in der Maske (`SpeicherFehler`). Ein Scheitern steht am Element und in der Statuszeile (Test „Datensatz inzwischen gelöscht“). Zoom, Filter und Hervorheben wirken lokal. ≤ 100 ms [abgeleitet]: der Zustand wird vor dem Aufruf gesetzt, im Browser ist die Zeit nicht gemessen. Mobil: nur lokale Handlungen |
| 4 | Kritische Aktion hat eine zweite Handlung | Fükw, Tablet **erfüllt** · mobil **nicht anwendbar** | Unumkehrbares fragt nach. „Neu anordnen?“ verwirft alle Lagen an allen Arbeitsplätzen, ohne Rückgängig (e2e „Lage: …“ bestätigt im Dialog). „‹Komponente› entfernen?“ nennt, dass Rückgängig die Verbindungen nicht neu anlegt (`FernmeldeskizzeBild.tsx`, Dialog `komponente-entfernen`). Entfernt wird erst mit „Entfernen“, Abbrechen entfernt nichts (`FernmeldeskizzeBild.test.tsx`, Tests „„‹Komponente› entfernen?“: Entf fragt nach, entfernt wird erst mit „Entfernen““ und „… Abbrechen entfernt nichts“; Mutationsprobe Rückfrage übersprungen → beide rot; O6, hier geschlossen). Umkehrbares geht nach LFH-363 ohne Rückfrage, mit Rückgängig: Stichleitung lösen (Test „Stichleitung lösen: Entf … ohne Rückfrage“, `wirkung.test.ts`), Verbindung und Bereich entfernen (Gegenhandlung auf dem Stapel, `useSkizzenHandlungen.ts`). Scheitert die Gegenhandlung, steht der Grund am Element. Mobil: keine schreibende Handlung (Test „Mobil: keine Griffe, keine Palette, kein Rückgängig …“) |
| 5 | Kontrast in beiden Modi | **teilweise erfüllt, offen → O7** (alle drei) | Voller Text (`rollen.text` auf `flaeche`): hell 18,47, dunkel 15,70 : 1. Lücken in `achtungText`: hell 9,22, dunkel 11,75 : 1. Fokusrahmen in `bedien`: hell 8,55, dunkel 5,84 : 1 (≥ 3) [alle abgeleitet aus `theme/tokens.ts`]. Zurückgenommen (Deckkraft 0,6), gemessen dunkel (e2e „Prüfliste 5: …“): Name, Rufname, „kein Rufname“ und Kasten 6,18 : 1, das hält das Nacht-Ziel 5 : 1. Hell [abgeleitet, dieselbe Mischung wie `skizze/zurueckKontrast.test.ts`]: Text 4,83 : 1, über dem Boden, unter dem Tag-Ziel 7 : 1 (O7, Entscheidung offen). Lückenwort, Meldung und ihre Marke treten nicht mit zurück (O1, hier geschlossen): das Bild eines Elements nimmt die Deckkraft selbst (`zurueckDeckkraft` in `SkizzenElemente.tsx`), Lücken- und Meldungszeile stehen außerhalb davon, also auch an einem zurückgenommenen Element hell 9,22, dunkel 11,75 : 1 [abgeleitet]. Vorher hell 3,20 : 1, unter dem Boden. `zurueckKontrast.test.ts` rechnet `text` und `achtungText` in beiden Modi aus den Tokens; Test „zurückgenommen: Name und Zeichen treten zurück, Lückenwort und Marke nicht“ prüft die Deckkraft am gerenderten Bild (vorher rot: 0,6 statt 1). Die e2e-Messung läuft nur dunkel und lief nach der Änderung nicht. Im Druck tritt nichts zurück (`zustand` ohne `zurueck`), dunkel auf hell |
| 6 | Kein Status allein über Farbe | **erfüllt** (alle drei) | „geplant“ trägt Strichmuster und Wort, am Schirm und im Druck (e2e „Geplant: …“; Graustufen 17 Hell-Dunkel-Wechsel gegen 0 in `e2e/fernmeldeskizze-druck.spec.ts`; Mutationsprobe Strichmuster weg → rot). Eine Lücke trägt Marke und Wort (Test „Lücke am Element als Wort“). Hervorheben wirkt über Strichstärke bzw. Unterstrich, Zurücktreten über Deckkraft (Test „Wer hört mit? …“). Wahl ist ein gestrichelter Rahmen, Fokus ein durchgezogener mit größerem Abstand (`Rahmen` in `SkizzenElemente.tsx`). Neues trägt das Wort „neu“. Funk und Leitung unterscheidet die Linienart (Zickzack, D12; Mutationsprobe Zickzack in 2.3) |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** (alle drei) | Farbliterale in `stab/skizze/`, `FernmeldeskizzeBild.tsx` und `skizzenZeichen.tsx`: 0 (Grep; Mutationsprobe Farbliteral in 2.3). Die Struktur steht in `currentColor` = `rollen.text`. `achtungText` nur für Lücken und Meldungen am Element (beides Marke und Wort) und für Lücken im Paneel. `bedien` nur für Fokusrahmen, Griffe, Gummiband und die Markierung der Trefferliste in „Verbinden mit …“. Rot (`danger`) nur an „Entfernen“, „Lösen“ und am OK der Rückfrage. Der Seitengrund ist A0. Die Zeichenfläche steht auf `flaeche` wie jede Karte (hell `#ffffff`); das ist die app-weite Kartenfläche, keine Wahl dieser Change |
| 8 | Helligkeits-/Kontrastregler | **erfüllt** [abgeleitet] (alle drei) | Die Deckschicht aus LFH-397 wirkt app-weit. Die Skizze setzt keine eigene Helligkeit |
| 9 | Kritische Anzeigen im Blickfeld | **erfüllt** [abgeleitet] (alle drei) | Das Lücken-Paneel steht in allen drei Darstellungen vor der Darstellung (`pages/FunkplanPage.tsx`, Blatt: Druckkopf, Lücken, Darstellung). Im ersten Bild bei 1366 × 768 mit offenem Panel ist das für Tabelle und Sprechgruppen belegt (`e2e/funkplan.spec.ts`, `toBeInViewport`), für die Skizze nicht eigens. Die Lücke steht zusätzlich am Element der eingepassten Skizze; ein Klick im Paneel wählt es (e2e „Lücken: …“). Das Scheitern einer Handlung steht am Element und in der Statuszeile |
| 10 | Alarmbudget | **nicht anwendbar** (alle drei) | Keine Alarme, keine Toasts (Grep `message.`/`notification` in den Quellen der Skizze: 0). Die Statuszeile ist `aria-live="polite"`. Meldungen entstehen nur aus der eigenen Handlung oder einem 409 |
| 11 | Warnverhalten | Fükw, Tablet **erfüllt** · mobil **erfüllt** [abgeleitet] | Kein Blinken, keine Animation, kein Ton (Grep `animation`, `blink`, `@keyframes`, `transition`, `Audio`: 0). Lücken sind Zustände und enden mit ihrer Ursache. Die Meldung am Element (etwa „von einem anderen Arbeitsplatz verschoben“) lässt sich quittieren (O4, hier geschlossen): Escape am gewählten Element nimmt sie von Fläche, Paneel und Statuszeile, erst das nächste Escape wählt ab; im Paneel steht dafür „Quittieren“ (`quittiere` in `useSkizzenHandlungen.ts`; Tests „Meldung am Element: Escape quittiert sie, ein zweites Escape wählt ab“ und „… „Quittieren“ im Paneel nimmt sie von Fläche und Paneel“, beide vorher rot). Sonst bleibt sie bis zur nächsten Handlung an diesem Element. Aufs Blatt kommt sie nicht: die Fläche lässt sie im Druck weg (`meldung` in `SkizzenFlaeche.tsx`, Test „Meldung am Element kommt nicht aufs Blatt“, Mutationsprobe Weiche weg → rot), und `skizzeDruck.css` blendet `[data-teil='meldung']` auch auf Druckwegen ohne `beforeprint` aus (`skizzeDruck.test.ts`). Die Meldungszeile trägt jetzt `data-teil="meldung"` statt `luecke` und zählt so nicht mehr als Lücke. Mobil: keine Schreibhandlung, also keine solche Meldung |
| 12 | Kein Sprung unter dem Cursor | **teilweise erfüllt, offen → O5** (alle drei) | Ruhige Fläche: liegt der Zeiger in der Fläche, bleiben auto-gelegte Elemente stehen, Hinzukommendes trägt „neu“ (e2e „Ruhige Fläche: …“). Der Test misst `x`/`y` des Rechtecks im SVG, nicht die Lage am Schirm; CLS ist nicht gemessen. Nicht gedeckt: (a) Eine gespeicherte Lage, die ein anderer Arbeitsplatz verschiebt, bewegt sich sofort, auch unter dem Zeiger (D4, bewusst). (b) Das Lücken-Paneel steht über der Fläche und bekommt live Zeilen mit Wahlknöpfen (`LueckenZeile` in `FunkplanPage.tsx`). Wächst es, rückt die ganze Fläche am Schirm nach unten [abgeleitet]. LFH-625 maß noch Δ 0 px am Schirm (LFH-867); dieser Nachweis ging mit dem Ersatz der Skizzen-Tests in `funkplan.spec.ts` verloren |
| 13 | Fokus nie verdeckt | **erfüllt** (Fükw, Tablet) · **erfüllt** [abgeleitet] (mobil) | Test „Fokus nie verdeckt: gezoomt holt der Fokus das Element in den sichtbaren Ausschnitt“ (Mutationsprobe Ausschnitt weg → rot, tasks.md 5.3). Keine angepinnte oder schwebende Leiste in den Quellen der Skizze (kein `sticky`, kein `fixed`). Palette und Paneel sind Spalten des Rasters, unter `xl` steht das Paneel unter der Fläche. Kontextmenü und Dialoge sind modal. Tastaturfluss im Browser: e2e „Tastatur: … ohne Zeiger zugeordnet“ |
| 14 | Tabellenseite vollständig | **nicht anwendbar** (alle drei) | Die Skizze beantwortet „wer erreicht wen?“, nicht „welcher von diesen?“. Verglichen wird in der Tabelle derselben Seite (Prüfliste LFH-548). Im Druck hängt sie als Anlage ab neuer Seite an (`e2e/fernmeldeskizze-druck.spec.ts`) |
| 15 | Erfassungsmaske vollständig | Fükw, Tablet **erfüllt** · mobil **nicht anwendbar** | Anlegen über `ErfassungsModal` (`SkizzenDialoge.tsx`, `AnlegenDialog`): Fokus im ersten Feld, Enter sendet, Escape bricht ab, Labels über dem Feld (`layout="vertical"`), Fehler in der Maske. Vorgaben sichtbar und einzeln überschreibbar: Art „Leitstelle“ bzw. „Repeater“, Bezeichnung „Rückwärtiger Bereich“, Medium einer Verbindung nach Art (`vorgabeMedium`, `wirkung.test.ts`). Kein Serienmodus: `serie` gilt Masken im Minutentakt (`components/Erfassung.tsx`), ein neues Element steht sofort auf der Fläche und wird dort weiter bearbeitet. Die Sammelliste ist die Fläche: je Element ändern im Paneel, entfernen bzw. lösen mit Rückgängig. Tests „Leitstelle anlegen …“, „Bereich anlegen …“, „Zuordnen mit der Tastatur …“. Mobil: nur lesen |

**Bilanz Fükw:** 10 erfüllt · 2 teilweise erfüllt (5, 12) · 3 nicht anwendbar.
**Bilanz Tablet:** 10 erfüllt · 3 teilweise erfüllt (2, 5, 12) · 2 nicht anwendbar.
**Bilanz mobil:** 7 erfüllt · 2 teilweise erfüllt (5, 12) · 1 offen (1) · 5 nicht anwendbar.

## Offene Punkte

Hier geschlossen: O1, O4 und der Komponententest aus O6. Jeder offene Punkt (O2, O3, O5, der
e2e-Teil von O6, O7) hat ein Folgeticket: LFH-1037 (O5), LFH-1038 (O2, O3, e2e-Teil von O6),
LFH-1039 (O7).

- **O1 · Kontrast im hellen Modus (Kriterium 5). Hier geschlossen.** Lückenwort und Marke an
  einem zurückgenommenen Element hatten 3,20 : 1, unter dem Boden 4,5 : 1. Lücken- und
  Meldungszeile treten jetzt nicht mehr mit zurück: jedes Bild nimmt seine Deckkraft selbst
  (`zurueckDeckkraft` in `stab/skizze/SkizzenElemente.tsx`), die Gruppe des Elements trägt nur noch
  die Marke `data-zurueck` (`SkizzenFlaeche.tsx`). Die Spec „Erkunden durch Hervorheben und
  Filtern“ verlangt das Zurücktreten der übrigen Elemente, nicht ihrer Lücken; eine Lücke bleibt
  die kritische Anzeige (Kriterium 9). Beleg: `zurueckKontrast.test.ts` rechnet `achtungText` in
  beiden Modi aus den Tokens (hell 9,22, dunkel 11,75 : 1), der Test „zurückgenommen: Name und
  Zeichen treten zurück, Lückenwort und Marke nicht“ in `FernmeldeskizzeBild.test.tsx` misst die
  Deckkraft am gerenderten Bild (vorher rot). Die e2e-Prüfungen lesen `data-zurueck` statt
  `opacity` am Element; sie liefen nach der Änderung nicht. Die Entscheidung zum Tag-Ziel steht
  jetzt als O7.
- **O2 · Treffläche mobil (Kriterium 1).** 33 Ziele unter 24 px, kleinstes 24 × 15 px; ob die
  Abstandsausnahme (freier 24-px-Kreis) trägt, meldet der Test nur. Schließt: der Test prüft die
  Ausnahme als Erwartung, oder schmale Schirme passen nicht unter den Maßstab ein, bei dem jedes
  Ziel 24 px hält. Folgeticket LFH-1038.
- **O3 · Handschuh am Tablet (Kriterium 2).** Die Elemente der Fläche folgen nicht der Dichte:
  eingepasst 48 × 30 px, Abstand etwa 11 px. Schließt: Messung der eingepassten Fläche in der
  Stufe Handschuh am Tablet und ein Mindestmaßstab je Stufe (Element ≥ 72 px, Abstand ≥ 16 px).
  Oder eine in design.md begründete Ausnahme, die zeigt, dass jede Handlung über Paneel, Dialoge und
  Lücken-Wahl geht. Heute wählt man ein Element ohne Lücke nur auf der Fläche. Folgeticket LFH-1038.
- **O4 · Meldung am Element (Kriterium 11). Hier geschlossen.** Sie war nicht quittierbar und im
  Druck nicht ausgeblendet. Escape am gewählten Element quittiert sie (erst das nächste Escape
  wählt ab), im Paneel steht „Quittieren“ (`quittiere` in `useSkizzenHandlungen.ts`, nimmt sie auch
  aus der Statuszeile). Im Druck lässt die Fläche sie weg (`SkizzenFlaeche.tsx`), `skizzeDruck.css`
  blendet `[data-teil='meldung']` auch ohne `beforeprint` aus. Beleg: drei Tests in
  `FernmeldeskizzeBild.test.tsx` („Meldung am Element: …“, vorher rot) und
  `skizzeDruck.test.ts` „blendet Meldungen am Element aus, auch ohne `beforeprint`“ (vorher rot).
- **O5 · Sprung unter dem Cursor (Kriterium 12).** (a) Fremd verschobene gespeicherte Lagen
  bewegen sich unter dem Zeiger. (b) Das Lücken-Paneel über der Fläche ändert live seine Höhe.
  Schließt: ein e2e misst das Rechteck am Schirm (`boundingBox`) unter dem Zeiger, während an einem
  zweiten Arbeitsplatz eine Lücke entsteht und eine Lage verschoben wird. Das Paneel wird in die
  Ruhe einbezogen (Höhe halten oder Sammelbanner). Für (a) eine Entscheidung in D4. Folgeticket
  LFH-1037.
- **O6 · Nachweislücken (Kriterien 1 und 4).** Der Komponententest der Rückfrage ist **hier
  geschlossen**: „‹Komponente› entfernen?“ entfernt erst nach „Entfernen“, Abbrechen entfernt
  nichts (zwei Tests in `FernmeldeskizzeBild.test.tsx`; sie bestanden auf Anhieb, belegt über die
  Mutationsprobe Rückfrage übersprungen → beide rot). **Offen:** „Prüfliste 1“ misst ohne
  Komponenten und externe Stellen und nicht bei 1024 px. Schließt: eine erweiterte Saat
  (`seedeGross`) samt Tablet-Breite in der Messung. Folgeticket LFH-1038.
- **O7 · Tag-Ziel für zurückgenommenen Text (Kriterium 5).** Zurückgenommener Text (Deckkraft 0,6)
  hält hell 4,83 : 1, über dem Boden 4,5 : 1, unter dem Tag-Ziel 7 : 1 der Textstufen
  (`frontend/AGENTS.md`, „Textboden für jede Textstufe“); dunkel 6,18 : 1 hält das Nacht-Ziel.
  Offen ist die Entscheidung, ob zurückgenommener Text das Tag-Ziel halten muss (hell ab Deckkraft
  0,71, dunkel ab 0,65 [abgeleitet]) oder als bewusste Ausnahme wie Gesperrtes beim Boden bleibt.
  Schließt: die Entscheidung in design.md, danach Deckkraft bzw. Ausnahme und e2e „Prüfliste 5“
  auch hell. Folgeticket LFH-1039.
