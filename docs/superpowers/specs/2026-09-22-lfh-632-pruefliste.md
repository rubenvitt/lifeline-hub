# Prüfliste Einsatztauglichkeit — Modul „Dokumente" (LFH-632)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite; ein Modul-Task ohne ausgefüllte
Prüfliste gilt nicht als fertig. Die Dokumentenablage ist ein neues Modul unter „Führung".

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/dokumente` (`frontend/src/pages/DokumentePage.tsx`) |
| Stand | Commit `30a8c324` auf `claude/lfh-632-f2fa9d` (Basis `origin/alpha` `47a40665`; Migration `0114_einsatz_dokument.sql`) |
| Zielkontext | Fükw (1280–1366 px, Tastatur + Maus, Nachtbetrieb als Vorgabe) als Primärkontext; Führungs-Tablet in `komfortabel`/`handschuh`; mobil 390 px nur lesend und ablegend, ohne Vergleichsansicht (Kartenform) |
| Nicht enthalten | Vorschau (Bild/PDF), EXIF-/GPS-Bereinigung, Metadaten ändern, Offline-Ablage — nicht gebaut; wo ein Kriterium daran hängt, steht es als „offen" in der Zeile |

| Fläche | Stellvertreter | Browser-Messung (`30a8c324`) |
| --- | --- | --- |
| **1 · Liste** (Tabelle ab `md`, Karten darunter) | `pages/DokumentePage.tsx` auf `components/Datensicht.tsx` | ja: Treffflächen 30 / 48 / 72, Kontrast Tag/Nacht, Fokus-Verdeckung, Formweiche, Querlauf 1280 / 390 px |
| **2 · Dialog „Dokument ablegen"** | `dokumente/DokumentAblegenModal.tsx` auf `components/Erfassung.tsx` (`ErfassungsModal`) | ja: Treffflächen 30 / 48 / 72, Kontrast Tag/Nacht, Fokus beim Öffnen, Tab-Reihe, Tastaturweg, Fokus-Verdeckung 1280 / 390 px |

**Verdikte:** **erfüllt** (nur mit Beleg: Testdatei + Testname, oder Messung + Commit) ·
**offen → Zielticket** · **nicht anwendbar** (nur mit Begründung). „Nicht geprüft" ist keins.
Gerechnetes und aus Quelltext/Grep Geschlossenes trägt **[abgeleitet]**. Eine Annahme wie
„erbt vom `ConfigProvider`" ist kein Beleg (LFH-396).

**Zieltickets:** `LFH-397` besteht (Helligkeitsregler, app-weit), `LFH-643` besteht (globale
Textstufe `schwach` am Tag). Die Folgetickets aus dieser Prüfliste sind angelegt: `LFH-652` bis
`LFH-657`; die Liste steht am Ende unter „Offene Punkte".

---

## Die Nachweise

Alle e2e-Belege stehen in `frontend/e2e/dokumente.spec.ts`. **13 / 13 grün** am Stand `30a8c324`
im vollen Gate `scripts/check-all.sh` (Abschnitt „Gesamt-Gate" unten). Die
Messwerte hängen als Anhang an den Tests.

| Nachweis | Ergebnis | Stand |
| --- | --- | --- |
| e2e „legt ab, zählt, lädt herunter, filtert und entfernt — der ganze Weg im Browser" | Ansteuerung über die Modulzeile (`aria-current` danach gesetzt), kein Zähler bei 0, Fokus beim Öffnen auf „Datei wählen" (`toBeFocused` **und** `document.activeElement` = `BUTTON`, nicht der Datei-Input), Titel aus dem Dateinamen, Zeile im Viewport, Zähler 1 → 2 → 1, Download `Lageplan Nord.pdf`, Filter „Foto", Entfernen mit Rückfrage | `30a8c324` |
| e2e „Formweiche und Querlauf: Tabelle bei 1280 px, Karte bei 390 px" | Tabelle bei 1280, Karten bei 390, `scrollWidth − clientWidth ≤ 0,5` bei beiden; Entfernen im Kartenzweig: Auslöser **nicht** rot, OK der Rückfrage rot, Zeile weg | `30a8c324` |
| e2e „Dichte-Staffel: … › kompakt / komfortabel / handschuh" | Download-Anker, Entfernen (Zeile), Datei wählen, Kategorie, Titel, Abbrechen, Ablegen: **30 / 48 / 72** px (Select kompakt 29,5, Titel kompakt 30,1); Fuge zwischen den Entfernen-Knöpfen zweier Zeilen in `handschuh` ≥ 16 zugesichert, gemessen **15 / 23 / 33** px. Nur gemessen: Klappkopf „Bezug (optional)" **36 / 45 / 55** px, Fuge Abbrechen │ Ablegen **3 / 5 / 7** px | `30a8c324` |
| e2e „Tastaturweg: Dialog öffnen, Datei wählen, Kategorie, Enter legt ab" | Tab-Reihe vorwärts `Datei wählen → Kategorie → Titel → Bezug (optional) → Abbrechen → Ablegen`, rückwärts gespiegelt; die rc-upload-Hülle ist **kein** eigener Tab-Stopp; Enter öffnet den Dateiwähler (Sonde: genau ein `input.click()` je Tastendruck, 12 Läufe, Enter wie Leertaste); nach der Wahl sind Dateiname und „Datei entfernen" Tab-Stopps; Kategorie per Tippen + Enter; Enter im Titel legt ab | `30a8c324` |
| e2e „Kontrast light / dark: Zellen, Dialog und Pflichtmeldung" | **Zugesichert (7 Tag / 5 Nacht):** Kategorie-Zelle, Verfasser · Zeit, Label „Datei", „Datei wählen", Klappkopf. **Gemessen, Boden 4,5:** Titel-Anker (Linkfarbe) **6,59 / 4,55**, Tabellenkopf **5,58 / 5,17**, Bezug „—" (Sekundärtext) **6,37 / 5,03**, Pflichtmeldung (`colorError`) **6,27 / 6,48** | `30a8c324` |
| e2e „Fokus nie verdeckt: Tab-Durchlauf durch die Liste unter der stehenden Kopfzeile" | 1366 × 600, 20 Zeilen, halb gescrollt: **79** Stopps, **45** in der Tabelle, **25** fixierte Kandidaten, **0** verdeckt | `30a8c324` |
| e2e „Fokus nie verdeckt im Ablegen-Dialog bei 1280 / 390 px, kompakt / handschuh" (4 Tests) | Datei gewählt, Bezug aufgeklappt, 24 Tab-Schritte: alle **8** markierten Dialogziele besucht (Datei wählen, Datei entfernen, Kategorie, Titel, Klappkopf, Bezug, Abbrechen, Ablegen), **22** Stopps, fixierte Kandidaten 7 (1280) bzw. 2 (390), **0** verdeckt; in `handschuh` scrollt der Dialog in seiner Hülle (beide Breiten) | `30a8c324` |
| Mutationsproben (zurückgedreht) | Fokus-Callback entfernt → „Fokus liegt beim Öffnen auf „Datei wählen"" rot · `bestaetigungGefahr` entfernt → „das OK der Rückfrage ist rot" rot · `minHeight: 20` am Anker → komfortabel 23 < 48 und handschuh 23 < 72 rot | `d2ffd56b` (die geprüften Tests sind bis `05e36290` unverändert) |
| Sondierlauf (nicht eingecheckt), Seitenkopf und Werkzeugzeile | „Dokument ablegen" und das Suchfeld der Werkzeugzeile **30 / 48 / 72** px | `759a5d74` |
| Grep über `pages/DokumentePage.tsx`, `dokumente/*.tsx` (ohne Tests) | `size=` **0** · Farbliterale (`#…`, `rgb(`, `color=`) **0** · `danger` **2** (Entfernen-Knopf der Tabelle, `okButtonProps` der Rückfrage) · `animation`/`keyframes`/`transition` **0** · `sticky`/`fixed` **0** · Toast-Aufrufe **2**, beide `message.success` im `onSuccess` einer eigenen Mutation | `759a5d74` [abgeleitet] |

**Migrationsnummer:** die Tabelle liegt in `migrations/0114_einsatz_dokument.sql`. Sie wurde nach
zwei Rebases zweimal umnummeriert (`0105` → `0107` → `0114`), weil `origin/alpha` die Nummern
darunter belegte. Die frühere Einschränkung dieser Liste — alpha trug dreimal `0106`, der Server
startete nicht, die Läufe brauchten eine lokale Umnummerierung — ist mit `47a40665` erledigt: alle
Läufe am Stand `30a8c324` liefen ohne jeden Eingriff.

---

## Tabelle 1 — Liste (`pages/DokumentePage.tsx`)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** — Boden ≥ 24 × 24 CSS px oder 24-px-Umkreis frei (WCAG 2.5.8 AA); zeitkritische Aktion ≥ 48 × 48 px mit ≥ 8 px Abstand (WCAG 2.5.5 / Material 48 dp). | **erfüllt** | e2e „Dichte-Staffel …": Download-Anker und Entfernen je 30 / 48 / 72 px, Mutationsprobe am Anker rot. **Zum Anker (Gate 3):** es gibt keine handgebauten Bedienziele außer dem Inline-`<a download>` in der Titelzelle. Er ist Tabellentext wie der Titel-Link der `Datensicht` (CLAUDE.md: in einer Zelle ohne `nowrap`-Kopf trägt die eine Angabe `minHeight`), trägt aber — weil ein Inline-Anker gemessen 17 px hoch ist (LFH-396) — `display: inline-flex` + `minHeight: token.controlHeight` selbst (`DownloadAnker`); gemessen ist damit genau diese eine Angabe, nicht eine Annahme. Die Breite folgt dem Titel (Pflichtfeld, nicht leer: `tests/dokument.rs` `leerer_titel_ist_400`); das icon-only Entfernen ist bei antd so breit wie hoch [abgeleitet]. Kopfaktion und Suchfeld 30 / 48 / 72 (Sondierlauf). Keine zeitkritische Aktion | — |
| 2 | **Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px (= 19,05 mm [abgeleitet], MIL-STD-1472F Fig. 12), Abstand ≥ 16 px [abgeleitet aus Fig. 24, last contact]. | **erfüllt** | e2e „Dichte-Staffel … › handschuh": Anker und Entfernen 72 px; die senkrechte Fuge zwischen den Entfernen-Knöpfen zweier Zeilen ist zugesichert ≥ 16 px und misst **33** px (kompakt 15, komfortabel 23 — nur gemessen). In einer Zeile stehen Anker (Titelspalte) und Entfernen (letzte Spalte) spaltenweit auseinander. Die Stufe wählt die Person (Dichte-Umschalter), grobe Zeiger belegen `komfortabel` vor (LFH-361) | — |
| 3 | **Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms (MIL 5.4.6.4); Kommandoreaktion ≤ 2 s (Tab. XXII); > 15 s nur mit Fortschrittsmeldung (MIL 5.14.9). | **offen** | **Trägt:** Lade-, Leer- und Fehlerzustand sind getrennt — `DokumentePage.test.tsx` „zeigt den Leerzustand bei null Dokumenten und keinen Fehler", „zeigt einen Fehler an der Stelle der Liste, wenn sie ohne Daten scheitert", „zeigt einen Seitenfehler, wenn der Einsatz nicht lädt"; der Download ist ein nativer `<a download>`, der Browser meldet ihn selbst (e2e „legt ab …", Download-Ereignis). **Offen:** nach dem Bestätigen von „Entfernen" gibt es bis zur Serverantwort **keine** sichtbare Änderung an der Zeile (kein `loading`, kein optimistisches Ausblenden) — die Rückfrage schließt, die Zeile steht unverändert, bis Invalidierung und Toast kommen [abgeleitet aus `entfernenMutation`, `DokumentePage.tsx`] | LFH-654 |
| 4 | **Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung (MIL 5.4.6.6). | **erfüllt** | Entfernen ist aus Sicht der Oberfläche unumkehrbar (kein Wiederherstellen-Weg; Soft-Delete serverseitig, `tests/dokument.rs` `entfernen_ist_soft_delete`) und trägt in **beiden** Zweigen eine Rückfrage mit rotem OK: `DokumentePage.test.tsx` „Schreibrecht: Entfernen je Zeile mit roter Rückfrage ruft das Löschen auf", „Kartenzweig: Entfernen mit Zeilennamen, rotem OK und DELETE erst nach Bestätigung"; im Browser e2e „legt ab …" (Tabelle) und „Formweiche und Querlauf …" (Karte, OK rot per Mutationsprobe belegt) | — |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1 (MIL 5.2.4.2.2.2; WCAG 1.4.6/1.4.3); Zustände, Rahmen, Fokusring ≥ 3 : 1 (WCAG 1.4.11). | **offen** | e2e „Kontrast light / dark …": eigene Texte (Kategorie, Verfasser · Zeit) halten 7 / 5. **Unter dem Boden der Stufe, alle geerbt:** Titel-Anker in Linkfarbe **6,59** Tag / **4,55** Nacht (nachts 0,05 über dem absoluten Boden), Tabellenkopf **5,58** / 5,17, Sekundärtext „—" **6,37** Tag. Das sind App-Rollen (antds `colorLink` = `bedien`, Tabellenkopf der `KatalogTabelle`, `colorTextSecondary`) und treffen jeden Datensicht-Titel-Link gleich — ein modul-lokaler Ausweg (z. B. `bedienText` nur hier) bräche „eine Farbe = eine Bedeutung". Die Seitenbeschreibung im Kopf liegt mit 5,33 Tag auf der bekannten Stufe `schwach` | LFH-652, LFH-643 |
| 6 | **Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen (WCAG 1.4.1 Level A; MIL 5.4.6.8; 1 von 12 Männern, NEI). | **erfüllt** | Die Liste trägt keinen farbigen Status: die Kategorie ist ein Wort (Tabelle) bzw. ein `neutral`-Etikett (Karte) — `DokumentePage.test.tsx` „zeigt Titel als Download-Anker, Kategorie, Bezug, Datei, Verfasser und Zeit", „trägt den Download-Anker auch im Kartenzweig"; ein fehlender Bezug ist „—", kein Farbfeld. Der Einsatzstatus im Titel läuft über `StatusTag` (Vertrag `statusFarben.ts`) | — |
| 7 | **Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche aus A0 (weder `#000000` noch `#ffffff`) — ASM Consortium. | **erfüllt** | Rot ausschließlich an der destruktiven Aktion (Entfernen-Knopf der Tabelle und OK der Rückfrage; im Kartenzweig nur das OK — „Rot bedient nichts" am Primitiv-Auslöser) und am Fehlerhinweis; keine Farbliterale, keine eigene Statuskarte (Grep `759a5d74`); `theme/statusVertrag.guard.test.ts` scannt `/src` ganz | — |
| 8 | **Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre (MIL 5.2.2.1.9, 5.2.4.2.2.3). | **offen** | App-weite Lücke, kein Regler in der Anwendung | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand (MIL 5.2.2.1.7). | **erfüllt** | Die einzige kritische Anzeige der Liste ist ein gescheitertes Entfernen; es steht im Hinweis-Slot oben am Seitenkopf statt im verschwindenden Toast: `DokumentePage.test.tsx` „zeigt ein gescheitertes Entfernen im Hinweis-Slot der Seite". Fehlende Rechte stehen als Satz an derselben Stelle: „Beobachter: Knopf gesperrt statt fehlend, Rechte-Hinweis, kein Entfernen" | — |
| 10 | **Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, < 10 in den ersten 10 min einer Großlage, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen (EEMUA 191 S. 96/97; ISA-18.2). | **erfüllt [abgeleitet]** | Kein Toast aus einem Live-Ereignis: die beiden Aufrufe (`Dokument entfernt`, `Dokument abgelegt`) stehen im `onSuccess` der eigenen Mutation (Grep `759a5d74`); ein fremdes Ablegen ändert nur Liste und Modulzähler. Der Zähler ist neutral und zählt, er alarmiert nicht (`einsatz/ModulPanel.tsx`) | — |
| 11 | **Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten (schnellere ≤ 5 Hz, langsamere ≥ 0,8 Hz), jede Warnung quittierbar, jeder Ton mit visueller Entsprechung (MIL 5.2.1.5.5.3/.4/.5, 5.3.6.3). | **erfüllt [abgeleitet]** | Keine Bewegung und kein Ton im Modul (Grep `animation`/`keyframes`/`transition` = 0) | — |
| 12 | **Kein Sprung unter dem Cursor** — CLS ≤ 0,1 (75. Perzentil, web.dev); neue Datensätze nur als opt-in-Sammelbanner (WCAG 3.2.5 / G76). | **erfüllt** | Neue Dokumente kommen live (`dokument` → `einsatz-dokumente`) und stehen per Vorgabe oben (neueste zuerst, `tests/dokument.rs` `liste_zeigt_neueste_zuerst`). Die `Datensicht` hält sie aus der Sicht, solange der Fokus darin liegt, und zeigt das Sammelbanner: `Datensicht.test.tsx` „mit Fokus in der Sicht bleibt die Zeilenmenge stehen und ein Banner erscheint", „die Schleuse greift auch im Kartenzweig". Das Modul setzt kein `zufluss="sofort"`. **Nicht gedeckt:** wer mit der Maus liest, ohne dass der Fokus in der Sicht liegt (Zeiger über der Tabelle, Fokus im Seitenkopf oder nirgends), bekommt einen live abgelegten Eintrag oben eingeschoben; die Zeilen darunter rücken unter dem Zeiger weg. Das ist der Vertrag des Primitivs („verlässt der Fokus die Sicht, läuft der Zufluss ohne Banner durch"), trifft jeden `Datensicht`-Konsumenten gleich und ist hier weder gemessen noch geschlossen. Das Verdikt gilt für den Fokusfall | — |
| 13 | **Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter fixierten Köpfen, Fußleisten oder Drawern (WCAG 2.4.11 AA). | **erfüllt** | e2e „Fokus nie verdeckt: Tab-Durchlauf durch die Liste unter der stehenden Kopfzeile": 79 Stopps, 45 davon in der Tabelle, 25 fixierte Kandidaten, 0 verdeckt (1366 × 600, `kompakt`, halb gescrollt) | — |
| 14 | **Tabellenseite vollständig** — fixierte Kopfzeile, fixierte menschenlesbare Identifierspalte, umschaltbarer Spaltensatz mit Zähler ausgeblendeter Spalten, keine Auflösung in Karten, wo verglichen wird (NN/g Data Tables / Mobile Tables). | **erfüllt** | Die Frage ist „welches dieser Dokumente ist das richtige?" → Tabelle über `Datensicht` (stehende Kopfzeile und fixierte Spalte 0 aus `KatalogTabelle`); die Kennung ist der **Titel** (`immerSichtbar`), nie die DB-`id`; Bezug (`abBreite: 'lg'`) und Datei (`'xl'`) laufen durch den Spaltenschalter mit Zähler. Die Karten unter `md` sind der Vorgabezweig `form="auto"` des Primitivs (begründet im Dateikopf von `Datensicht.tsx`, AK3b), belegt in e2e „Formweiche und Querlauf …"; Filter und Suche: `DokumentePage.test.tsx` „filtert über den Spaltenfilter „Kategorie"", e2e „legt ab …" (Filter „Foto") | — |
| 15 | **Erfassungsmaske vollständig** — Defaults vorbelegt, sichtbar und einzeln überschreibbar (MIL 5.14.7.1/.3), „Speichern und nächsten anlegen" mit gehaltenem Kontext (5.14.7.4), Sammelliste mit Ändern/Entfernen je Zeile (DWP „Add another thing"), Labels über dem Feld (50 ms statt 500 ms Sakkade, Penzo), volle Tastaturbedienung (WCAG 2.1.1). | **nicht anwendbar** | Keine Erfassung auf der Fläche; die Maske ist Fläche 2. Die Sammelliste als Teil dieses Kriteriums ist in Tabelle 2, Nr. 15 bewertet | — |

**Verdikt-Bilanz:** 11 erfüllt (davon 2 [abgeleitet]) · 3 offen · 1 nicht anwendbar.

---

## Tabelle 2 — Dialog „Dokument ablegen" (`dokumente/DokumentAblegenModal.tsx`)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** — Boden ≥ 24 × 24 CSS px oder 24-px-Umkreis frei (WCAG 2.5.8 AA); zeitkritische Aktion ≥ 48 × 48 px mit ≥ 8 px Abstand (WCAG 2.5.5 / Material 48 dp). | **erfüllt** | e2e „Dichte-Staffel …": Datei wählen, Kategorie, Titel, Abbrechen, Ablegen je 30 / 48 / 72 px; der Klappkopf „Bezug (optional)" liegt mit 36 / 45 / 55 px ebenfalls über dem 24-px-Boden. Nur antd-Steuerelemente, kein handgebautes Ziel. Keine zeitkritische Aktion | — |
| 2 | **Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px (= 19,05 mm [abgeleitet], MIL-STD-1472F Fig. 12), Abstand ≥ 16 px [abgeleitet aus Fig. 24, last contact]. | **offen** | Gemessen in `handschuh` (e2e „Dichte-Staffel … › handschuh", Anhang): fünf Ziele 72 px. **Zwei Befunde, beide nicht modul-eigen:** der Klappkopf von antds `Collapse` folgt der Staffel nicht (**55** px statt 72; `komfortabel` 45 statt 48) — er steht in jeder Erfassungsmaske mit „Weitere Angaben"; die Fuge zwischen „Abbrechen" und „Ablegen" ist **7** px statt 16 — sie kommt aus der Fußzeile der Erfassungs-Hülle (`abstand.xs`). Nicht gemessen: Dateiname und „Datei entfernen" in der Upload-Liste | LFH-653 |
| 3 | **Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms (MIL 5.4.6.4); Kommandoreaktion ≤ 2 s (Tab. XXII); > 15 s nur mit Fortschrittsmeldung (MIL 5.14.9). | **offen** | **Trägt:** `laeuft={mutation.isPending}` → `loading` am Knopf „Ablegen" (`Erfassung.tsx`), Doppel-Absenden gesperrt (`Erfassung.test.tsx` „sendet bei gehaltener Taste nicht doppelt"); Titel sofort aus dem Dateinamen (`DokumentAblegenModal.test.tsx` „füllt einen leeren Titel mit dem Dateinamen ohne Endung"). **Offen:** ein Upload bis 25 MiB plus Virenscan über eine Mobilfunkstrecke ist ausdrücklich länger als 15 s eingeplant (`DOKUMENT_UPLOAD_TIMEOUT_MS = 120_000`, `api/dokumente.ts`) — die Rückmeldung ist dann ein drehender Knopf **ohne Fortschritt**. Ohne Netz scheitert die Ablage (keine Queue wie bei der Personen-Erfassung) | LFH-654 |
| 4 | **Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung (MIL 5.4.6.6). | **nicht anwendbar** | Ablegen ist keine kritische Aktion: es ist über „Entfernen" umkehrbar (Tabelle 1, Nr. 4) und schreibt nur einen System-ETB-Eintrag als Nachweis (`tests/dokument.rs` `ablegen_schreibt_system_etb_eintrag`). Pflichtfelder statt Rückfrage (Nr. 15) | — |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1 (MIL 5.2.4.2.2.2; WCAG 1.4.6/1.4.3); Zustände, Rahmen, Fokusring ≥ 3 : 1 (WCAG 1.4.11). | **offen** | e2e „Kontrast light / dark …": Label, „Datei wählen" und Klappkopf halten 7 / 5. **Unter dem Tagesboden:** die Pflichtmeldung „Bitte eine Datei wählen" in antds `colorError` mit **6,27** Tag (Nacht 6,48). Geerbt wie jede Formularmeldung der Anwendung; LFH-618 hat `alarmText` für Statustext eingeführt, die Formularmeldung nutzt ihn nicht. Nicht gemessen: Fehler-`Alert` im Dialog, Optionsliste im Portal | LFH-652 |
| 6 | **Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen (WCAG 1.4.1 Level A; MIL 5.4.6.8; 1 von 12 Männern, NEI). | **erfüllt** | Jede Meldung ist ein Satz: Pflichtmeldungen je Feld (e2e „Kontrast …", `Bitte eine Datei wählen`), Ablehnung mit Überschrift „Nicht abgelegt" IM Dialog: `DokumentAblegenModal.test.tsx` „lässt Titel und Datei bei Ablehnung stehen und zeigt den Fehler IM Dialog" | — |
| 7 | **Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche aus A0 (weder `#000000` noch `#ffffff`) — ASM Consortium. | **erfüllt** | Kein `danger` im Dialog (Grep: beide Treffer liegen in der Seite), Rot nur für Fehler; „Ablegen" ist blau als Primäraktion | — |
| 8 | **Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre (MIL 5.2.2.1.9, 5.2.4.2.2.3). | **offen** | App-weite Lücke, kein Regler | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand (MIL 5.2.2.1.7). | **erfüllt** | Eine Ablehnung (Dateityp, fremdes Bezugsziel → 400) steht als `SpeicherFehler` oben im offenen Dialog, die Felder bleiben: `DokumentAblegenModal.test.tsx` „lässt Titel und Datei bei Ablehnung stehen und zeigt den Fehler IM Dialog" (LFH-345 · H14) | — |
| 10 | **Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, < 10 in den ersten 10 min einer Großlage, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen (EEMUA 191 S. 96/97; ISA-18.2). | **erfüllt [abgeleitet]** | Genau ein Erfolgs-Toast nach der eigenen Handlung (`message.success('Dokument abgelegt')` im `onSuccess`), kein Fehler-Toast — der Fehler steht im Dialog (Nr. 9) | — |
| 11 | **Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten (schnellere ≤ 5 Hz, langsamere ≥ 0,8 Hz), jede Warnung quittierbar, jeder Ton mit visueller Entsprechung (MIL 5.2.1.5.5.3/.4/.5, 5.3.6.3). | **erfüllt [abgeleitet]** | Kein Blinken, kein Ton; die einzige Bewegung ist die Zoom-Einblendung des antd-Dialogs beim Öffnen (einmalig, kein Warnsignal) | — |
| 12 | **Kein Sprung unter dem Cursor** — CLS ≤ 0,1 (75. Perzentil, web.dev); neue Datensätze nur als opt-in-Sammelbanner (WCAG 3.2.5 / G76). | **offen** | **Trägt:** die Dateiwahl setzt den Titel nur, solange er leer oder automatisch gesetzt ist (`DokumentAblegenModal.test.tsx` „überschreibt einen schon getippten Titel NICHT", „ersetzt einen automatisch gesetzten Titel bei neuer Dateiwahl"); der Bezug klappt nur auf Nutzeraktion auf. **Offen:** die Optionen der Bezugswahl stammen aus drei Live-Keys (`einsatz-abschnitte`, `einsatz-einheiten`, `einsatz-etb`, `api/queryKeys.ts`). Kommt bei geöffneter Liste ein ETB-Eintrag dazu, steht er **oben** in seiner Gruppe (neueste zuerst) und schiebt die Einträge darunter weg; ein neuer Abschnitt schiebt die Gruppen „Einheiten" und „ETB-Einträge" — ohne Sammelbanner [abgeleitet, nicht gemessen]. Derselbe Befund wie Stab 3 · 12 | LFH-655 |
| 13 | **Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter fixierten Köpfen, Fußleisten oder Drawern (WCAG 2.4.11 AA). | **erfüllt** | e2e „Fokus nie verdeckt im Ablegen-Dialog bei 1280 / 390 px, kompakt / handschuh": Datei gewählt und Bezug aufgeklappt, alle acht Dialogziele per Tab besucht, **0** verdeckt — auch in `handschuh`, wo der Dialog höher als der Schirm ist und in seiner Hülle scrollt; fixiert sind dabei Maske und Kopfleiste (7 Kandidaten bei 1280, 2 bei 390). Die Reihenfolge selbst: e2e „Tastaturweg …" (vor- und rückwärts) | — |
| 14 | **Tabellenseite vollständig** — fixierte Kopfzeile, fixierte menschenlesbare Identifierspalte, umschaltbarer Spaltensatz mit Zähler ausgeblendeter Spalten, keine Auflösung in Karten, wo verglichen wird (NN/g Data Tables / Mobile Tables). | **nicht anwendbar** | Maske, keine Menge | — |
| 15 | **Erfassungsmaske vollständig** — Defaults vorbelegt, sichtbar und einzeln überschreibbar (MIL 5.14.7.1/.3), „Speichern und nächsten anlegen" mit gehaltenem Kontext (5.14.7.4), Sammelliste mit Ändern/Entfernen je Zeile (DWP „Add another thing"), Labels über dem Feld (50 ms statt 500 ms Sakkade, Penzo), volle Tastaturbedienung (WCAG 2.1.1). | **offen** | **Trägt:** Hülle `ErfassungsModal`, Knopf im `<form>`, keine Modal-Fußzeile (`DokumentAblegenModal.test.tsx` „Struktur statt Tastendruck: Absende-Knopf im <form>, keine Modal-Fußzeile"); Feldbudget 3 sichtbar + Bezug eingeklappt im Baum („Feldbudget: drei sichtbare Felder, der Bezug zählt erst aufgeklappt"); Titel aus dem Dateinamen vorbelegt, sichtbar und überschreibbar (Tests in Nr. 12); Kategorie **bewusst ohne** Vorbelegung (ein als „Sonstiges" durchgerutschtes Foto findet der Filter nicht mehr, Dateikopf `DokumentAblegenModal.tsx`); zurückgesetzt auf jedem Weg hinaus, Datei eingeschlossen („schließt nach Erfolg und ist beim Wiederöffnen leer — Datei eingeschlossen"); Labels über dem Feld (`layout="vertical"` der Hülle); **volle Tastaturbedienung im Browser**: e2e „Tastaturweg: Dialog öffnen, Datei wählen, Kategorie, Enter legt ab" samt Fokus beim Öffnen (e2e „legt ab …"). **Bewusst nicht:** „Speichern und nächste" — jede Ablage braucht einen eigenen Dateiwähler-Durchgang. **Offen:** die Sammelliste (Tabelle 1) hat Entfernen, aber **kein Ändern** je Zeile — ein falsch gewählter Titel, eine falsche Kategorie oder ein vergessener Bezug lassen sich nur durch Entfernen und neues Ablegen korrigieren. Dazu ein Tab-Stopp ohne Aktion: nach der Dateiwahl ist der Dateiname in antds Upload-Liste ein `span role="button" tabindex="0"`, ohne `onPreview` bewirkt Enter darauf nichts (Sonde: Fokus bleibt, keine Navigation, kein neues Fenster; 3 Läufe) | LFH-656, LFH-657 |

**Verdikt-Bilanz:** 7 erfüllt (davon 2 [abgeleitet]) · 6 offen · 2 nicht anwendbar.

---

## Gesamtbilanz

| Fläche | erfüllt | offen | nicht anwendbar |
| --- | --- | --- | --- |
| 1 · Liste | 11 | 3 | 1 |
| 2 · Dialog „Dokument ablegen" | 7 | 6 | 2 |
| **Summe (30 Zeilen)** | **18** | **9** | **3** |

## Offene Punkte

| Fläche · Nr. | Was fehlt | Zielticket |
| --- | --- | --- |
| 1 · 3 | Keine sichtbare Änderung an der Zeile zwischen bestätigtem Entfernen und Serverantwort | LFH-654 |
| 1 · 5 | Titel-Anker (Linkfarbe) 6,59 / 4,55, Tabellenkopf 5,58 Tag, Sekundärtext 6,37 Tag — app-weite Rollen | LFH-652 |
| 1 · 5 | Seitenbeschreibung 5,33 Tag (Stufe `schwach`) | LFH-643 |
| 1 · 8 | Helligkeits-/Kontrastregler (app-weit) | LFH-397 |
| 2 · 2 | Klappkopf `Collapse` 55 px in `handschuh`; Fuge der Fußknöpfe 7 px statt 16 — Erfassungs-Hülle, app-weit | LFH-653 |
| 2 · 3 | Upload bis 25 MiB ohne Fortschrittsanzeige (> 15 s eingeplant); keine Offline-Ablage | LFH-654 |
| 2 · 5 | Pflichtmeldung in `colorError` 6,27 Tag — app-weit alle Formularmeldungen | LFH-652 |
| 2 · 8 | Regler (app-weit) | LFH-397 |
| 2 · 12 | Bezugswahl folgt drei Live-Keys; neue Einträge schieben die offene Optionsliste | LFH-655 |
| 2 · 15 | Kein „Ändern" je Zeile: Metadaten (Titel, Kategorie, Bezug) nachträglich ändern | LFH-656 |
| 2 · 15 | Dateiname in der Upload-Liste ist Tab-Stopp ohne Aktion | LFH-657 |

**Folgetickets aus dieser Prüfliste** (angelegt):

- **LFH-652 — Textkontrast der geerbten Rollen am Tag:** Linkfarbe (`colorLink` = `bedien`) als
  Text 6,59 Tag / 4,55 Nacht, Tabellenkopf 5,58 Tag, `colorTextSecondary` 6,37 Tag,
  Formularmeldung `colorError` 6,27 Tag. Trifft jeden Titel-Link der `Datensicht` und jede
  Formularmeldung, deshalb app-weit und nicht im Modul.
- **LFH-653 — Erfassungs-Hülle im Handschuhbetrieb:** Klappkopf von antds `Collapse` folgt der
  Dichte-Staffel nicht (36 / 45 / 55 px), Fuge der Fußknöpfe 3 / 5 / 7 px statt ≥ 16 in
  `handschuh`.
- **LFH-654 — Rückmeldung bei langen Vorgängen der Dokumentenablage:** Fortschrittsanzeige beim
  Hochladen (bis 25 MiB, Timeout 120 s), sichtbarer Zustand der Zeile während des Entfernens;
  die Offline-Ablage mit Queue und `client_id` (Kandidat aus dem Plan) gehört hierher.
- **LFH-655 — Bezugswahl im Ablegen-Dialog einfrieren**, solange die Optionsliste offen ist (oder
  neue Einträge hinten anhängen); dazu der bereits vermerkte Nachzug „ETB-Bezugswahl nur die
  jüngsten 100 Einträge" (serverseitige Suche).
- **LFH-656 — Metadaten eines abgelegten Dokuments nachträglich ändern** (Titel, Kategorie,
  Bezug; Kandidat aus dem Plan).
- **LFH-657 — Upload-Liste ohne leeren Tab-Stopp:** der Dateiname in antds Upload-Liste ist ohne
  `onPreview` ein fokussierbares `role="button"` ohne Wirkung; entweder die Vorschau daran
  hängen (Plan-Kandidat „Vorschau") oder den Eintrag aus der Tab-Reihe nehmen. Trifft jede
  Upload-Maske der Anwendung.

**Kandidaten aus dem Plan, die hier nicht zutreffen:** Vorschau (Bild/PDF-Quick-View) und
EXIF-/GPS-Entfernung berühren keines der 15 Kriterien — der Download ist der vollständige
Lesepfad (Nr. 3, Nr. 14), und Metadaten in Fotos sind eine Datenschutz-, keine
Bedienfrage. Sie sind deshalb nicht als offene Zeile geführt.

---

## Gesamt-Gate

`scripts/check-all.sh` am Stand `30a8c324` (Basis `origin/alpha` `47a40665`, ohne lokalen
Eingriff), mit `CARGO_TARGET_DIR=~/.cache/cargo-target-lfh632` und einem Binary, das aus diesem
Baum neu gebaut wurde (Migration `0114` eingebettet): **alle neun Schritte grün** — rustfmt/
Prettier, Lint, Typ-Drift, Rust-Suite (Hauptpaket 1519 bestanden), Vitest 403 Dateien / 5128
Tests, Advisory-Gate, e2e **199 bestanden** (davon 13 in `dokumente.spec.ts`), Ruhefenster- und
Advisory-Selbsttest.

**Frühere Läufe** (vor dem Rebase auf `47a40665`, damals mit lokaler Umnummerierung der dreifachen
`0106` von alpha): am Stand `759a5d74` alle neun Schritte grün, e2e 194 bestanden. Der Lauf davor
(`d2ffd56b`) war in Schritt 7 mit **193 / 1** rot: „Tastaturweg …" drückte Enter in der Kategorie,
bevor die Liste auf den Treffer gefiltert war. Der Fix in `759a5d74` wartet auf den gefilterten,
aktiven Eintrag und prüft danach den Titel des gewählten Eintrags statt des Textinhalts der Hülle
(der unter antd 6 den getippten Suchtext enthält und deshalb schon vor der Wahl passte). In
`05e36290` öffnet der Tastaturweg den Dateiwähler mit Enter statt mit der Leertaste (Sonde: kein
Doppelauslösen).
