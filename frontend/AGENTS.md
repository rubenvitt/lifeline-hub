# Frontend — Regeln

Gilt für alles unter `frontend/`, zusätzlich zur `AGENTS.md` der Wurzel. Pfade ohne
Präfix sind relativ zu `frontend/src/`. Fachblöcke mit eigenem Ort stehen in der Regelkarte
der Wurzel-`AGENTS.md`.

## Frontend — Gestaltungssprache Neuentwurf „Instrumententafel“ (22.09.2026)

Fortschreibung des ersten Entwurfs (LFH-352: dunkel, Radius 0, Archivo/JetBrains Mono, Bedienfarbe blau).
**Maßgeblich:** `docs/design/2026-09-21-neuentwurf/umsetzung.md` (Entscheidungen, Palette);
Entwürfe daneben (`neuentwurf.dc.html`, `shell.dc.html`, Inline-Styles maßgeblich;
`_ds/…/tokens/*.css` ist alt). Bei Konflikten gewinnt das Design — **außer bei der Sichtung**
(BBK). Umgekehrte Altregeln tragen „Neuentwurf 22.09.2026".

- **Größere UI-Entwürfe über das Design System** (Ruben, 08.10.2026, geändert 19.10.2026,
  LLH-1333): Bei etwas wirklich Größerem (neue Seite, neues Modul, Umbau des Rahmens, neuer
  Baustein; nicht bei einem Feld oder Knopf) entwirft der Agent selbst mit `/design` bzw. dem
  Artifact-Typ „Design“ auf Grundlage des Design Systems **„Lifeline Hub“** (Adresse in
  `docs/design/design-system/ARTIFACT.md`), auch in einer Cloud-Sitzung: kein Angebot, kein
  Prompt für Ruben, kein Entwurfsabschnitt im Ticket. Das Ergebnis landet wie der Neuentwurf unter
  `docs/design/<datum>-<thema>/` (Inline-Styles maßgeblich).
  - **Das Design System ist aus dem Code erzeugt** (`docs/design/design-system/project/`,
    Generator `frontend/scripts/design-system/`, Wächter `designSystem.guard.test.ts`, Change
    `uzfj5f43-design-system-aus-code`); von Hand gepflegt wird es nicht, Änderungen auf der Seite
    überschreibt die nächste Veröffentlichung. Ändert ein PR das Theme (`theme/tokens.ts`,
    `theme/schriften.ts`, `theme/statusFarben.ts`, `theme/rollen.css`, `theme/sprache.css`,
    `index.css`), `components/instrument/statusFlaeche.ts`, einen vorgestellten Baustein, einen
    Regelabschnitt, den die README trägt, oder `theme/gesperrtZeichen.guard.test.ts` (README
    „Gesperrt“), oder hebt er antd oder eine Schrift, läuft
    `mise exec -- pnpm -C frontend design-system`, und das Erzeugte kommt mit in den PR. Ein roter
    Wächter heißt dasselbe. Ein neuer Baustein bekommt eine Karte in `PREVIEWS`
    (`frontend/scripts/design-system/previews.tsx`), aus dem echten Baustein, Nacht und Tag.
  - **Nach dem Merge veröffentlicht der Agent, der den PR abschließt, neu**: aus dem Stand von
    `alpha` auf die Adresse in `ARTIFACT.md`, nur die geänderten Dateien unter `project/`. Den
    Index `design-system.json` gibt es nur im Artifact: zuletzt und einzeln senden, unmittelbar
    vorher lesen, alle Schlüssel und `createdOnFiles` behalten, nur `lastChange` setzen (`via`
    „Claude Code aus lifeline-hub <Commit>“). Ohne claude.ai-Anmeldung vermerkt er das als
    Kommentar an der Aufgabe. Das Artifact gehört allein Ruben (mit zwei Unterkonten): Neu
    veröffentlichen ist ohne Rückfrage freigegeben, auch das Entfernen von Dateien, die auf
    `alpha` fehlen (Ruben, 18.11.2026).

- **Nachtbetrieb ist Vorgabe:** `MODUS_DEFAULT = 'dark'` in `theme/ThemeModeProvider.tsx`,
  **gespiegelt im Bootstrap-Skript von `index.html`** — immer beide ändern. Hellpalette aus der
  Nachtpalette abgeleitet.
- **Vier Flächenstufen** (LLH-1783, Spec `farbrollen-kontrast`, Wächter in `theme/tokens.test.ts`):
  `grund`, `paneel`, `kopf`, `flaeche`, `flaeche2`, `flaeche3` belegen je Modus höchstens vier
  Werte, je Schritt ≥ 1,10 : 1, zusammengelegt entlang der Helligkeitsfolge des Modus (nachts
  `grund` = `paneel`, `kopf` = `flaeche`; am Tag `paneel` = `flaeche2`, `grund` = `kopf`). Ein
  fünfter Wert ist eine Entscheidung, kein Nachtrag. Der dauerdunkle Rahmen (`rahmenFarben`) ist
  keine Inhaltsfläche und hält seine Werte selbst. Das gewählte Segment der `Segmentleiste`
  trägt zusätzlich eine 2-px-Bedienkante unten (eine Typkante ersetzt sie).
- **Rollen** in `theme/tokens.ts` + `theme/rollen.css` (Gate 5), u. a. `kopf`, `paneel`,
  `flaeche3`, `text2`, `steuerRahmen` (= antds `colorBorder`), `bedienText`, Statusflächen,
  `bannerGrund`/`bannerLinie`, Zeilentönungen. `rahmenFarben` ist modusunabhängig und keine
  `Farbrolle` (`rollen.guard.test.ts`). Eigene Paletten statt `Statusrolle`:
  `etbTypFarben{Dunkel,Hell}` (`etbTypFarbe()`), `warnstufeFarben{Dunkel,Hell}`
  (`warnstufeBalkenFarbe()`), `fachebeneFarben{Dunkel,Hell}` (`fachebeneFarbe()`, LFH-593:
  Ebenen-Identität, keine Vertragskarte; `FachebeneDef` trägt keine Farbe).
- **`schriftskala`** (CSS `--lfh-typo-*`, deckungsgleich per `rollen.guard.test.ts`). Zahlen,
  Zeiten, Funkrufnamen, Koordinaten, Nummern immer Mono mit `tabular-nums`. Die Dichte-Staffel
  30/48/72 gilt, nicht die Entwurfsskizze. Text setzt `Textstufe` (Stufe und Ton), Titel einer
  Karte oder eines Listeneintrags die Stufe `kartentitel` (15/600); 13 px gibt es nur als
  Mono-Stufe `mono`. Mono-Text nimmt `monoStil(stufe)` mit `meta` 11, `monoKlein` 12, `mono` 13,
  `monoGross` 14 oder `datenwert*`, eine Zahl nur aus einer Variablen (LLH-1972). **Boden 11 px**
  (`SCHRIFT_BODEN`, LLH-2044): keine Stufe darunter, Augenbraue und Rail-Etikett 11, Seitentitel
  16/600; darunter bleiben nur Druck, Zeichnungen mit eigenem Maßstab und der Lagemonitor
  (ADR-0087). Die Stufen wachsen nicht mit der Dichte (Spec `schriftstufen`, LLH-1810). Neue
  `fontSize`-Zahlen und `monoStil(<Zahl>)` verbietet `theme/schriftgroesse.guard.test.ts`; die
  Altlast steht in `schriftgroesse.schuld.ts` und sinkt wie beim Abstandsraster.
- **Abstandsraster** (Spec `abstandsraster`, LLH-1809): Abstände kommen aus dem Raster der aktiven
  Dichte (`dichten[*].abstand` in `theme/tokens.ts`), Stufen `xxs`·`xs`·`sm`·`md`·`lg`·`xl` auf
  Vielfachen von 4. Die Werte sind kompakt 4·4·8·12·16·24, komfortabel 4·4·12·20·28·40 und
  handschuh 4·8·16·24·44·64. In TSX nimmst du das antd-Token (`paddingXXS…XL`, `marginXXS…XL`;
  MD = LG). In CSS nimmst du `var(--lfh-luft-0…5)`. antds Steuerelement-Polster
  (`controlPaddingHorizontal`/`…SM`) stehen auf `md`/`sm`; die Inhaltspolster (`paddingContent*`:
  Knopf, Modal, Alert, Liste) bleiben bewusst antds feste Werte. Ein festes Kompakt-Raster gibt es nicht.
  Zahl-Literale über 2 px in `padding*`/`margin*`/`gap`, `<Space size>`, `gap=` und `gutter`
  verbietet `theme/abstandsraster.guard.test.ts` ohne Schuldliste (ADR-0067). Wo kein `token` zur
  Hand ist (Stil auf Modulebene, `tagRender`), nimmst du `var(--lfh-luft-*)`; ein Wert, der kein
  Layoutabstand ist (Kartenrand bei `fitBounds`), steht als benannte Konstante. Feste Ausnahmen
  (Lagemonitor, Hilfe-Prosa, Anmeldung, Druck) stehen mit Grund im Wächter. Elemente
  reiht `Stapel abstand="…"` (Stufe, nie Zahl) statt `Space direction="vertical"` oder eines
  Flex-`div` mit `gap`.
- **Bausteine** in `components/instrument/` (Import über `index.ts`, Dateikopf nennt die Regel):
  `Augenbraue` (`als="h2…h6"`; nur Köpfe: Paneel, Kennzahl, Tabellen-, Gruppen- und
  Abschnittskopf, Rail) · `Feldetikett` (benennt ein Feld: gemischt, `textKlein`, `gedaempft`, ohne
  Sperrung, `als="dt"` im Datenraster, `als="label"` an einer Eingabe; kein `style`, LLH-2045;
  die Augenbraue benennt kein Feld) · `Paneel`/`PaneelZeile` · `Formularpaneel` (Hülle im selben `<Form>`) ·
  `PaneelZustand` · `Kennzahl`/`Kennzahlenband` („Zahl führt") · `Aufgliederung`/`Balken` (nie
  Ersatz der Zahl) · `Zeitachseneintrag` · `StatusZelle`/`Status` (`wort` Pflicht, Übersetzung
  nur in `statusFlaeche.ts`; `Status` randlos, getönt, Formzeichen, Größen `klein`/`normal`) ·
  `Marke` (Kennzeichnung ohne Zustand, neutral, randlos; `onEntfernen` macht sie bedienbar) ·
  `StatusKnopf`/`StatusBlock` (bedienbarer Status, nur über `StatusWahl`; Spec
  `status-darstellung`, Change `eon26eat-status-und-bedienung`) · `Segmentleiste` (statt antds `Segmented`; wann welche Form: Bausteinwahl, „Umschalten“;
  `SegmentFeld` als Formularfeld; `SegmentUmschalter` als ein Umschaltknopf daneben, LLH-1065; Wortlaut einzeilig; ein `\n` im `label` bricht ihn in zwei
  Zeilen, nur wo die Höhe sie trägt und einzeilig kein Platz bliebe: „Ohne\nSchicht“ der
  Ablösung im Handschuh-Betrieb auf dem Handschirm, LLH-1128) · `Sammelbanner` ·
  `Filterhinweis` (Band über einer gefilterten Liste, Achtungsrolle, Zahlen nur aus Serverzählungen, LLH-1071) ·
  `Schnellerfassungszeile` · `Datenraster`/`Datenfeld` (statt `Descriptions`) ·
  `DatenfeldEingabe` (Zelle im Bearbeiten-Modus: Etikett benennt die Eingabe, `Form.Item` ohne
  `noStyle`, der Prüffehler steht darunter, LLH-1101; nie `Form.Item noStyle` im `Datenfeld`) ·
  `BearbeitbaresPaneel` (Bearbeiten in der Ansicht, Paneel oder ganze Ansicht, LLH-1139; der
  einzige Baustein dafür, siehe „UI-Form-Leitlinie“; weitere Handlungen am Datensatz über
  `zusatz` vor „Bearbeiten“, nur im Lesezustand, LLH-1920) ·
  `FeldFehler` (Fehlerzeile unter einer Eingabe ohne `Form.Item`: `alarmText`, `data-fehler`, Ziel
  von `aria-describedby`; dieselbe Optik wie antds Formularmeldung) · `UebungsMarke`/`UebungsBand`
  (Kennzeichnung einer Übung, Regel unter „Rahmen“, „Übung“) · `AlarmZeile` („Was brennt“, LLH-1743,
  Regel im Dashboard-Baukasten) · `rollenwerte`/`useRollen` · Dashboard-Baukasten (unten) ·
  `Textstufe` (Stufe und Ton, kein `style`) · `Stapel` (Abstand als Rasterstufe) · `Knopfreihe` (Knöpfe nebeneinander, Abstand `md`, „Aktionen“) · `MetaZeile`
  (Angaben mit „·“, leere Teile fallen weg, `Teil mono` für Zahlen) · `Feld` (`Form.Item` mit
  `breite` `kurz`·`schmal`·`mittel`·`voll` = 120·200·320·ganz, fluid; Spec `feldbreiten`;
  Felder einer Zeile und das letzte Feld eines Dialogs: `abstand="ohne"` statt `marginBottom: 0`,
  `zeile` mit derselben Stufe als Flex-Basis statt `flex`, LLH-1999). Im
  Verwaltungsteil, auf den Einsatzseiten unter `pages/` samt Fach- und Restbereichen (LLH-1971),
  in ETB, Aufträgen, Meldungen, Nachforderungen, Lageberichten, Erinnerungen und Chat (LLH-1969)
  sowie in Personen, Betreuung, Verpflegung, Kräfte und Ablösung (LLH-1970; Liste `BEREICHE`)
  verlangt `components/feld.guard.test.ts` `Feld` statt `Form.Item` und keine Breite am
  Eingabefeld; ein Feld ohne Formular steht in einem `div` mit
  `className={FELD_KLASSE}` und `maxWidth: 'var(--lfh-feld-…)'` (dann füllen auch Zahl, Datum
  und Auswahl die Hülle).
- **Bausteine außerhalb von `instrument/`** (LLH-1147; Regel je am genannten Spiegelstrich):
  `anzeige/ZeitpunktEingabe.tsx` (Zeiteingabe) · `anzeige/ZeitAnzeige.tsx` (Zeitdarstellung) ·
  `anzeige/Ortsfeld.tsx`, im Einsatz `anzeige/EinsatzOrtsfeld.tsx` (Ortsfeld) ·
  `components/StammdatenFeld.tsx` (aus Stammdaten oder frei) · `components/VerbindungenFeld.tsx`
  und `components/FunkUndTelefon.tsx` (Verbindungen) · `components/InlineAngabe.tsx` ·
  `components/tabellenFilter.tsx` (Filterchips und Kopfmarke; Träger `KatalogTabelle`,
  `Datensicht`; Sortieren und Filtern in der Bedien-Leitlinie) · `alarm/EingaengeKnopf.tsx` und
  `alarm/Eingangsband.tsx` (Eingänge, Layout und Live) · `alarm/AlarmZone.tsx` (Alarmzone,
  Rahmen) · `personen/SichtungsWahl.tsx` ·
  `personen/koerperschema/Koerperschema.tsx` · `zeichen/EinsatzZeichen.tsx` (taktische Zeichen,
  am Schirm mit `useZeichenTheme`, LLH-1409) · `components/grossbild/` (Großbild am Bedienplatz,
  LLH-1747, Spec `grossbild-ansicht`: `GrossKennzahl`, `GrossZeile(n)`, Hülle `GrossbildFlaeche`
  mit Element-Vollbild, nur Ansehen; Größen nur über `grossMass`, Bezug 1920 × 1080 = Lagemonitor,
  mitwachsend über `min(vw, vh)`). Jeder hat eine Karte im Design System, außer der Hülle
  `GrossbildFlaeche` (Portal und Vollbild).
- **Seitenkopf** `components/EinsatzSeite.tsx` (`SEITENKOPF_HOEHE` 44 px, wächst mit der
  Staffel): `titel` als `h1` (Paneele ab `h2`), `meta` Mono, `aktionen` rechts (Primär blau
  gefüllt, sekundär umrandet); Meta + Datenstand unter `md` eigene Zeile, Datenstand hält vorab
  seine Breite. Kommt die Meta erst mit den Daten, hält `metaPlatzhalter` (ihre Form, Zahlen als
  `0`) ihre Breite, sonst brechen die Aktionen nachträglich um (LLH-1463). Wechselt eine Kopfaktion
  ihren Wortlaut mit den Daten (früher „Auflösen (noch 2 Personen)“, jetzt im ⋮; LLH-1722), hält
  `components/BreiteHalten.tsx` die Breite der breitesten Form (LLH-1627). `breite` Vorgabe `'voll'`, `'schmal'` nur für reine Formularseiten,
  `flaeche.seiteBreit` fällt beim Umbau.
- **Orientierung** (LFH-954, Spec `seiten-orientierung`): den Tab-Titel setzen nur die Rahmen über
  `components/useDokumentTitel.ts`, aus dem Modulnamen der Registry („Seite · Einsatz ·
  lifeline-hub“); keine Seite setzt `document.title`. Der Einsatzstatus steht nie im h1, sondern
  als `EinsatzstatusMarke` neben dem Titel, nur bei nicht aktivem Einsatz (Rahmenkontext
  `einsatz/EinsatzRahmenKontext.tsx`). Im Ortspfad kürzt unter `md` nur der mittlere Eintrag; im
  Einsatzrahmen steht unter `md` statt des Ortspfads nur der Rückweg „‹ <Eintrag>“ zum letzten
  verlinkten Eintrag unterhalb des Einsatzes (`lfh-ortspfad--einsatz`, LLH-1728).
- **Markdown** (`components/Markdown.tsx`, `MarkdownEditor`): Pflicht-Prop `unterEbene` (Ebene der
  nächsten Überschrift darüber, Boden `h6`, kein fester Versatz). Der optionale Bild-Renderer
  `bild` gehört nur der Hilfe (`docs/anwender/AGENTS.md`, „Bilder“).
- **Liste** (`components/Liste.tsx`): Kopf `kopf.unterEbene` (Pflicht im Kopf), Eintragstitel
  (`ListenEintragMeta`) eine Ebene unter dem Kopf, ohne Kopf aus `unterEbene` an der Liste,
  ohne beides keine Überschrift. `unterEbene` nur bei eigenständigen Gegenständen, nie bei
  Auswahl-, Einstellungs- und Stromlisten (LFH-826, Spec `ueberschriften-gliederung`).
- **Bildmarke „Lebenslinie“** (LFH-837): EINE Geometrie in `marke/bildmarkeGeometrie.ts` für
  Markenzelle, Anmeldeseite, Favicon, PWA und Hülle; Symbole nur über
  `scripts/marke/erzeuge-symbole.sh` (Guard `marke/marke.guard.test.ts`: Nenngrößen, Manifest,
  Pfadgleichheit, Stempel `scripts/marke/quellen.sha256`). PWA-Manifest in `marke/pwaManifest.json`, Farben Kopf-Schwarz.
- **Rahmen:** Kopfleiste (`components/Kopfleiste.tsx`, `KOPF_HOEHE`) · Rail
  (`einsatz/IconRail.tsx`, Kurzetikett `kurz`, voller Name als `aria-label`, Einstellungen per
  `fuss: true`) · Modulpanel (`einsatz/ModulPanel.tsx`) · Sprungpalette
  (`command-palette/CommandPalette.tsx`). Maße im Entwurf.
  - **Stehenbleiben** (LFH-952, zjt7c073, LLH-1728, Spec `einsatztauglichkeit-layout`): der Kopf
    klebt in jeder Breite (`RAHMEN_KLEBT`, `data-lfh="rahmen-kopf"`), ab `lg` Rail-Kategorien und
    Modulpanel darunter; unter `md` klebt die Betriebszeile bei Störung (offline, Live `lost`) über
    dem Kopf, denn dort steht die Verbindung im Kopf nur als Symbol. Am Handy trägt der Einsatzkopf
    eine Zeile: Menü, Einsatzname, Alarmzentrale (Ruhe als Glocke, Störung im Wort), Verbindung,
    Uhr (umbrechen darf er nur in `handschuh` bei einer Störung im Wort der Alarmzentrale); Suche
    und Benutzermenü stehen dort im Drawer „Navigation“. Der App-Rahmen lässt unter `md` die
    Wortmarke weg, ihr Link liegt dann auf der Bildmarke. Herleitung:
    `openspec/changes/archive/2026-11-15-ejt520so-handy-kopfleiste-fixiert/design.md`. Der Fuß der Rail (Griff „Menü“,
    Einstellungen) klebt nicht: reicht die Höhe nicht, folgt er den Kategorien, statt sie zu
    verdecken (LLH-1273, `e2e/gate3-trefflaeche.spec.ts` „Rail“). Das Modulpanel ist eine Spalte
    mit festem Kopf und Fuß „Einsatzdauer“, nur die Liste rollt in sich (`modul-panel-spalte`);
    ihre Höhe ist gemessen (Oberkante im Fenster bis Fensterrand), und die Liste holt den aktiven
    Eintrag ins Bild.
  - **Der Seitenkopf klebt, wenn er passt** (zjt7c073 D3, `components/seitenkopfKleben.ts`): ab
    `md` auf jeder `EinsatzSeite` und `AdminPage`, solange Kopf und Seitenkopf höchstens ein
    Drittel der Fensterhöhe nehmen (`KLEBEN_HOECHSTENS`), nie in einem eigenen Scrollbereich
    (Gerätehülle) und nie mit `fensterInhalt` (dort ist `FensterRahmen` sein Containing Block).
    `kopfKlebt` setzt die Entscheidung von außen (nur das ETB). Es klebt nur die Leiste, nicht
    Hinweis oder Beschreibung darunter.
  - **Modulwechsel zeigt sofort Kopf und Gerippe** (LLH-1838, Spec `seiten-zustaende`): Der
    Router zeichnet jeden Wechsel als Übergang und hält das alte Bild, bis die neue Seite fertig
    ist. Deshalb hängt das `<Outlet />` des Einsatzrahmens in `einsatz/ModulWechselGerippe.tsx`.
    Wechselt das Modul, steht im ersten Bild `ModulGerippeSeite` (Seitenkopf mit `modulName` und Ortspfad,
    `SeitenSkeleton verzoegert`, die Balken erst nach 120 ms), danach die Seite. Das gilt nicht
    im selben Modul. Beim ersten Aufruf zeigt `ModulWechselGerippe` kein Vorab-Gerippe; lädt der
    Einsatz dann noch, gibt die Seite in ihrem Frühausstieg selbst `ModulGerippeSeite` zurück
    (Kopf sofort, Einsatz im Ortspfad als „…“, LLH-1830), nie ein nacktes `SeitenSkeleton`; ebenso
    der Ladefall von `modulFreigabeAnzeige` und die Detailseiten im Einsatz mit dem Namen ihres
    Moduls, bis ihr eigener Titel kommt (LLH-2005, Nachweis `pages/Erstaufruf.test.tsx`). Was
    erst mit den Daten kommt, reserviert seine Zeile vorher (unsichtbar, ohne Nullen) oder steht
    unter allem, was schon steht; Nachweis: `e2e/erstaufruf-cls.spec.ts` (Erstaufruf mit langsamem
    Server, CLS < 0,1). Eine Seite baut kein eigenes Vorab-Gerippe für den Wechsel. Ein nachgeladenes Modul nimmt `ModulGerippeSeite` als Suspense-Fallback, keinen
    Ladetext. Herleitung: `openspec/changes/archive/2026-11-18-q71gt8zq-modulwechsel-gerippe/design.md`.
  - **Zwei Höhen** (zjt7c073 D2, `components/rahmenOben.ts`): `--lfh-kopf-oben` (`useKopfOben`)
    ist der Kopf samt Betriebszeile und Übungsband (Ebene `kopf`), `--lfh-rahmen-oben`
    (`useRahmenOben`) dazu der klebende Seitenkopf. Die Kopfhöhe nehmen nur, was neben dem Inhalt
    klebt (Rail, Modulpanel, Verwaltungsmenü), der Seitenkopf selbst und die Klebe-Entscheidungen;
    alles andere die Rahmenhöhe (Guard). Innerhalb der Ebene `kopf` stapelt sich der Rahmen nach
    Rang (`RAHMEN_RANG`: Betriebszeile, Kopf, Übungsband, Alarmzone; `useRahmenObenStapel`,
    LLH-1728, ADR-0056): jede Quelle klebt unter denen mit kleinerem Rang.
  - **Wer oben klebt, hängt sich unter den Rahmen:** `top: var(--lfh-rahmen-oben)` bzw.
    rc-tables `sticky={{ offsetHeader: useRahmenOben() }}` (`components/rahmenOben.ts`, gemessen,
    nie gerechnet), also auch unter den klebenden Seitenkopf. Ausnahme nur mit Vermerk
    `rahmen-oben: frei` und Grund (Guard `components/rahmenOben.guard.test.ts`). Den Fokusabstand
    trägt `scroll-padding-block-start` am Dokument (`index.css`), ausgesetzt bei Fokus im Rahmen;
    bei Fokus im Seitenkopf gilt nur die Kopfhöhe.
  - **Alarme stehen in der Alarmzone, nie über dem Inhalt** (LLH-1735, Spec
    `benachrichtigungen`, „Alarmzone verdeckt nichts“, Herleitung
    `openspec/changes/archive/2026-11-15-zu9ptja2-alarmzone/design.md`; löst LFH-1112 ab): Alarme, Org-Hinweise und
    die Unwetterwarnung zeichnet `alarm/AlarmZone.tsx` direkt unter Kopf und Übungsband, nie
    antds `notification` (`AntApp` trägt kein `notification`-Prop). Die Zone ist eine
    Rahmenquelle der Ebene `kopf` unter dem Übungsband (`useRahmenObenStapel` mit
    `RAHMEN_RANG.alarmzone`): Rail, Modulpanel und Seitenkopf kleben unter ihr. Sie schiebt den Inhalt
    und liegt auf `RAHMEN_EBENE` unter Drawer und Dialogen. Ab zwei Einträgen bündelt sie.
    Im Einsatz unter `md` trägt die Leiste am Handschirm die Alarme (`alarm/HandyLeiste.tsx`).
    ✕ blendet aus (`blendeAus`, sessionStorage je Tab), quittiert wird nur mit „Öffnen“ und
    „Gelesen“ (LLH-1736). Greifer `[data-lfh="alarmzone"]`, `[data-lfh="alarm-eintrag"]`;
    Nachweis `e2e/alarm-verdeckung.spec.ts`.
  - **Kopfleiste: der Name hat Vorrang** (LLH-1726, Spec `kopfleiste`): Rangfolge Einsatzname vor
    Suche vor Daueranzeigen. Ab `lg` gibt ein Raster dem Namen (Stufe `kartentitel`) seine Eigenbreite, bevor die
    Suche mehr als ihre Lupe bekommt (`kopfRasterSpalten`); die Umbruch-Basis hängt an der Dichte,
    nie am geladenen Namen. Ein Zustand ohne Handlungsbedarf steht in jeder Breite nur als
    Symbol, eine Störung ab `md` mit Wort (darunter trägt die Betriebszeile die Verbindung, die
    gebündelte Alarmzentrale nennt die vorrangige Störung). Einziger Breitenhalter: der Platz von „Ton blockiert“ am
    Glockenknopf ab `md`, weil der Browser den Ton vor der ersten Geste ohne Zutun sperrt (am Handy
    nicht, dort hätte die eine Zeile keinen Platz dafür, LLH-1728). Tastenhinweise
    nur bei feinem Zeiger. Die Wortmarke steht im Einsatz erst ab `xxl`. Der Knopf „?“ (Hilfe zur
    Seite, LLH-1824) steht im Einsatz-Kopf erst ab `xl`, im App-Rahmen ab `md`; wo er die eine Zeile
    bräche, steht „Hilfe zu dieser Seite“ im Benutzermenü (`hilfeZurSeite`), am Handy im Einsatz im
    Fuß der Navigation. Unter `md` ersetzt dieser Eintrag „Hilfe“ (die Seitenleiste verlinkt die
    volle Hilfe), und der Menükopf trägt keine Versionszeile, wie im Handschuh-Betrieb; sonst
    ragte „Abmelden“ in `komfortabel` unter den Fensterrand (e2e `benutzermenue`, Entscheidung
    20.11.2026).
  - **Übung** (LLH-1725, Spec `uebungsmarke`, Herleitung
    `openspec/changes/archive/2026-11-15-wc3kzd54-uebungsmarke-rahmen/design.md`): Jede Fläche, die einen Einsatz zeigt,
    kennzeichnet eine Übung (Rahmen, Gerät, Lagemonitor, Einsatzliste, Wechsler, Sprungpalette,
    Planungsübernahme, externes Lagebild, „Zurück zu …“, Tab-Titel, Druck, Lageplan-Anlage,
    Fernmeldeskizze).
    Entschieden wird nur über `isUebung` (`einsatz/einsatzart.ts`) aus der Einsatzart, nie aus dem
    Namen. Gezeigt wird am Bildschirm nur über `UebungsMarke`/`UebungsBand`
    (`components/instrument/Uebung.tsx`), auf Papier über Druckkopf, `DruckUebung` und Randfeld
    (`druck/AGENTS.md`), in Text- und Bildtiteln als Präfix „ÜBUNG · “ (ADR-0053). Erkennbar ist sie
    an Form und Wort (schraffiertes Band, gefüllter Chip, immer „ÜBUNG“), nicht am Farbton: violett
    sind auch die ETB-Entscheidung, die Abschnittsflächen und das Führungscluster der Lagekarte. Das Band steht direkt unter dem Kopf und klebt in jeder Breite unter den übrigen
    Quellen der Kopfhöhe, über einem klebenden Seitenkopf (`useRahmenObenStapel`). In einer Hülle fester Höhe (Gerät) klebt es nicht.
  - **Sprunglink zum Inhalt** (nufmon70, Spec `einsatztauglichkeit-layout`, „Ein Sprunglink führt
    zum Inhalt“, WCAG 2.4.1): einmal in `BetriebsLayout` (`App.tsx`), vor der Betriebszeile
    (`components/SprungZumInhalt.tsx`); die Hilfe liegt außerhalb und bindet ihn selbst ein. Jeder
    Rahmen markiert sein Ziel mit `sprungzielInhalt` (`data-lfh="sprungziel-inhalt"`,
    `tabIndex -1`), der Link nimmt das letzte in DOM-Reihenfolge: das `main` von Einsatz, Ebene 1
    und Hilfe, in der Verwaltung den Inhalt neben dem Menü (ein `div`, kein zweites `<main>`). Ein
    neuer Rahmen markiert sein Ziel mit (Wächter `components/SprungZumInhalt.rahmen.test.tsx`). Ohne
    Fokus aus dem Bild, mit Fokus `fixed` oben links über `RAHMEN_EBENE` (`.lfh-sprung-inhalt`, von
    den Fokusabständen in `index.css` ausgenommen). Die Gerätehülle hat keinen. Nachweis
    `e2e/sprung-zum-inhalt.spec.ts`.
  - **Jede Rahmenebene hat eine Fehlergrenze** (c11mj7y1, LLH-1822, Spec `seiten-zustaende`,
    „Fehlergrenze je Rahmen“ und „Letztes Netz an der Wurzel“, Change `a12ms7g9-seitenzustaende`
    D1/D2): unter `EinsatzLayout`, `AppLayout`, `AdminLayout`, `GeraeteLayout` und
    `GeraetEinsatzRahmen` genau eine pfadlose Kindroute mit
    `errorElement={<Fehlergrenze rahmen="…" />}` (`components/Fehlergrenze.tsx`), die alle Seiten
    des Rahmens umschließt; nie ein `errorElement` am Layout selbst, es ersetzte den Rahmen. Die
    oberste Route trägt das letzte Netz (`rahmen="wurzel"`, ganze Seite ohne `AuthProvider`). Die
    Grenze zeigt nie Meldung oder Stack, nur „Neu laden“ und den sicheren Ort des Rahmens („Zum
    Überblick“ über `einsatz/useUeberblickRueckweg.ts`, „Zur Einsatzliste“, „Zur Startseite“), und
    meldet den Wurf einmal je Fehlerobjekt über `meldeClientFehler` (`api/clientFehler.ts`). Ein
    neuer Rahmen kommt mit seiner Grenze in den Wächter `App.fehlergrenze.guard.test.tsx`.
    Nachweis `e2e/fehlergrenze.spec.ts`.
  - **Jede Kachel einer Lagefläche hat ihre eigene Fehlergrenze** (LLH-1958, Entwurf
    `docs/superpowers/specs/2026-11-19-ft74hjiv-fehlergrenze-je-kachel-design.md`): Auf
    Überblick, Lagebild, Lagebild-Großbild und Lagemonitor steht jede Kachel (Alarmzeile,
    Startliste, Paneel, Kennzahlenband, Monitorkachel) einzeln in `KachelGrenze`
    (`components/KachelGrenze.tsx`), damit ein Wurf nur sie ersetzt und nicht über die
    Rahmengrenze die ganze Seite. Form `paneel` mit „Neu laden“ auf Flächen mit Bedienung, Form
    `gross` ohne Knopf auf Großbild und Lagemonitor, dort mit dem Datenstand als `neuversuch`. Wie
    die Rahmengrenze zeigt sie nie Meldung oder Stack und meldet über `meldeClientFehler`. Sie
    fängt nur Würfe beim Zeichnen: Abfragefehler zeigt `PaneelZustand`, ein Wurf im Rumpf der
    Seite bleibt bei der Rahmengrenze. Wächter `pruefeKachelGrenzen` (`test/kachelWaechter.ts`)
    in den Seitentests von Überblick, Lagebild und Lagemonitor; Nachweis
    `components/KachelGrenze.test.tsx`.
  - **Ortsmarke in der Bedienfarbe** (LLH-1784, Spec `farbrollen-kontrast`): die aktive
    Rail-Kategorie (`rahmenFarben.bedien`), die offene Kategorie im Navigations-Drawer und der
    aktive Reiter der Gerätehülle tragen ihre Marke in `bedien` wie das aktive Modul im
    Modulpanel, nie in `marke`; `marke` bleibt der Bildmarke.
  - **Modulpanel:** `navPersistenz` ist dreiwertig; ohne Wahl zwischen `lg` und `xl` zu, ab `xl`
    offen. Eine Wahl schreiben nur der Griff „Menü“ und der Selbstklick, nie ein Rail-Sprung.
- **Modulstruktur** (`einsatz/modulRegistry.ts`): Startseite **Führung · Überblick**
  (`redirectZiel()`); ETB direkt dahinter, Aufträge/Befehle unter Führung (y3zh5ymv D10). Das
  Kräftemodul heißt sichtbar **Kräfteübersicht** (y3zh5ymv D7, löst LFH-965 D1 ab), **Schlüssel
  und Route bleiben `kraefteuebersicht`**; „Sachverhalt / Meldebild“ der Einsatzdaten ist der
  Leitstellenbegriff und bleibt.
- **Synonyme** (y3zh5ymv D2): `ModulEintrag.schlagworte` trägt Abkürzungen, Alltagswörter und
  frühere Namen; die Sprungpalette sucht darüber, sichtbar sind sie nirgends. Wer ein Modul
  umbenennt, legt den alten Namen dort ab.
- **Ein Name je Modul** (LFH-965, Spec `modul-benennung`): Menü, Sprungpalette, h1, Ortspfad und
  Tab tragen das `label` der Registry, Seiten holen es über `modulName(key)`, nie als Literal.
  `beschreibung` ist die zweite Zeile in Modulmenü und Sprungpalette: wenige Fachwörter, kein
  Satz, keine Bedienung (Guard in `modulRegistry.test.ts`). Ausnahmen nur für Detailseiten,
  Paneel- und Bereichsnamen.
- **Keine erfundenen Daten:** was ohne Datenquelle ist, wird weggelassen (Epic LFH-606…617),
  trägt sein Ticket im Code-Kommentar und wird als **Abwesenheit** getestet. Eingelöst:
  Evakuiert (LFH-607, `openspec/changes/archive/2026-09-29-lfh-607-kennzahl-evakuiert/`), Pegel auf Platz 1
  (LFH-606), Rückmeldung (LFH-610), ETB-Zählung (LFH-612).
- **Kennzahlenband** (LFH-640): „Lage in Zahlen“ hat immer sechs Plätze (vier Kern, zwei Lage); der
  Überblick trägt kein Band, seine Zahlen stehen in den Paneelen (LLH-1748). Jede Kennzahl hat einen
  Heimatplatz; Lageplätze nur per Entscheidung am Einsatz (`EinsatzAnzeige.lagekennzahlen`), nie
  per Messwert — eine Kennzahl ohne Fachentscheidung wird gewählt (Einstellungen › Kennzahlen,
  LLH-1371); Neuzuschnitt während der Betrachtung als Sammelbanner
  (`docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`). Die Fuge
  zeichnet die Zelle, nicht der Rastergrund: Grund `flaeche`, Umriss je Zelle über
  `[data-fugenraster]` (`components/instrument/fugenraster.ts`), damit eine leere Restspur keine
  graue Kachel wird (LFH-961); wer den Grund übernimmt, setzt das Attribut mit. Sie bleibt in
  jeder Dichte 1 px; eine klickbare Zelle rückt ihren Link um 0 / 4 / 8 px ein
  (`kennzahlZielEinzug`), damit Ziele ≥ 8 / ≥ 16 px auseinanderstehen (LFH-630,
  `openspec/changes/archive/2026-10-01-lfh-630-kennzahlenband-handschuh-abstand/design.md`).
  Segmentleiste, Kartengrundlage und Kartenknöpfe teilen den Einzug (`zielEinzug`, LFH-865).
  Ein Band, über dessen Notizen sich die Lage ändert, hält ihre Höhe fest: unter `md` als Boden
  (`notizZeilenSchmal`), ab `md` als Boden und Deckel (`notizZeilen`, „Lage in Zahlen“ drei
  Zeilen; Längeres endet mit „…“ und steht ganz im `title`). Die tragende Aussage einer Notiz
  steht deshalb vorn (LFH-691, `openspec/changes/archive/2026-10-01-lfh-691-kennzahl-notiz-feste-hoehe/design.md`).
- **Dashboard-Baukasten** (LLH-1140, Vorbild Lagebild): jede Fläche, die eine Lage in Zahlen
  zeigt (Lagebild, Führung · Überblick, Kopf der Kräfteübersicht), baut sich aus denselben Bausteinen in
  `components/instrument/`.
  Kopf: `EinsatzSeite` mit Datenstand und `WarnstufenHinweis` (nur bei Ton achtung/alarm; die
  Warnstufe ist keine Kennzahl). Darunter, vor Band und Paneelen, auf Überblick, Lagebild und Lagemonitor
  die **Alarmzeile „Was brennt“** (`AlarmZeile`, LLH-1743, Spec `lage-alarmzeile`): Einträge,
  Folge und Wortlaut nur aus `lage/wasBrennt.ts`, auf den Übersichten über `lage/useWasBrennt.ts`,
  am Monitor über `lage/alarmAusMonitor.ts`; feste Höhe, „Nichts brennt“ nur bei vollständigen
  Quellen, Sprungziele aus `lage/alarmZiel.ts`. Sie zeigt Zustände, die Alarmzone Ereignisse; keine
  Seite baut eine zweite Sammlung. Im Großbild des Lagebilds steht sie in der Größe `grossbild`
  (Maße über `grossMass`, ohne Sprünge), mit den Daten der Seite (LLH-1931); das Großbild der
  Lagebesprechung trägt keine. Nur im Überblick folgt ihr die Reihe **„Einsatz starten“**
  (LLH-1815, Spec `ueberblick-startliste`): eine eigene `PaneelReihe` mit genau einem `ListenPaneel`,
  Punkte nur aus `pages/fuehrung/startliste.ts`, nur mit Schreibrecht am aktiven Einsatz; sie fehlt
  ganz, sobald kein Punkt offen ist oder sie in diesem Browser ausgeblendet ist. Weil sie über den
  Paneelreihen steht, warten sie und die Reihen beim ersten Aufbau gemeinsam auf ihre Quellen; die
  Alarmzeile nicht. Später hängt eine erstmals ladende Quelle nichts aus, und ein gescheiterter
  Neuabruf zählt mit den zuletzt geladenen Daten (Review LLH-1815).
  Reihe 1: `Kennzahlenband` (Regel oben; sechs Plätze im Band „Lage in Zahlen“ des Lagebilds). Der
  Überblick hat keins (LLH-1748,
  `openspec/changes/archive/2026-11-17-wf7l9axn-ueberblick-ohne-band/design.md`): seine erste
  Paneelreihe trägt „Nächste Marken“ und „Offene Vorgänge“, die zweite „Einsatzabschnitte“ und
  die Entscheidungen, damit Fristen über der Falz und am Handy zuerst stehen. Beim ersten Aufbau
  warten die Reihen auf die Quellen der Gliederung und der Marken, sonst rückt alles darunter.
  Standen sie einmal, bleiben sie: lädt eine Quelle erst danach (Modul live freigegeben), zeigt
  nur ihr Paneel kurz den Ladezustand (LLH-1955).
  Reihe 2: eine oder mehrere `PaneelReihe` mit je bis zu drei Paneelen (`1fr 1fr 1.1fr`, unter
  `lg` gestapelt) in der `DashboardFlaeche` (Fugenraster). Ein Kopf über einer Vergleichstabelle
  (Kräfteübersicht) ist nur eine Paneelreihe mit `dichte="kompakt"`, ohne Band, ohne Füllkachel; eine
  Einzelzahl darin (Rückmeldung) ist eine `Kennzahl` mit Sprung. Reihe 3, wo es sie gibt: Fußband
  „Stand“ des Lagebilds (Lagebericht, UHS aktiv) als `Kennzahlenband` mit `groesse="klein"`. Jedes Paneel geht durch
  `DashboardPaneel` (Augenbraue, Zähler als Meta, Sprung „… ↗“, Kopf-Aktion ohne „↗“ für eine
  Handlung am Paneel selbst, `PaneelZustand`; `gesperrt` nennt den Grund, ohne Sprung und
  Leeraktion) und ist einer der Typen `VerteilungsPaneel` (Zahl +
  Anteilsbalken je Kategorie: Sichtung, FMS-Status), `MatrixPaneel` (Stufenmatrix: Gefahren),
  `StromPaneel` (Zeitachseneinträge mit Sammelbanner), `ListenPaneel` (kurze Liste mit
  „n weitere ↗“) oder `GliederungsPaneel` (Teile mit Lagekante, Kopf, Zahlspalte). Mehrere kurze
  Listen in einem Paneel sind `ListenAbschnitt`e (LLH-1145, „Offene Vorgänge“): je Überschrift,
  Zahl vom Aufrufer, Notiz, höchstens drei Einträge, „alle ↗“; ein Abschnitt fällt nie weg, auch
  leer („keine“), gesperrt („—“ mit Grund), ausgefallen oder „ohne Netz nicht geladen“. Laden, Fehler,
  Leer und Gesperrt sehen verschieden aus; eine unbekannte Zahl steht als „—“, nie als 0. Balken
  ergänzen die Zahl, nie ersetzen sie; Farben kommen aufgelöst vom Aufrufer, der Baustein trägt
  keine Statuskarte. Ein neuer Paneeltyp kommt als Baustein hierher, nicht lokal in eine Seite.
- **Rollen der Übersichten** (LLH-1743, Spec `lage-verdichtung`, „Überblick führt, Lagebild zeigt
  die Lage“): der Überblick sagt, was zu tun ist (Startliste eines neuen Einsatzes, nächste
  Marken, offene Vorgänge samt Aufträgen und Meldungen, Abschnitte, Entscheidungen; ohne
  Kennzahlenband, LLH-1748), das Lagebild, was los ist (Betroffene, Kräfte, Vermisste, Gefahren,
  Sichtung, Einsatzdauer, Lagebericht, UHS). Eine Zahl steht auf genau einer der beiden Seiten;
  nur die Alarmzeile steht auf beiden. Die
  Startliste zeigt Haken, keine Zahl (LLH-1815). Beide verweisen im Seitenkopf aufeinander.
  Herleitung: `openspec/changes/archive/2026-11-16-t9jjrajy-alarmzeile-was-brennt/design.md` (D8).
- **Eine Heimat je Zahl** (LFH-550,
  `openspec/changes/archive/2026-09-30-lfh-550-lagebesprechung-eine-verdichtung/design.md`):
  Aufträge und Meldungen (offen, in Arbeit, überfällig = davon überfällig, Bestätigung überfällig,
  Sofort- und dringende Meldungen offen samt Eingang der ältesten, LLH-1743),
  Nachforderungen (offen, je Stufe, überfällig; LLH-1145), Erinnerungen (fällig) und Lagemeldungen
  (neu) nur aus dem Modulzähler (`pages/lage-dashboard/fuehrungsZahlen.ts`), nie aus einer Liste
  gezählt; Betroffene/SK über `verdichtePersonen` (→ `sichtungsbild`), Kräfte über `verdichte`,
  Warnstufe über `verdichteGefahrengebiete`, Material-Ausfall (Posten mit Statusrolle Alarm oder
  Achtung) über `kraefte/materialVerdichtungKern.ts`. Ausfall einer Einheit (Mittel, Material) nur
  über die Gründe der Tönung der Kräfteübersicht (`toenungsGruende`, gelesen über
  `lage/ausfallJeEinheit.ts`); der Überblick summiert sie je Abschnitt, die Alarmzeile nennt die
  Einheiten in der Folge der Einheitenliste (`einheitenMitAusfall`). Für den Lagemonitor zählt der
  Server dieselbe Regel nach (`einsatz::ausfall`, LLH-1929); `tests/fixtures/verdichtung/regeln.json`,
  Abschnitt `ausfall`, bindet beide Seiten. Wer die Regel ändert, ändert beide und das Fixture.
  Die Rückmeldung eines Abschnitts urteilt je Einheit des Teilbaums, nie über die
  jüngste Meldung allein (LLH-1739, `abschnittGruende`). Stärke einer Menge nur über `summiereStaerke`
  (Wurzeln der Menge), Formatierung nur `anzeige/staerke.ts:staerkeText`. Ein Abschnitt zählt, wer in
  ihm steht (LLH-1744): Stärke nur über `abschnittStaerken` (eigene Stärke `ist` je aktiver Einheit
  beim wirksamen Abschnitt), seine Einheiten nur über `einheitenImAbschnitt`, dieselbe Menge. „Kräfte“
  sind Köpfe, Fahrzeuge zählen eigens; Kräfte an UHS nur an aktiven UHS (`countsKraefteAnUhs`,
  Lagebild und Lagemonitor). Belegung eines Bereitstellungsraums (LLH-1095, Spec
  `bereitstellungsraum-belegung`): Fahrzeuge, Einheiten und längste Wartezeit nur aus `belegung`
  des Servers (Liste, Detail und Lagekarte), Stärke im Raum nur über `staerkeImRaum`
  (`bereitstellungsraum/brZahlen.ts`; nur Einheiten im Raum mit ihrer eigenen Stärke, LLH-1289); „noch n belegt“ vor dem Auflösen zählt wie
  `aktive_belegungen_tx` (Einheiten und einheitenlose Fahrzeuge). Lage einer UHS (In der Stelle,
  Plätze frei, Wartend, Unterwegs; LLH-1136, LLH-1332) nur über `pages/uhs/uhsLage.ts`, aus denselben
  Mengen wie der Grundriss. Einheiten ohne Schicht (Seite Ablösung, Sprung im Überblick; LLH-1312) nur
  über `abloesung/ohneSchicht.ts:findOhneSchicht`, aus denselben Fächern. Dashboard und Vorbereitung der Lagebesprechung teilen `useLagebild` +
  `baueLagebild`. Regeln beider Sprachen pinnt `tests/fixtures/verdichtung/regeln.json`
  (`tests/verdichtung_fixture.rs`, `lage/verdichtungFixture.test.ts`).
- **Eine Baumlogik der Kräfte: `kraefte/kraeftebaumKern.ts`** (LLH-1025, Spec `kraeftebaum`).
  Einheit → Untereinheiten, je Einheit Fahrzeuge mit Besatzung, „Ohne Fahrzeug“, Material; jede
  Kraft genau einmal, Elternstärke über `accumulateStaerke`. Kräfteübersicht (`meldebildRaster.ts`) und
  Lagebericht-Text (`kraeftebild.ts`) bilden den Kern nur ab; ein neuer Abnehmer baut keinen
  eigenen Baum. Kräfteübersicht, Kräftebild und Organigramm lösen abgestellte Untereinheiten (eigener
  Abschnitt ungleich dem der Obereinheit) über `detachAbgestellte`/`abgestelltVon` vom Verband,
  „aus <Obereinheit>“ (LLH-1744); Einheiten-Gliederung, FMS-Tableau, Funkplan und Fernmeldeskizze
  (`baueFuehrungsorganisation(…, { detachAbgestellte: false })`) behalten den Verband.

## Frontend — Verwaltung: Einstieg (LLH-1820)

Entwurf `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`,
Zeichenflächen `docs/design/2026-11-19-verwaltung-uebersicht/`.

- **`/admin` führt immer auf die Übersicht** (`admin/BereitschaftUebersicht.tsx`,
  `defaultAdminPfad()`), den ersten Menüpunkt vor den Gruppen. Wer auf „die Verwaltung“ umleitet,
  nimmt `defaultAdminPfad()`, nie eine Stammdaten-Seite.
- **Was „fehlt“, bestimmt allein `admin/bereitschaft.ts`** (`bewerteBereitschaft`); der Server
  zählt nur (`GET /api/verwaltung/bereitschaft`). Pflicht: ein weiterer Benutzer und Fahrzeuge
  oder Personal; Vorlagen sind Empfehlung.
- **Die Übersicht zeigt Zahlen, keine Namen; Demo-Daten zählen nicht mit.** Auch die
  Führungskraft sieht sie; der Sprung zur Benutzerseite steht nur für System-Admins.

## Frontend — Bausteinwahl (wann nehme ich was)

Die erste Frage beim Bauen und beim Entwerfen: Welcher Baustein trägt den Bedarf? Eine Zeile je
Bedarf. Die Regel dahinter steht am genannten Ort und wird hier nicht wiederholt; die Orte sind
Abschnitte dieser Datei im Repo, die README des Design Systems trägt nur einen Teil davon. Die Karte ist der
Ordner im Design System (`docs/design/design-system/project/components/<Karte>/`). Die README des
Design Systems beginnt mit dieser Tabelle, und `designSystem.test.ts` hält die Spalte „Karte“ und
die Karten deckungsgleich (Spec `design-system-artifact`, LLH-1807).

| Bedarf                                                                                          | Baustein                                                                                                                                         | Karte                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| **Rahmen**                                                                                      |                                                                                                                                                  |                                    |
| Seite mit Titel, Meta und Kopfaktionen                                                          | `EinsatzSeite` (Verwaltung: `AdminPage`), Kopf nach „Seitenkopf“                                                                                 | `Seitenkopf`                       |
| Zusammengehöriges in einer Fläche                                                               | `Paneel`/`PaneelZeile`                                                                                                                           | `Paneel`                           |
| Lagebild aus Zahlen, Verteilung und Listen                                                      | Dashboard-Baukasten                                                                                                                              | `Dashboard`, `DashboardListen`     |
| Kopfaktion mit wechselndem Wortlaut                                                             | `BreiteHalten`                                                                                                                                   | `BreiteHalten`                     |
| Übung kennzeichnen                                                                              | `UebungsBand`/`UebungsMarke` (Rahmen, „Übung“)                                                                                                   | `Uebung`                           |
| Navigation im Einsatz (Kategorien und Module)                                                   | `IconRail`/`ModulPanel` ab `lg`, darunter Navigations-Drawer („UI-Form-Leitlinie“)                                                               | `Navigation`                       |
| **Darstellen**                                                                                  |                                                                                                                                                  |                                    |
| Angaben eines Datensatzes                                                                       | `Datenraster`/`Datenfeld`                                                                                                                        | `Datenraster`                      |
| Nebenangaben eines Datensatzes in einer Zeile                                                   | `MetaZeile`                                                                                                                                      | `MetaZeile`                        |
| Text in einer Größe und Farbe                                                                   | `Textstufe` (Stufe der `schriftskala`, Ton)                                                                                                      | `Text`                             |
| Elemente mit Abstand reihen                                                                     | `Stapel` (Rasterstufe)                                                                                                                           | `Stapel`                           |
| Knöpfe nebeneinander (Kopf, Paneel, Dialogfuß)                                                  | `Knopfreihe` (Abstand `md`, Fuß mit `fuss`)                                                                                                      | `Knopfreihe`                       |
| Eine Zahl, die führt                                                                            | `Kennzahl`/`Kennzahlenband`                                                                                                                      | `Kennzahl`                         |
| Kennzahlen über einer Liste, einklappbar                                                        | `KlappBand`                                                                                                                                      | `KlappBand`                        |
| „Welcher von diesen?“                                                                           | `KatalogTabelle`, `Datensicht form="tabelle"` („Die Liste ist die zweite Frage“)                                                                 | `Tabelle`                          |
| Zustand eines Datensatzes (Status, Urteil, storniert)                                           | `Status`, im Raster `StatusZelle` (Farbachsen, „Rahmen heißt bedienbar“)                                                                         | `Status`                           |
| Status, den man wechseln kann                                                                   | `StatusWahl` (rendert `StatusKnopf`; Tableau `variante="gross"`)                                                                                 | `Status`                           |
| Kennzeichnung ohne Zustand (ad-hoc, Rolle, Typ, Herkunft)                                       | `Marke` (entfernbar mit `onEntfernen`), nie rohes `Tag`                                                                                          | `Status`                           |
| Sichtungskategorie                                                                              | `SichtungsTag`                                                                                                                                   | `Sichtung`                         |
| Zeitpunkt oder Dauer                                                                            | `anzeige/zeitDarstellung.ts`, Dauer `anzeige/dauer.ts` („Zeitdarstellung“, „Uhr, Dauer und Datenstand“)                                          | `Zeitdarstellung`                  |
| Funk- und Telefonverbindungen                                                                   | `VerbindungenAngabe`, `FunkUndTelefon`                                                                                                           | `Verbindungen`                     |
| Taktisches Zeichen                                                                              | `EinsatzZeichen`                                                                                                                                 | `TaktischeZeichen`                 |
| Verletzungen am Körper                                                                          | `Koerperschema`                                                                                                                                  | `Koerperschema`                    |
| Großbild (Lagemonitor)                                                                          | `GrossKennzahl`, `GrossZeile`                                                                                                                    | `GrossKennzahl`, `GrossZeile`      |
| **Rückmeldung**                                                                                 |                                                                                                                                                  |                                    |
| Laden, leer oder Fehler einer Seite oder eines Paneels                                          | `SeitenSkeleton`/`SeitenLeer`/`SeitenFehler`, `PaneelZustand`                                                                                    | `Zustaende`                        |
| Hinweis zu Rechten, Warnstufe oder Lage der Fläche                                              | `RechteHinweis`, `WarnstufenHinweis`, `Alert` auf der Statusfläche                                                                               | `Hinweis`                          |
| Mehrere gleichartige Meldungen gebündelt                                                        | `Sammelbanner`                                                                                                                                   | `Sammelbanner`                     |
| Was gerade brennt, unter dem Seitenkopf von Überblick und Lagebild                              | `AlarmZeile` („Dashboard-Baukasten“)                                                                                                             | `AlarmZeile`                       |
| Alarm, der eine Handlung verlangt                                                               | `AlarmZone`                                                                                                                                      | `Alarmzone`                        |
| Eingang (Einwurf, Nachricht)                                                                    | `EingaengeKnopf`, `Eingangsband`                                                                                                                 | `Eingaenge`                        |
| **Eingabe**                                                                                     |                                                                                                                                                  |                                    |
| Eine Handlung auslösen                                                                          | antd `Button`, Farben aus `antdKnopf` („Farbe und Zeichen“, „Rot bedient nichts“)                                                                | `Knopf`                            |
| Frei oder gesperrt mit Grund                                                                    | Sperrzeichen aus `index.css` („Gesperrt trägt die Sperre ohne Farbe“)                                                                            | `Gesperrt`                         |
| Ein Feld mit Beschriftung und Fehlerzeile                                                       | `Feld` mit `breite` (Hülle um `Form.Item`), ohne Formular `FeldFehler`                                                                           | `Eingabefeld`                      |
| Zeitpunkt eingeben                                                                              | `ZeitpunktEingabe`                                                                                                                               | `Zeiteingabe`                      |
| Ort eingeben                                                                                    | `Ortsfeld`                                                                                                                                       | `Ortsfeld`                         |
| Wert aus Stammdaten oder frei                                                                   | `StammdatenFeld`                                                                                                                                 | `StammdatenFeld`                   |
| Geheimnis setzen oder ersetzen, nie lesen (Zugangsdaten eines Adapters)                         | `Geheimfeld` (Wert nur im State der Zeile, nie in `Form`, Query- oder Mutations-Cache)                                                           | `Geheimfeld`                       |
| Sichtung wählen                                                                                 | `SichtungsWahl`                                                                                                                                  | `SichtungsWahl`                    |
| Formularseite mit Feldgruppen                                                                   | `Formularpaneel`, Speichern über `useSpeicherLeiste` + `SpeicherKnopf` („Formularseiten“)                                                        | `Formularlayout`, `Speicherleiste` |
| Gegliedertes Dokument                                                                           | `DokumentEntwurf`                                                                                                                                | `DokumentEntwurf`                  |
| **Umschalten** (Spec `bedien-umschalten`, LLH-1808)                                             |                                                                                                                                                  |                                    |
| Fläche oder Bereich darunter umschalten                                                         | `Segmentleiste rolle="tablist"` mit Reiterfläche (`role="tabpanel"`, `steuert`); führt ein Reiter auf eine andere Seite, `aktivierung="manuell"` | `Segmentleiste`                    |
| Dokumentreiter mit Anlegen und Schließen                                                        | antd `Tabs` `editable-card` (nur ETB-Entwürfe)                                                                                                   | —                                  |
| Sicht oder Status derselben Liste, bis etwa 5 Werte                                             | `Segmentleiste`, höchstens eine je Ebene                                                                                                         | `Segmentleiste`                    |
| Weitere Einschränkung derselben Liste                                                           | `Select` oder Suche in derselben Werkzeugzeile                                                                                                   | `Eingabefeld`                      |
| Kurze Wahl im Formular                                                                          | `SegmentFeld` in `Form.Item`, nie `Radio.Group optionType="button"`                                                                              | `Segmentleiste`                    |
| Wahl mit erklärenden Optionen                                                                   | senkrechte `Radio.Group`                                                                                                                         | —                                  |
| Viele Werte oder Wahl aus Stammdaten                                                            | `Select` bzw. `StammdatenFeld`                                                                                                                   | `Eingabefeld`, `StammdatenFeld`    |
| Zweizustand neben einer Leiste                                                                  | `SegmentUmschalter`                                                                                                                              | `Segmentleiste`                    |
| antds `Segmented`                                                                               | nie                                                                                                                                              | —                                  |
| **Bearbeiten** (Regeln: „UI-Form-Leitlinie“, „Bearbeiten in der Ansicht“, „Ort von Bearbeiten“) |                                                                                                                                                  |                                    |
| Einzelwert am Ort ändern                                                                        | `InlineAngabe`, `BemerkungZelle`                                                                                                                 | `InlineAngabe`                     |
| Zusammengehörige Werte eines Datensatzes                                                        | `BearbeitbaresPaneel` Modus `paneel`                                                                                                             | `BearbeitbaresPaneel`              |
| Ganze Ansicht, Felder zusammen geprüft                                                          | `BearbeitbaresPaneel` Modus `ansicht`                                                                                                            | `BearbeitbaresPaneel`              |
| Anlegen                                                                                         | Muster Dialog: `ErfassungsModal` („Erfassungs-Norm“); eigene Seite erst ab Ablauf oder > ~5 Pflichtfeldern                                       | `Dialog`                           |
| Serienerfassung neben einer Liste                                                               | Muster Zeile: `Schnellerfassungszeile`, aufgeklappt `ErfassungsFormular`                                                                         | —                                  |
| Kurze blockierende Aktion, Datensatz ohne eigene Ansicht                                        | Modal (Punkt 1 von „Bearbeiten in der Ansicht“)                                                                                                  | `Dialog`                           |
| Unumkehrbares                                                                                   | rote `Popconfirm`, aus einem Zeilenmenü ein Modal („Aktionen“)                                                                                   | `Knopf`                            |
| Nur ansehen                                                                                     | Drawer; nie zum Anlegen oder Bearbeiten                                                                                                          | —                                  |

## Frontend — UI-Form-Leitlinie (Drawer-Nutzung)

**Form nach Umfang** (LFH-19, `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`)

- **Vollseite/eigene Route** (`/einsaetze/:einsatzId/<modul>/:id`): Sektionen/Tabs, > ~5 Felder,
  Workflow, deeplink-würdig (Muster `BefehlDetailPage`, `PersonenDetailPage`). **Modal**: kurze
  blockierende Aktion, ≤ ~3 Felder. **Inline/Expander**: Zusatz ohne Seitenwechsel.
  **Drawer**: nur Quick-View (read-only, `PersonDetailDrawer`), nie zum Anlegen (LLH-1921); Tabs,
  großer Edit-Modus oder > ~480 px → eigene Route.
- **Erste Ausnahme: der Navigations-Drawer** unter `lg` (`einsatz/EinsatzLayout.tsx` +
  `einsatz/ModulAkkordeon.tsx`): Navigation, keine Entität, schließt beim Modulklick, Inhalt erst
  beim Öffnen (kein `forceRender`). Ein weiterer braucht eine eigene Entscheidung.
- **Zweite Ausnahme: die Hilfe-Seitenleiste** (`hilfe/HilfeSeitenleiste.tsx`, LLH-1824, Entwurf
  `docs/superpowers/specs/2026-11-19-col12d3y-hilfe-mit-kontext-design.md`): Nachschlagen neben
  der Arbeit, nur lesen, zwei Reiter als `Segmentleiste rolle="tablist"`, 480 px (unter `lg` und
  bei Berührung volle Breite). Die volle Hilfe bleibt die Route `/hilfe/<kapitel>`.
- **Liste + Detailpaneel** (`components/ListeDetail.tsx`, Spec `liste-detail`, Herleitung
  `openspec/changes/archive/2026-10-12-oxgob5gk-auftraege-befehle-angleichen/design.md`): wenn
  Objekte je Stück gelesen und kurz behandelt werden (quittieren, freigeben) und man oft zwischen ihnen wechselt.
  Ab `lg` Liste links, Detail rechts (klebt), darunter klappt es unter der gewählten Karte auf; kein
  Drawer; unter `lg` holt die Wahl von Hand das aufgeklappte Detail in den Blick, wenn es unter den
  Fensterrand fällt (LLH-1761, nie bei Vorauswahl, Deeplink oder Zuklappen). Die Karte trägt nur das
  Auswahlziel (`AuswahlZiel`) und Kennungs-Links, Handlungen stehen im Detail; gewählt ist `auswahlFlaeche` ohne Linie (`KommKarte` `gewaehlt`). Ein Dokument wird
  weiter auf der Vollseite geschrieben. Vorbild Aufträge/Befehle; Einsatzabschnitte und Gefahren
  sind ältere Einzelbauten.

**Bearbeiten in der Ansicht** (LLH-1139, Spec `formularseiten`, „Eine offene Bearbeitung je
Ansicht“; schreibt LFH-19 und LFH-979 fort)

1. **Ein bestehender Datensatz wird in seiner Ansicht bearbeitet**, nie in einem Formular, das die
   Ansicht ersetzt oder verdeckt. Der Erfassungsdialog bleibt fürs **Anlegen** (Erfassungs-Norm,
   Feldbudget, Form unten) und für kurze blockierende Aktionen. Ausnahme: ein Datensatz ohne eigene
   Ansicht (eine Chat-Nachricht, die Metadaten eines Dokuments) darf in einem kurzen Modal mit
   höchstens etwa drei Feldern bearbeitet werden (LLH-1808).
2. **Drei Stufen nach Umfang:** **Einzelwert** (Status, Lagezustand, Führer, Frist) über
   `InlineAngabe`/`BemerkungZelle` am Wert, speichert sofort genau dieses Feld · **Paneel**
   (zusammengehörige Werte, „Funk“, „Personendaten“) über `components/instrument/BearbeitbaresPaneel`
   Modus `paneel`: „Bearbeiten“ im Paneelkopf schaltet nur dieses Paneel auf Eingaben, Speichern
   und Abbrechen im Paneelfuß · **ganze Ansicht** nur, wo Felder fachlich zusammen geprüft werden
   (Befehlsschema, Tier/Schaden), Modus `ansicht` mit Speichern-Leiste. Eine Karte, die selbst die
   Ansicht eines Datensatzes ist, nimmt ebenfalls `ansicht` (Vorbild Verpflegung,
   `verpflegung/ZeitfensterBearbeiten.tsx`).
3. **Höchstens eine offene Bearbeitung je Seite** (ein Paneel oder die ganze Ansicht; ein
   Einzelfeld zählt mit, sobald es einen Entwurf hat): jedes weitere „Bearbeiten“ ist gesperrt mit
   „Erst „Titel“ speichern oder abbrechen“, sichtbar am Element. Getragen vom Merker
   `components/offeneBearbeitung.tsx` (ein Paneel belegt die Seite beim Öffnen, die Rückfrage vor
   dem Verlassen kommt erst mit einer Änderung); ohne Merker der Seite legt der Baustein seinen
   eigenen an. Jede offene Bearbeitung trägt CAS über `useEditSitzung`. **Listenseiten mit
   Inline-Angaben folgen derselben Regel** (LLH-1480, Fahrzeuge, Material): der Grund steht dort
   EINMAL in der Werkzeugzeile der Liste (`OffeneBearbeitungGrundZeile`), die gesperrten Angaben
   und Bemerkungen verweisen darauf, statt ihn unter jede Zelle jeder Zeile zu schreiben.
4. **Nur geänderte Felder senden** (PATCH), nie das ganze Formular; ohne Änderung kein Aufruf.
   Konflikt über `geaendert_at` (Paneel, ganze Ansicht) oder **Feld-CAS an jeder Einzelangabe**
   (LLH-1831, Change `nvhnqynd-konflikt-und-aenderungsvermerk`): `InlineAngabe` reicht den Wert beim
   Öffnen als `{ beimOeffnen }` an `onSpeichern`, die Seite schickt ihn als `erwartet` und speichert
   über `components/useFeldKonflikt`. Ein 409 fragt „Zwischenzeitlich geändert“ mit „Meine
   Änderung übernehmen“ / „Verwerfen und neu laden“. Zeichnet die Route den Sperrkonflikt aus
   (`grund: "veraltet"`, `isVeraltet`, `src/AGENTS.md`, Statuscode-Konvention), fragt am Paneel
   nur er; ein anderer 409 steht als Grund am Paneel (`isSperrkonflikt`, LLH-1920). An einer
   Einzelangabe nennt die Rückfrage dazu den aktuellen Wert lesbar und, wer ihn wann gesetzt hat;
   `useFeldKonflikt` lädt beim 409 neu und fragt nur, wenn die Angabe sich wirklich geändert hat.
   Ein fremder Wert im offenen Feld steht dort als Hinweis, die Eingabe bleibt. Wo der Server einen
   Änderungsvermerk liefert (`vermerke`), steht er leise an der Zeile (`VermerkZeile`) und der
   jüngste im Paneelkopf (`PaneelVermerk`). **Wege ohne offenes Feld** (Platzieren, Fläche, Zeichen
   wählen, Umhängen per Ziehen, Skizze; LLH-1945) schicken den Stand zu Beginn der Handlung als
   `erwartet` und zeigen beim 409 denselben Dialog; „Übernehmen“ schreibt ohne Altwert,
   „Verwerfen“ und Escape lassen die Handlung verfallen. Ohne Altwert bleiben Knöpfe und Dialoge,
   die einen festen oder errechneten Wert setzen (Status, Lagezustand, „Kapazität übernehmen“).
5. **Prüffehler sichtbar** unter der Zelle (`DatenfeldEingabe`), eine Ablehnung als
   `SpeicherFehler` am Paneel. Enter speichert (ohne Änderung schließt es, LLH-1829), Escape
   bricht ab; Fokus beim Öffnen ins erste Feld,
   beim Schließen zurück auf „Bearbeiten“.
6. **Jede bearbeitbare Detailansicht hat eine Item-Route** („Deeplink-Muster“).
7. **Nach dem Anlegen springt die Seite in die neue Ansicht** (Vorbild Befehl), nicht zurück in
   die Liste mit erneutem Öffnen.

Kein Fach-Modul baut einen zweiten Baustein dafür; die Seiten stellen ihre Fach-Tickets um
(Einsatzabschnitte, Einheit, Personal, Personendaten, Tier/Schaden, Lageberichte, Betreuung).
UHS (Bereich „Angaben“) und Bereitstellungsraum („Raumdaten“) sind umgestellt (LLH-1920).

**Ort von „Bearbeiten“ und Form des Anlegens** (LLH-1722, D8): „Bearbeiten“ eines Paneels steht
im Paneelkopf, das der ganzen Ansicht im Kopf nach der Zwei-Handlungen-Regel (sonst im ⋮ des
Kopfs). Anlegen geht über das `ErfassungsModal` (Muster Dialog, „Erfassungs-Norm“, LLH-1766); eine eigene Seite nur bei einem Ablauf oder mehr
als ~5 Pflichtfeldern (Patient, Einheit aus Vorlage); ein eingeklapptes Formular nur bei
Serienerfassung neben einer Liste; **kein Drawer zum Anlegen** (Spec `bedien-muster`, „Einen
Datensatz anlegen“). Einsatzgebundene Datensätze legen über `components/AnlegenModal.tsx` an
(UHS, Bereitstellungsraum), jeder Einstieg öffnet denselben Dialog. Eingeklappt über der Liste
bleiben, weil dort in Serie erfasst wird: Nachforderung, Meldungen, Erinnerungen (geprüft
LLH-1921); die Lagemeldung erfasst im Dialog.

**Die Liste ist die zweite Frage** (LFH-330): „welcher von diesen?" → Tabelle
(`components/KatalogTabelle.tsx`, `components/Datensicht.tsx` `form="tabelle"`); „was ist mit diesem?" →
Liste/Karte (`components/Liste.tsx`, `Datensicht` `form="karte"`); Kachel nur für Überblick.
Karten-Fallback unter `md` (`form="auto"`) ist begründungspflichtig (Dateikopf `Datensicht.tsx`,
AK3b im Drawer-Spec); keine Katalogtabelle wird zu Karten.

- **Kein Nutzerschalter Tabelle ↔ Karte** (LFH-507, `openspec/changes/archive/2026-09-30-lfh-507-palette-status-setzen/`):
  die Form bleibt die begründete Entscheidung je Seite, auch in der Palette („Ansicht wechseln“
  gibt es nicht). Wer einen Schalter will, schreibt zuerst diese Regel fort. Keine Ausnahme
  davon ist ein **Überblick nach einer Achse** wie das Sichtungsboard der Betroffenen (LLH-1332,
  `personen/Sichtungsboard.tsx`): es ordnet dieselbe Menge in Spalten je Kategorie, statt dieselbe
  Liste als Tabelle oder Karten zu zeigen.
- **FMS-Tableau** (LFH-642, `kraefte/FmsTableau.tsx`): Ansicht `?ansicht=tableau` der
  Fahrzeugseite, kein Modul; je Kachel genau ein Bedienziel (`StatusWahl` `variante="gross"`: der
  Statusblock mit Ziffer 40 px, LLH-1782, Spec `fms-tableau`), Kachel selbst nicht klickbar;
  Rufname 22 px Mono, Typ und Einheit darunter, Kacheln ab 240 px (`auto-fill`, eine einzelne wird
  nie fensterbreit); Sortierung Abschnitt → Einheit → Funkrufname, nie Status; der Abschnitt ist der
  eigene der Einheit, sonst der geerbte (`abschnittDerEinheit`, dieselbe Lesart wie die
  Abschnitt-Spalte der Liste, LLH-1073); `fms_anker` 0–9 nur Beschleuniger (Doppelbelegung setzt
  nichts) (`docs/superpowers/specs/2026-09-23-lfh-642-pruefliste.md`).
- **Organigramm der Führungsorganisation** (LFH-626, `pages/einsatzabschnitte/Organigramm.tsx`,
  `openspec/changes/archive/2026-10-01-lfh-626-fuehrungsorganisation-skizze/design.md`): Ansicht
  `?ansicht=organigramm` der Seite Einsatzabschnitte, kein Modul; rein abgeleitet über
  `buildFuehrungsorganisation` (Platzierung und Schlüssel wie der Funkplan, nur eine abgestellte
  Untereinheit steht wie in der Kräfteübersicht unter ihrem Abschnitt, LLH-1744; Vorlage für Auto-Layout
  und Fokusfolge der Fernmeldeskizze LFH-893); Stärke je Abschnitt nur über `abschnittStaerken`, die Wurzel
  „Einsatzleitung“ trägt keine Zahl, ihren Einsatzleiter nur über `einsatz/einsatzleiter.ts`
  (LFH-1199); die Stabsstelle nur aus den Mitgliedern (`fuehrung/besetzungAusMitgliedern.ts`,
  i6k6mzed D7). Layout und Druckregeln nur über
  das Gerüst `components/organigramm/HaengenderBaum` (erste Ebene als Spalten-Grid,
  `SPALTE_MIN_PX` gemessen, tiefer senkrecht) — keine
  Graph-Bibliothek, kein zweites Gerüst. **Live-Zufluss nur über die Schleuse des Gerüsts**
  (LFH-867, `components/organigramm/baumSchleuse.ts`,
  `openspec/changes/archive/2026-10-04-lfh-867-organigramm-zufluss-schleuse/design.md`): Zeiger
  (ohne Touch) oder Fokus im Baum halten Menge, Ort und Folge der Knoten, Inhalt fließt;
  Entfallenes bleibt als Platzhalter ohne Link, der Kopf steht still; Banner in der Standzeile
  fester Höhe; im Druck gilt sie nicht. Kein Nutzer baut eine eigene.
- `Datensicht` bricht fest bei `md`; die Prop `tabelleAb` hält `datensicht.guard.test.ts` fern.
- **Zufluss der `Datensicht`** (LFH-1020, Spec `datensicht-zufluss`): Fokus ODER Maus-/Stiftzeiger
  (nicht Touch) in der Sicht hält Menge und Folge der Zeilen, im Baum auf jeder Ebene über
  `organigramm/baumSchleuse.ts` (keine zweite Baumlogik); Inhalt fließt, Entfallenes fällt sofort
  weg, der Sammelbanner nennt Neues, Umgehängtes und Umsortiertes. `zufluss="sofort"` nur für
  Flächen ohne Bedienziel in den Zeilen. Ein offenes Popover, Menü oder Dialog einer Zeile hält
  wie Fokus, auch ohne ihn (Touch): die Seite meldet es über `halten`
  (`components/useHalteQuellen.ts`), `MenueAusloeser` über `onOffenAenderung`; Menüs des
  Kartenfußs hält die Sicht selbst (LLH-1130).
- **Eine geblätterte Liste nimmt den Servermodus der `Datensicht`** (LFH-1075, Prop
  `serverseitig`): Suche (entprellt) und Spaltenfilter gehen an den Server, die Sortierung
  kontrolliert; die Sicht filtert und sortiert nicht noch einmal (auch nicht über den Kopffilter,
  LLH-1086; seine Zahlen reicht die Seite über `serverseitig.zahlen`). `stand` ist die Abfrage der
  gezeigten Zeilen, ihr Wechsel kein Zufluss. Nachladen per „Ältere laden“ unter der Sicht,
  Zahlen aus `…/kennzahlen` (Vorbild `pages/SchaedenPage.tsx`).
  `naechste_lagebesprechung_at` = absolute Wiedervorlage-Schnellwahl, kein berechneter Rhythmus
  (`docs/superpowers/specs/2026-09-08-lfh-463-464-pruefliste.md`); geschrieben nur im Modul
  Lagebesprechung (`frontend/src/lagebesprechung/AGENTS.md`).
- **Fließende Spalte** (LFH-523): trägt genau EINE Spalte `mindestBreite` und alle übrigen eine
  Zahlbreite, setzt `KatalogTabelle` `scroll.x = Σ(width) + mindestBreite` und **nur dann**
  `tableLayout="auto"` (sonst kippt `@rc-component/table` still auf `fixed`); sonst
  Bestandsverhalten plus DEV-Warnung. Zahl gegen die schmalste Fläche wählen (Träger
  `personen/personenSpalten.tsx`). `document.body.scrollWidth` sieht Tabellenüberlauf nicht
  (`docs/superpowers/specs/2026-09-11-lfh-523-etb-langtext-umbruch.md`).

**ETB** (Zeitachse, Erfassung, Zähler, Entwürfe): `frontend/src/etb/AGENTS.md` — gilt auch für
`pages/EtbPage.tsx`, `pages/EtbDruckPage.tsx` und `pages/LagemeldungenPage.tsx`.
**ETB-, Schaden-, Tier-, UHS- und Personen-Anhänge** stehen beim Server: `src/AGENTS.md`; die
Erfassungsmodule teilen den Block `components/erfassungsAnhaenge/ErfassungsAnhaenge`.

**Farbachsen** (Vertrag `theme/statusFarben.ts`)

- **Betroffene** (LFH-455, `Status`): Personenstatus neutral, „vermisst" `achtung`; Schaden
  „offen" neutral (Eingang, Spec `statusrollen`), „übergeben" `bedien`, „abgeschlossen" neutral; Ausmaß „gering" neutral,
  „mittel"/„groß" `achtung`, „katastrophal" `alarm`.
- **Lagezustand** (LFH-608, `abschnittLagezustand`): planmäßig `normal`, angespannt `achtung`,
  kritisch `alarm`; nicht beurteilt = leeres Feld. Nur der Wechsel schreibt System-ETB. Im
  Abschnittsdetail eine `Segmentleiste` mit vier Stufen, jede Wahl speichert sofort, auch per
  Pfeiltaste (LFH-1208). Überblick meldet schlechtere Unterabschnitte („UA kritisch"). Ein
  Fortschritt hat keine Oberfläche (LFH-1208): die Spalte trägt nur Altdaten, die Lage trägt der
  Lagezustand, den Arbeitsstand die offenen Aufträge.
- **Gefahrenmatrix** (LLH-1090, Spec `gefahrenmatrix`): eine Zelle ohne Bewertung zeigt die
  Vorgabe „keine“ („–“), kein Zähler unbewerteter Felder; „nicht beurteilt“ steht am Gebiet
  (`beurteilt_at/von`, Knopf „Beurteilung bestätigen“ nur mit Schreibrecht, System-ETB) und
  fortgeschrieben die Entscheidung (LFH-969), dass Offenes nicht wie Entwarnung aussieht. Ein
  ungültiges Paar ist schraffiert (`schraffurStil`, `steuerRahmen`, ≥ 3 : 1), ohne Text.
  Verdichtet (LLH-1102): die ganze Zelle ist das Ziel (Polsterung 0, Knopf 100 %, Zeile =
  `controlHeight`, Ring nach innen). Wer Gefahrentypen listet, ordnet sie über
  `sortGefahrenAlphabetisch` bzw. `GEFAHRENTYPEN_ALPHABETISCH` (`gefahrenSchema.ts`), nie in
  der Katalogfolge `GEFAHRENTYPEN`. Erläuterungen (LLH-1110): eine Zelle mit Text trägt die
  Marke (Dreieck oben rechts, `currentColor`, Name „· mit Erläuterung“), unter der Matrix
  steht die Liste „Erläuterungen“. Die Marke kommt nur aus `pages/gefahren/ErlaeuterungsMarke.tsx`
  (auch im Lagebild-Paneel und im Palettenauszug, LLH-1365), der Namenszusatz aus
  `MIT_ERLAEUTERUNG`. Welche Zellen etwas sagen und in welcher Folge, entscheidet nur
  `pages/gefahren/erlaeuterungen.ts` (`zellenMitErlaeuterung`, `gesetzteGefahren`) — für
  Matrix, Lagebild, Palettenauszug, Lagekarte und Lagevortrag.
- **Sichtung ist eine eigene Achse nach BBK** und die Ausnahme vom Neuentwurf:
  SK I rot, II gelb, III grün, IV blau, Tote schwarz, „unverletzt" ohne Farbe. **Angezeigt** wird
  als umrandetes Farbfeld (`SichtungsTag`/`sichtungsfarben`); die Umrandung macht Gelb auf hellem
  und Schwarz auf dunklem Grund sichtbar. **Gewählt** wird als Vollfläche über
  `personen/SichtungsWahl.tsx` aus `sichtungsPalette` (`flaeche`, bis zum Textboden abgedunkelt,
  in beiden Modi gleich; `punkt` ist die Anzeigefarbe, eine Palette je Kategorie) mit Kante in
  `text` (`sichtungsKante`), gewählt mit ✓ und 3-px-Rahmen. Nach einer Wahl behalten die übrigen
  ihre Farbe als 4-px-Innenrahmen in `punkt` auf getönter Fläche, keine Randform; „tot“ trägt in
  jedem Zustand eine Schraffur, „unverletzt“ keine Fläche; der Startfokus liegt auf der Gruppe,
  nicht auf SK I. 72 × 96 px in jeder Stufe, kein Dropdown für die Sichtung (LLH-1083, LLH-1785,
  Spec `sichtungswahl`, `theme/sichtungKontrast.test.ts`). **Kein rohes antds `Tag`**
  (LLH-1779, Spec `status-darstellung`, Lint `no-restricted-imports`; Ausnahme nur
  `SichtungsTag`): ein Zustand steht in `Status` mit einer Rolle aus dem Vertrag; eine
  Kennzeichnung ohne Zustand (ad-hoc, Rolle, Kennung, Kategorie, Bezug) ist eine neutrale `Marke`,
  Blau bedient. Urteile („unterbesetzt“, „Soll erfüllt“) sind Zustände, keine Marken.
- **Rahmen heißt bedienbar** (LLH-1780, Spec `status-darstellung`): einen Rahmen trägt nur, was
  man bedienen kann. `Status` und `Marke` sind randlos; der bedienbare Status ist der
  `StatusKnopf` (Fläche der Rolle, Rahmen in ihrer Kante, Pfeil ▾, 14 px, sichtbar so hoch wie
  die Dichtehöhe 30/48/72), eine entfernbare Marke trägt Rahmen und ✕. Die Sichtung bleibt das
  umrandete BBK-Feld; wo sie bedienbar ist, legt sich der Knopfrahmen außen darum. Nachweis
  `theme/statusKnopfKontrast.test.ts`.
  Übergabe, Geschädigt-Bezug, UHS-Verortung tragen `bedien`. Personenstatus und Sichtung sind
  unabhängig.
- **Blauer Bedien-TEXT nimmt `rollen.bedienText`**; antds `colorLink` (Ruhe, Zeiger, gedrückt)
  **ist** `bedienText`, ein Link braucht kein eigenes `style`, Zeiger-Rückmeldung ist die
  Unterstreichung. Radio-Text im Stil `outline` über `index.css` (`--lfh-bedien-text`), kein
  `Radio.colorPrimary` (`docs/superpowers/specs/2026-09-22-lfh-613-pruefliste.md`).
- **Geerbter Text auf Textrollen** (LFH-652, Spec `textkontrast-rollen`): Beschreibung
  (`colorTextDescription`) und Kopf der `KatalogTabelle` lesen `gedaempft`, nie `schwach`;
  Formularmeldung über `Form`-Token in `alarmText`/`achtungText`, das globale `colorError` bleibt
  Füllfarbe; Standardknopf unter dem Zeiger in `bedienText`. Alles in `tokens.ts:antdToken`/
  `antdKomponenten`, nicht je Stelle.
- **Roter Fehlertext außerhalb von Formularen** (LFH-874, Spec `textkontrast-rollen`):
  `Typography` `danger` („konnte nicht geladen werden“, „Überfällig“, Ablehnungsgrund) liest
  `alarmText`, ein Link `danger` unter dem Zeiger `alarmHover`, über das GLOBALE `colorErrorText*`
  in `antdToken` (antd liest es nur als Schrift); das globale `colorError` bleibt Füllfarbe für
  Knopf, Rand und Kartenkante. Gemessen in `e2e/fehlertext-kontrast.spec.ts`.
- Kontrast: `e2e/betroffene-kontrast.spec.ts` (Tag ≥ 7:1, Nacht ≥ 5:1, Alpha mitgerechnet).
- **Kein eigener Knopfboden** (LFH-661, Spec `farbrollen-kontrast`): die Beschriftung des
  Primärknopfs hält den Textboden in Ruhe, unter dem Zeiger und gedrückt; Werte und Messung am
  Wert in `theme/tokens.ts`. Ein Kontrast-Spec führt den Primärknopf nie unter einer Ausnahme.
- **Gedrückt trägt den Zeigerton** (LFH-897,
  `openspec/changes/archive/2026-10-04-lfh-897-gedrueckt-textboden/design.md`): Primärknopf
  `bedienHover`, Gefahrknopf ohne Rahmen auf `alarmFlaeche`, über die `Button`-Token
  `colorPrimaryActive`/`colorErrorBgActive` in `antdKomponenten`, nie antds Ableitung (nachts
  dunkler als die Ruhe). Gemessen mit `gedrueckt` aus `e2e/kontrast-kern.ts`.
- **Gefahrrot ebenso** (LFH-693, Spec `farbrollen-kontrast`,
  `openspec/changes/archive/2026-10-01-lfh-693-gefahrtext-alarmtext/design.md`): roter
  Menüeintrag und Gefahrknopf lesen `alarmText`, unter dem Zeiger und gedrückt `alarmHover` (am
  Tag dunkler, nicht heller), über die `Dropdown`-/`Button`-Token in `antdKomponenten`, nie je
  Menü oder Knopf. Gemessen in `e2e/gefahr-kontrast.spec.ts`; kein Kontrast-Spec führt Rot unter
  einer Ausnahme.
- **Hinweisflächen sind Statusflächen** (LFH-739, Spec `farbrollen-kontrast`,
  `openspec/changes/archive/2026-10-02-lfh-739-hinweisflaeche-statusrollen/design.md`): `Alert`
  Info/Warnung/Fehler/Erfolg lesen `bedienFlaeche`/`achtungFlaeche`/`alarmFlaeche`/
  `normalFlaeche` über das `Alert`-Token in `antdKomponenten`, nie je Hinweis; antds Ableitung aus
  den Signalfarben ist am Tag trüb. Ein Knopf darauf behält `steuerRahmen` (≥ 3 : 1,
  `theme/hinweisKontrast.test.ts`, `e2e/hinweis-kontrast.spec.ts`). Der Override färbt nur die
  Fläche des Hinweises, antd-Bausteine darin sehen weiter die globalen Tokens.
- **Die Auswahlfläche ist eine eigene Rolle** (LFH-984, Spec `farbrollen-kontrast`,
  `openspec/changes/archive/2026-10-05-lfh-984-auswahlflaeche-rolle/design.md`): gewählte
  Option, gewählter Menüeintrag und Knoten tragen `auswahlFlaeche`, GLOBAL über
  `colorPrimaryBg`/`colorPrimaryBgHover` in `antdToken` (daraus `controlItemBgActive`), nie je
  Stelle; eigene Stellen lesen das Token. Unter dem Zeiger keine eigene Stufe. Der gewählte
  Dropdown-Eintrag schreibt in `bedienText` (`Dropdown.colorPrimary`). Nachweis
  `theme/auswahlKontrast.test.ts` (auch ΔE ≥ 7 gegen Ruhe und Zeigerspur),
  `e2e/auswahl-kontrast.spec.ts`.
- **Deeplink-Hervorhebung** (LFH-698, Spec `deeplink-hervorhebung`; `.zeile-hervorgehoben` an
  Datensicht und Zeitachse): `bedienFlaeche` plus Ober- und Unterlinie in `bedien` (`box-shadow`,
  `index.css`); ein `Zeitachseneintrag` setzt die Fläche inline mit, ebenso die
  Kommunikationskarte (`kommunikation/KommKarte.tsx`, LFH-896: Linien inline, nie ein Ring; eine
  Alarmkarte behält ihre Fläche, `kartenGrund`). Nie `flaeche3` (das ist der
  Hover; die Tagmodus-Regel unten meint Hover und aktive Segmente) und nie eine Statusfläche;
  Nachweis `e2e/deeplink-hervorhebung-kontrast.spec.ts`. **Farbliterale
  in CSS nur in `theme/rollen.css`** (Spec `css-farbquelle`, `theme/cssFarbquelle.guard.test.ts`,
  Schuldmenge `OFFEN` schrumpft nur).
- **Tagmodus** (LFH-618, `docs/superpowers/specs/2026-09-22-lfh-618-hellmodus-pruefliste.md`):
  `achtung`/`alarm` als Text über `achtungText`/`alarmText`; Hervorhebung auf `flaeche3`, nicht
  `flaeche2`; Kontrast gegen den tatsächlichen Grund (`e2e/hellmodus-kontrast.spec.ts`,
  `e2e/kontrast-kern.ts`). **Text auf der Hervorhebung hält den vollen Boden** (LFH-702/LFH-877,
  Spec `textkontrast-rollen`): Hover- und Aktivzeile sind Grund wie jede Fläche; deshalb ist
  `bedienText` am Tag so dunkel, dass er auf `flaeche3` ≥ 7 hält — die Fläche wird nicht
  aufgehellt, die Rolle nicht lokal überschrieben
  (`openspec/changes/archive/2026-10-01-lfh-702-hervorhebung-textboden/design.md`).
- **Textboden für jede Textstufe** (LFH-643, Spec `textstufen-kontrast`,
  `openspec/changes/archive/2026-10-01-lfh-643-tertiaertext-tagesboden/design.md`): `text`,
  `text2`, `gedaempft` und auch Tertiärtext `schwach` (Augenbraue, Meta, Platzhalter)
  halten auf jeder deckenden Fläche Tag ≥ 7 : 1, Nacht ≥ 5 : 1; benachbarte Stufen
  liegen ≥ 5 ΔL\* auseinander (`theme/textstufen.test.ts`). Eine Textstufe unterschreitet
  den Boden nur für Gesperrtes (≥ 4,5, Sperre auch ohne Farbe); Kontrast-Gates führen keine
  Tertiär-Ausnahme.
- **Gesperrte Steuerelemente** (LLH-1228): antds `colorTextDisabled` trägt die Rolle `gesperrt`
  (keine Textstufe, nur für Gesperrtes) und hält ≥ 4,5 auf antds durchscheinender Sperrfläche
  über jeder deckenden Fläche, nicht nur auf dem Grund daneben (`theme/gesperrtKontrast.test.ts`,
  `e2e/gesperrt-kontrast.spec.ts`). Nachts liegt sie heller als `schwach`: die Sperrfläche hellt
  den Grund auf.
- **Gesperrt trägt die Sperre ohne Farbe** (LLH-1233): gesperrte antd-Knöpfe und -Felder haben
  einen gestrichelten Rand in `steuer-rahmen`, randlose Einträge (Menü, Auswahlliste, antds
  `Segmented`, eigene `Segmentleiste`) eine Strichlinie nach innen (`index.css`, `sprache.css`).
  Gestrichelt heißt nur gesperrt: die Knopfvariante `dashed` ist gesperrt
  (`theme/gesperrtZeichen.guard.test.ts`).

**Lagekarte** (auch `pages/LagekartePage.tsx`): `frontend/src/pages/lagekarte/AGENTS.md`.

**Sprungmarken sind keine Module** (LFH-620, `einsatz/sprungmarken.ts`): Entscheidungen = ETB
`?typ=entscheidung`, Patienten = Personen im Sichtungsboard (`ansicht=raster`), Vermisste = Personen
`?filter=vermisst`. Kein Registry-Eintrag, kein `verweistAuf`; Marke erbt Sichtbarkeit/Sperre,
nie `aria-current`, Ziel im zugänglichen Namen, Pfad aus `routing/deeplinks.ts`. Eine Marke steht
in der Kategorie ihres Zielmoduls direkt hinter ihm oder einer Marke desselben Ziels (Entscheidungen
unter ETB in der Erfassung) und erscheint als eingerückte Unteransicht mit Führungslinie, ohne
Pfeil-Symbol (LLH-1733, `sprungmarken.test.ts` hält die Kategorie);
Die Sicht ist Zustand der Adresse (`personen/usePersonenSicht.ts`, LLH-1826): eine Marke zeigt genau ihre Sicht, was sie nicht nennt, gilt als Vorgabe. Kein Filterwert „patienten".
Fernmeldeskizze und Kommunikationsplan sind Marken
hinter „Fernmeldewesen“ (Ziel `fernmeldewesen`, LLH-1180), eine Marke „Funkplan“ gibt es nicht. Gesperrt
heißt mit Schloss, nicht weg. Jede Marke steht auch in der Sprungpalette (Gruppe „Ansichten“,
`frontend/src/command-palette/AGENTS.md`) und trägt dafür `schlagworte`.

**Fernmeldewesen** (Funkplan, Skizze, Sprechgruppen, Kommunikationsplan, Einsatzleiter; auch
`pages/FunkplanPage.tsx`, `pages/KommunikationsplanPage.tsx`): `frontend/src/fernmeldewesen/AGENTS.md`.
**Informationstelefon** (eigenes Modul; auch `pages/InfotelefonPage.tsx`, `src/infotelefon/`):
`frontend/src/infotelefon/AGENTS.md`. **Lagebesprechung** (eigenes Modul, Termin,
Vorbereitung, überfälliger Termin; auch `pages/LagebesprechungPage.tsx`, `src/lagebesprechung/`):
`frontend/src/lagebesprechung/AGENTS.md`.
**Führungsfunktionen** (Katalog, Codespalte neben Freitext, Besetzung zur Lesezeit; auch
`src/fuehrung/`): `frontend/src/fuehrung/AGENTS.md`. **Betreuung und Verpflegung** (auch
`pages/VerpflegungPage.tsx`, `src/betreuung/`, `src/verpflegung/`): `frontend/src/betreuung/AGENTS.md`.
**Kräfte-Zeitachse** (Einsatzdauer in der Kräfteübersicht, Personal und Einheit-Detail; auch
`src/zeitachse/`, Status-Kataloge mit `zeitachse_marke`) und **Ablösung** (Rangfolge,
Vorwarnung aus dem DTO, Schichtmodelle; auch `abloesung/`, `src/schichtmodell/`):
`frontend/src/kraefte/AGENTS.md`.

## Frontend — Bedien-Leitlinie (Einsatzkontexte)

Zweite Achse neben LFH-19: für welchen **Kontext** gebaut wird (LFH-327). Herleitung und
Prüfliste: `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`; Fallen,
Scanner-Interna, Messwerte: `docs/leitlinien/bedien-leitlinie-herleitungen.md`.

**Kontexte:** **Fükw** (primär, 13–15", Tastatur+Maus, kompakt) · **Führungs-Tablet** (1024–1280
px, Touch, oft Handschuh, keine Massenerfassung) · **ortsfeste Stelle** (BHP/BTP, kompakt, voller
Tastaturfluss) · **mobil** (~390 px, einhändig, keine Vergleichsansichten).
Die Lagekarte bedient den Kontext mobil (LFH-557): `frontend/src/pages/lagekarte/AGENTS.md`.

**Prüfliste Einsatztauglichkeit (15 Kriterien)** an jede neue oder umgebaute Seite; ohne sie ist
ein Modul-Task nicht fertig. Jede Zeile trägt ein Verdikt (erfüllt / offen → Zielticket / nicht
anwendbar), „nicht geprüft" ist keins.

**Texte: zeigen statt erklären** (LFH-1078)

- **Text erklärt nie die Bedienung.** Was ein Knopf tut, zeigt seine Beschriftung; wie ein Feld
  gefüllt wird, zeigen Platzhalter (der wirksame Wert, etwa „jetzt“), Einheit und Prüfung; was
  fehlt, zeigt der Leerzustand mit Knopf (`SeitenLeer` mit `aktion`); warum etwas gesperrt ist,
  steht in wenigen Wörtern sichtbar am Element, nie nur im Tooltip (Touch).
- Kein Satz nennt Dateiformate, Server, Phasen oder Datenflüsse. Neue Seiten tragen keinen
  Zweck-Absatz unter dem Titel; bestehende `beschreibung="…"` werden schrittweise abgebaut
  (LFH-1078; der Wächter erfasst sie nicht).
- Erlaubt: Fehlermeldungen, Zustände („Offline vorgemerkt“, „Update lädt“), **ein** kurzer Satz
  zur Folge vor einem unumkehrbaren Schritt, Datenschutz-Hinweise („Zugriff wird protokolliert“),
  Modulbeschreibungen aus wenigen Fachwörtern, die Darf-Zeile unter einer Rollenoption (Umfang in
  wenigen Wörtern, keine Bedienung; „Begriffe“, Rollen-Vokabular).
- **Erklärendes gehört in die Anwenderdokumentation** (`docs/anwender/`, in der App unter
  „Hilfe“, LFH-1096): wer einen Erklärsatz entfernt, dessen Wissen sonst nirgends steht, schreibt
  es dort ins Kapitel. Regeln: `docs/anwender/AGENTS.md`.
- Wächter: `components/erklaertext.guard.test.ts` sucht Erklärmuster („Leer:“, „Klick auf“,
  „Enter sendet“, „sobald wieder Verbindung“, „read-only“ …) in sichtbaren Texten. Die Schuldmenge
  `OFFEN` ist leer (seit LFH-1078 P7); neue Einträge gibt es nicht, ein Treffer wird umgebaut.
- **Ausnahme Rundgang** (LLH-1990, Entscheidung 20.11.2026): Der Rundgang für Erstnutzer darf
  die Bedienung erklären. Seine Texte stehen nur in `hilfe/rundgang/rundgangTexte.ts`, die der
  Wächter als einzige Datei ausnimmt (`AUSNAHMEN`); die Anrede-Regel gilt dort weiter. Er startet
  von selbst nur für Erstnutzer und im Einsatz nur in einer Übung, nie am Handschirm oder auf einem
  gekoppelten Gerät oder unter Browser-Automatisierung (`navigator.webdriver`), und öffnet weder
  Paneel noch Schublade. Herleitung:
  `docs/superpowers/specs/2026-11-20-kgsx7ta3-einfuehrung-erstnutzer-design.md`.
- **Anrede: niemand wird angesprochen** (LLH-1830, Entscheidung 19.11.2026). Kein Du, kein Sie,
  auch nicht in Servertexten, die bis zum Anwender durchkommen. Texte nennen die Sache („Eigene
  Rolle“, „Code aus der Authenticator-App“) oder den Handgriff im Infinitiv („Nur bestätigen,
  wenn …“); eine Frage ohne Pronomen ist erlaubt („Mit welchem Rufnamen ins ETB schreiben?“).
  Dieselbe Regel gilt für die Anwenderdokumentation (`docs/anwender/AGENTS.md`). Wächter:
  `anredeText.guard.test.ts`; „Sie“ für eine Sache am Satzanfang steht dort als bewertete
  Ausnahme. Herleitung: `docs/superpowers/specs/2026-11-19-xdj6orw3-ton-und-technikreste-design.md`.
- **Kürzel sind eingeführt oder erklärt** (LLH-1750, Spec `bedien-wortlaut`,
  `openspec/changes/archive/2026-11-18-aovwhho1-kuerzel/design.md`): Die Oberfläche zeigt ein
  Kürzel nur, wenn es in `anzeige/kuerzel.ts` (`EINGEFUEHRTE_KUERZEL`) steht oder auf derselben
  Fläche sichtbar erklärt wird; sonst wird es ausgeschrieben („Unterabschnitte“, nicht „UA“). Ein
  neues Kürzel kommt in die Liste und in die Tabelle des Kapitels `zeiten-und-kuerzel.md`
  (`anzeige/kuerzel.test.ts` hält beide gleich). Kurzbezeichnungen der Organisation („EA 1.1“) sind
  Daten und bleiben. **Die Stärke** schreibt nur `anzeige/staerke.ts` (`staerkeText`, Wert
  „1/2/5//8“); jede Fläche mit Stärke nennt die Schreibweise „F/UF/M//Σ“ einmal sichtbar
  (Spaltenkopf, Feldetikett, Legende), der Wert trägt `STAERKE_AUSGESCHRIEBEN` als `title`
  (`StaerkeAnzeige`, `Kennzahl notizBeschreibung`). „Ges“, „Gesamt“ und eine Stärke ohne Summe gibt
  es nicht (Wächter `anzeige/staerke.guard.test.ts`). **Die Schreibweise erklärt sich auf Tippen**
  (LLH-1825, `docs/superpowers/specs/2026-11-19-f71gxt0s-kuerzel-legende-design.md`): in Komponenten
  steht sie nur über `anzeige/KuerzelErklaerung.tsx` (`StaerkeSchreibweise`, schmale Spalte
  `umbruchVorSumme`), einen Knopf ohne Knopfoptik mit Popover aus Bedeutung, Beispiel und dem Link
  „Zeiten und Kürzel“; ein Tooltip allein trägt auf Touch nicht. Der Knopf hält Klicks, Enter und
  Leertaste, Zeile und Tabellenkopf darum lösen nicht aus; Esc und Pfeile reicht er geschlossen
  weiter, und ein Klick auf den Verweis im Fenster erreicht die Umgebung (Sprungpalette schließt).
  Nie in einem Link oder `<label>`: dort bleibt die Schreibweise Text, und die Erklärung steht einmal
  über den Zeilen (Überblick: `vorspann` des Paneels, nicht im Kopf-Meta, das schmal abgeschnitten
  wird). Ein Spaltentitel als Knoten trägt `etikett` mit dem Klartext. **Die Trefffläche ist die
  Textzeile**, eine begründete Ausnahme von der Staffel 30/48/72 (Entscheidung 19.11.2026): das
  Kürzel steht in dichten Etiketten direkt über bearbeitbaren Werten, ein größeres Feld überdeckte
  sie, und die Erklärung ist ein Zusatz, keine Handlung. Ausnahmen mit Grund und der Wächter (auch
  Etiketten in `.ts`): `anzeige/kuerzelErklaerung.guard.test.ts`; in Leseansichten zählt der
  Erklär-Knopf nicht als Aktion (`test/kuerzel.ts`, `aktionsKnoepfe`).

**Tabelle und Dichte**

- **Tabelle nur, wenn verglichen wird**: stehende Kopfzeile, fixierte **menschenlesbare** Kennung
  (nie DB-`id`), Spaltenschalter **mit Zähler ausgeblendeter Spalten**. Der Zähler steht erst
  nach eigener Wahl im Namen (LLH-1790, Spec `katalogtabelle-spaltenschalter`): solange die Wahl
  der Voreinstellung der Seite und der Breite folgt, heißt der Schalter „Spalten“, danach
  „Spalten · n ausgeblendet“ mit allen verborgenen (`weichtVonVorgabeAb` in
  `components/SpaltenSchalter.tsx`; die Seite reicht `spaltenAusVoreinstellung` durch). Auf schmalem Schirm
  **angepasst, nicht in Karten aufgelöst**; ausgenommen sind Flächen mit `form="auto"`, deren
  Zeile am Handy nicht trägt (Fahrzeuge, Personal, die Einheitenliste mit Baum als Karten,
  LLH-1787). Träger `KatalogTabelle`/`Datensicht`.
- Spaltenschalter: `components/SpaltenSchalter.tsx` (eine Wahrheit für Handwahl und `abBreite`);
  in `KatalogTabelle` nur per Opt-in `spaltenSchalter={{ bezeichnung }}`, `Datensicht` setzt es
  nie. Antds `responsive`/`hidden` gesperrt (`katalogTabelle.guard.test.ts`). Das Häkchen zeigt
  die wirkliche Sichtbarkeit. Eine Seite mit eigener Werkzeugzeile (Kräfteübersicht) hängt ihn dort ein:
  Zustand aus `useSpaltenSchalterZustand`, an die Sicht als `spaltenSchalterAussen` (LLH-1417);
  sein Fokus hält die Zeilenschleuse nicht, die Werkzeugzeile der Sicht bleibt Standzeile des
  Sammelbanners. Sonst bleibt der eingebaute Schalter.
- **Eine Vergleichstabelle ist sortier- und filterbar, im Spaltenkopf** (LLH-1086, Spec
  `tabellen-sortieren-filtern`): Sortieren per Klick auf den Kopf, Filter über antds
  Spaltenfilter (kontrolliert, im Clientmodus mit Zähler „Groß (3)“), je aktivem Wert ein Chip
  (`components/tabellenFilter.tsx`) und darüber der `Filterhinweis` (Treffer von Gesamt,
  „Filter zurücksetzen“ leert Suche und Filter, nicht die Sortierung). Die gefilterte Kopfzelle
  trägt eine 2-px-Linie in `bedien`. Was man nicht sieht, wirkt nicht: der Filter einer
  ausgeblendeten Spalte schneidet nichts und steht nicht als Chip da. Der Kartenzweig zeigt
  dieselbe Menge und sortiert über „Sortieren“; zurück geht es über den Eintrag „wie geliefert“,
  nicht über ein Löschkreuz (LLH-1798, Spec `einsatztauglichkeit-layout`: es war 12 × 12 px und der
  einzige Rückweg). Im Servermodus zählt das Kopfmenü nicht und die
  Zahlen kommen vom Server (`serverseitig.zahlen`). Sortierung, Filter und Suche stehen in der
  Adresse (`?sort=ort:auf&f.ausmass=gross&q=`, `routing/deeplinks.ts`), sonst gilt der Stand der
  Sitzung; die Spaltenwahl liegt am Gerät — beides über `useListenGedaechtnis`
  (`components/listenGedaechtnis.ts`), den die SEITE hält und als `gedaechtnis` an
  `Datensicht`/`KatalogTabelle` reicht; ohne gemerkte Spaltenwahl gilt `spaltenAusVoreinstellung`.
  Spalten, die beim ersten Rendern noch nicht feststehen (Werte aus den Zeilen, Spalte hinter einer
  Freigabe), nennt die Seite als `ausDaten`, sonst fiele ihr Filter aus der Adresse. Eine Sicht im
  Baummodus sortiert und filtert nicht (Kräfteübersicht, Funkplan, Kommunikationsplan; Kommentar an der
  Sicht). Ein Filter mit `ohneKartenfeld` hat im Kartenzweig kein Auswahlfeld (Betroffene, Status
  der Tiere: die Seite führt die Achse schon, die erste Karte bleibt im ersten Bild), wirkt aber
  und steht als Chip da. Vorbild Schäden, dazu Fahrzeuge, Personal, Material, Sprechgruppen,
  Betroffene, Tiere, Evakuierung (Rollout LLH-1096). Gerätestartseiten bleiben ohne Kopffilter
  (Kommentar an der Seite).
  In einer `KatalogTabelle` (Unfallhilfsstellen, Bereitstellungsräume) trägt jede Spalte `key` und
  `sorter`, eine Werteliste `filters`/`onFilter`; das Gedächtnis prüft gegen ein Register auf
  Modulebene (`GEDAECHTNIS_SPALTEN`). Ein Reiter einer Detailseite (Kräfte der UHS) sortiert und
  filtert ohne Gedächtnis: die Adresse meint das Objekt. `MaterialAmOrt` bleibt ohne (eine gelöste
  Zeile hält ihre Stelle, LLH-1254).
  Nachweise `e2e/tabellen-sortieren-filtern.spec.ts`, C16 in `e2e/trefflaeche-pruefflaechen.spec.ts`,
  Filtermarke in `e2e/auswahl-kontrast.spec.ts`.
- **Die Hauptaktion einer Zeile bleibt im Bild** (LLH-1789, Spec `einsatztauglichkeit-layout`,
  Change `lsug0joq-tabellen-touch` D1): die Aktionsspalte einer `Datensicht` trägt `amEnde` und
  steht ab `md` rechts fixiert (direkte `KatalogTabelle`-Nutzer setzen `fixed: 'right'` selbst); unter `md` ziehen Primäraktion und ⋮ in die fixierte Kennung (`Datensicht`), eine
  zweite fixierte Spalte gibt es dort nicht. Spalte mit Primäraktion über
  `components/aktionsSpalte.tsx` (Breite je Stufe gerechnet, aus `PrimaerAktion`/`WeitereAktionen`
  wie Karte und Kontextmenü); eine reine ⋮-Spalte (`menueSpaltenBreite`) setzt nur `amEnde`.
  Nachweis `e2e/gate1-ueberlauf.spec.ts` („Aktion im Bild“), Fokus in
  `e2e/fokus-verdeckung.spec.ts`.
- **Kopf und Körper sind gleich breit** (LLH-1788): mit stehender Kopfzeile legt rc-table den
  Kopf in eine eigene Tabelle; `theme/sprache.css` setzt sie auf `table-layout: fixed`, damit
  sie die gemessenen Körperbreiten genau übernimmt. Damit der feste Kopf nie gekürzt wird, hebt
  `KatalogTabelle` jede Zahlbreite und jedes `mindestBreite` auf die Mindestbreite ihres Kopfs
  (`components/kopfBreite.ts`: längstes Wort des Titels in der Kopfschrift, Sortiersymbol,
  Filterauslöser der Stufe, Zellpolster). Gerechnet, nicht gemessen, damit nichts springt.
  Nachweis `e2e/gate1-ueberlauf.spec.ts` („Spaltenköpfe … stehen über ihren Spalten“).
- **Kopfwerkzeuge der `KatalogTabelle` folgen der Dichte** (LLH-1227): Suche und Spaltenschalter
  stehen `paddingSM` auseinander, antds Spaltenfilter-Auslöser hält `controlHeightSM` und liegt
  in der Tab-Folge (Name „<Spalte> filtern“, Enter/Leertaste öffnen), beides im Primitiv, nie je
  Seite. Nachweis `e2e/katalogtabelle-kopf-dichte.spec.ts`.
- **Eine sortierbare Kopfzelle sortiert nur über ihren Inhalt** (LLH-1273): antd hängt den Klick
  an die ganze Zelle, zwei sortierbare Köpfe stießen ohne Lücke aneinander. `KatalogTabelle` hält
  einen Klick in die Polsterung an (`polsterKlickRiegel`), der Inhalt reicht senkrecht bis an den
  Zellrand und auf `controlHeight` (`sortierKopfStyle`, `theme/sprache.css`); die Polsterung trennt
  die Spalten. Nicht über `pointer-events: none`: unter einer fixierten Zelle fiele der Tipp auf
  die verdeckte Spalte. Unit-Tests klicken über `sortTarget` (`test/utils.tsx`). Nachweis
  `e2e/gate3-trefflaeche.spec.ts` „Personal (LLH-1273)“.
- **Das Aufklappsymbol im Baum der `Datensicht` folgt der Dichte** (LLH-1240): antds Symbol steht
  in einem Knopf mit Höhe `controlHeight` und Breite `controlHeightSM` (`baumSymbolZielStil`),
  der Text daneben mittig in derselben Höhe (`baumTextStil`); im Druck fällt der Boden. Nachweis
  `e2e/gate3-trefflaeche.spec.ts` „Baumtabellen“ (Einheiten, Kräfteübersicht, Funkplan).
- Stehende Kopfzeile hält Freiraum (`setzeKopfFreiraum`, `scroll-margin-top` in `sprache.css`);
  Fokus-Nachweis darunter auch mit `Shift+Tab` (`fokus-kern.ts`, `taste`). In der ersten Zeile
  beschneidet Chromium den Rand am Scrollcontainer von `scroll.x`; dort rollt
  `useFokusUnterKopf` (`components/fokusUnterKopf.ts`) nach (LLH-1358). `KatalogTabelle` trägt
  ihn, eine Tabelle mit stehender Kopfzeile außerhalb ruft ihn selbst (Gefahrenmatrix).
- **Dichte-Staffel 30 / 48 / 72 px** (kompakt · komfortabel · Handschuh) über ein Dichte-Token am
  `ConfigProvider`: `controlHeight` 30/48/72, `controlHeightSM` 24/48/72. **Neues punktuelles
  `size="small"` auf interaktiven Elementen ist verboten** (`components/dichte.guard.test.ts`,
  Schuldmenge `OFFEN` schrumpft nur, im selben Commit wie der Fix; Stand: UHS-Platzkarte in
  `pages/uhs/Grundriss.tsx`, nur in `kompakt`, sonst `platzBedienform`). `Card`/`Descriptions`/
  `Space`/`Liste` dürfen klein bleiben.
- **Die Zähltaste einer Hochfrequenz-Erfassung („+1“) hat in jeder Stufe einen Boden von 72 px**
  (Höhe und Breite) und steht am unteren Rand (LLH-1032, `verpflegung/zaehltasteStil.ts`). Das ist
  eine Ausnahme nach oben, keine Stufenwahl: die übrigen Tasten folgen der Staffel. Nachweis
  `e2e/gate3-trefflaeche.spec.ts` („Ausgabeansicht“).
- **Zoom frei, Felder 16 px auf Touch** (LLH-2043; umgekehrt 22.11.2026 gegenüber LLH-1328 „Kein
  Zoom wie in einer App“): der Viewport in `index.html` sperrt den Zoom nicht, wer schlecht liest,
  zieht die Seite größer. `touch-action: manipulation` auf `html` (`index.css`) sperrt nur den
  Doppeltipp. Damit iOS beim Fokus nicht in ein Feld hineinzoomt (es tut das unter 16 px), tragen
  Eingabefelder auf grobem Zeiger `feldSchriftTouch` (16 px, `theme/tokens.ts`, Regel am Ende von
  `theme/rollen.css`), auch gegen Inline-Größen. Die Regel hebt nur an: antds große Felder
  (`size="large"`, 16 px oder mehr) bleiben, Knöpfe, Etiketten und Lauftext bleiben in der Dichte. Wächter `theme/zoomFrei.guard.test.ts`, Beleg `e2e/zoom-frei.spec.ts`.
- **Die Stufe folgt dem Gerät, nie der Person** (LFH-724, Spec `bedien-dichte`): beim Start
  gespeicherte Wahl → Zeigerart (grob → `komfortabel`) → `kompakt`, nur in
  `theme/dichte.ts:startDichte`; `handschuh` nur auf Wahl, kein Zuhörer auf die Zeigerart, kein
  Import aus Einsatz, Rolle oder Funktion (`theme/dichteQuelle.guard.test.ts`). Browser-Beleg
  `e2e/dichte-ableitung.spec.ts`; Flächenmessung der Modul-Prüflisten
  `e2e/trefflaeche-pruefflaechen.spec.ts`, Messhelfer in `e2e/trefflaeche-kern.ts`.
- **Der Navigationsrahmen hat keine Dichte-Ausnahme** (LFH-384): die 48 ist Boden, nie Deckel
  (`Math.max(48, controlHeight)`, Griffe über `navGriffMass`); die Rail-Spalte wächst mit
  (`railBreite` in `components/Kopfleiste.tsx`, 73 px in `handschuh`).
- Knopfboden `minWidth` = `controlHeightSM` (`antdKnopf()` in `theme/tokens.ts`). `Switch` über
  `switchMasse`/`antdKomponenten(farben, dichte)`; Nachweis am CSS der `css-var-…`-Klasse über
  `innerHTML`, nicht `textContent`. Schalter in fester Breite brechen um, statt zu kürzen
  (`pages/lagekarte/leistenTeile.tsx`, Zeilen in `pages/lagekarte/Ebenenbaum.tsx`,
  `e2e/lagekarte-leiste-dichte.spec.ts`).
- **Klappkopf** (LFH-653): jedes `Collapse` bekommt den Boden über den Kontext
  (`antdKlappkopf(dichte)` in `theme/tokens.ts`, `collapse` am `ConfigProvider`: `minHeight`
  30/48/72 + Mittellage); antd rechnet den Kopf sonst aus der Schrift (36/45/55). Kein lokales
  `styles.header` je Stelle. Nachweis `e2e/dokumente.spec.ts` „Dichte-Staffel“.
- **Beschriftetes Kästchen** (LFH-907): jede `Checkbox` mit Text bekommt den Boden über den
  Kontext (`antdKaestchen(dichte)`, `checkbox` am `ConfigProvider`: `minHeight` 24/48/72 am Label
  und Mittellage); antd hat dafür kein Token, das Label wäre nur so hoch wie die Schrift
  (21,5/36). Ohne Text (antds Tabellenfilter) kein Boden; im Menüeintrag hebt
  `style={{ minHeight: 0 }}` ihn auf, dort ist der Eintrag das Ziel (`SpaltenSchalter`).
  Nachweis `e2e/trefflaeche-pruefflaechen.spec.ts` (C7).
- **Schließen-Kreuz eines Hinweises** (LLH-1798, Spec `einsatztauglichkeit-layout`): jedes
  schließbare `Alert` bekommt den Boden über den Kontext (`antdHinweis(dichte)` in
  `theme/tokens.ts`, `alert` am `ConfigProvider`: 24 / 48 / 72 auf beiden Achsen am Knopf selbst),
  höhenneutral über einen negativen Rand; antd zeichnete es 12 × 14 px in jeder Stufe. Kein eigenes
  `closeIcon` oder `styles.close` je Stelle. Nachweis `e2e/gate3-trefflaeche.spec.ts` („Hinweis-Kreuz
  und kurzer Ortspfad-Link“, wirksame Fläche per `elementFromPoint`).
- **Handgebautes Bedienziel** (LFH-365): `minHeight: token.controlHeight` **plus** `padding` aus
  `token.paddingSM`/`token.padding` (aufgelöste Tokens, nie `var(--lfh-*)`), geprüft über eine
  reine exportierte Stilfunktion (`bedienzielStil`) mit Böden als **Literalen**. **Ein `<a>` erbt
  keine Steuerhöhe.** Gate 3 je Route: `e2e/gate3-trefflaeche.spec.ts`. Kennungs-Links in
  Tabellen-, Listen- und Zeitachsenzeilen tragen den Boden über `components/kennungsLink.tsx`
  (`KennungsLink`, LFH-908), ohne eigene Polsterung: die trägt die Zelle. Ebenso das
  Auswahlziel einer Karte (`auswahlZielStil` in `components/ListeDetail.tsx`): die Polsterung
  trägt die Karte, ein Klick darauf wählt über den Kartenhalter.
- **Die Brotkrume hat keine Dichte-Ausnahme** (LFH-909): jeder Link im Ortspfad des Seitenkopfs
  hält die Staffel über `ortspfadStil` (`components/EinsatzSeite.tsx`) und die Pfad-Link-Regel in
  `EinsatzSeite.css`, durchsichtiger Rand statt Schrift (bleibt 12 px), dazu die Mindestbreite eines
  Knopfs der Stufe (`controlHeightSM`, LLH-1798: „ETB“ war 32 px breit). Die CSS liest
  `--lfh-ortspfad-ziel` und `--lfh-ortspfad-breite`, die Stilfunktion setzt dort den aufgelösten Token, kein `var(--lfh-*)`
  der Dichte. Seiten geben nur ihre `Breadcrumb` hinein, kein eigener Boden je Seite.
- **Tastenkürzel als Marke** (LFH-335), nie nacktes `<kbd>`: `components/Tastenkuerzel.tsx`
  (Flex mit `gap`, `currentColor`, **kein** `controlHeight`-Boden; `tastenkuerzelStil` pinnt die
  Abwesenheit).

**Sprungpalette**: `frontend/src/command-palette/AGENTS.md`.

**Begriffe**

- **Rollen-Vokabular** (LLH-1818, Entwurf
  `docs/superpowers/specs/2026-11-19-zlzpieaq-rollen-vokabular-design.md`): Name und Darf-Zeile
  jeder Rolle stehen nur in `einsatz/rollenVokabular.ts` (Rolle im Einsatz, in der Organisation,
  in der Verwaltung, Stufe der Modulsperre). Eine Rolle heißt überall gleich: „System-Admin“ (mit
  Bezug auf den Einsatz „System-Admin der Organisation“, nie „Org-Admin“), „Führungskraft der
  Organisation“, ohne Rolle „Keine“ bzw. am Konto „Keine Rolle“; Felder heißen „Rolle in der
  Verwaltung“, „Rolle in der Organisation“, „Rolle im Einsatz“. Jede Auswahl, die eine Rolle
  vergibt, nutzt `rollenOptionen` und `rollenOptionRender` (`einsatz/rollenOption.tsx`): offen Name
  und Darf-Zeile, geschlossen nur der Name. Darf-Zeilen höchstens 80 Zeichen. Eine neue Rolle kommt
  zuerst ins Vokabular (der `Record` bricht sonst den Build). Wächter
  `einsatz/rollenVokabular.guard.test.ts`.
- **Voreingestellte Werte heißen „Vorgabe“** (LFH-944, Spec `bedien-begriffe`): nie „Default“,
  „Fallback“ oder „Standard“ im sichtbaren Text. Platzhalter nennen den Wert, der leer wirklich
  gilt; kein „Leer = …“-Satz daneben (LFH-1078). Bausteine in `components/vorgabeText.ts`
  („… (Vorgabe)“, „Vorgabe der Organisation: …“), Wächter `components/vorgabe.guard.test.ts` mit Ausnahmeliste
  für Eigennamen („Standard-Rufname“, „Standardansicht“).
- **Meldung und Lage** (LLH-1046, Spec `bedien-wortlaut`; Begriffe in
  `docs/design/2026-10-21-meldungsmodell/README.md`): das Modul heißt „Meldungen“ (Eingang und
  Ausgang), „Lagemeldungen“ ist die Sicht auf die lagerelevanten Meldungen. Eine Meldung anderer
  Art wird „In die Lage übernommen“ (Aktion und Dialog „In die Lage übernehmen“, Rückmeldung,
  Hinweis, ETB-Eintrag), ihr Etikett ist „In der Lage ✓“; „übergeben“ steht dafür nie. Der
  ETB-Typ „Lage“ heißt in der Mehrzahl „Lagefeststellungen“, nie „Lagemeldungen“. Das Paneel des
  Lagebilds mit ETB-Einträgen heißt „Jüngste ETB-Einträge“.

**Aktionen**

- **Knöpfe nennen die Handlung** (LFH-959, Spec `bedien-wortlaut`): ein Knopf trägt, was er
  tut („Bearbeitung beginnen“, „Außer Dienst nehmen“), ein Zustand steht nur auf dem Etikett.
  Kein Knopftext gleicht einem Statuswort desselben Moduls; die Texte stehen je Zielstatus in
  `kommunikation/phase.ts` (`…_HANDLUNG`) bzw. `stammdaten/dienststatus.tsx`, Guard
  `kommunikation/wortlaut.guard.test.ts`. Der Bestätigungsknopf einer Rückfrage nennt die
  Handlung, nie nur „Ja“/„OK“ (rote `Popconfirm`: `components/rueckfrage.guard.test.ts`, ohne
  Ausnahmen). Eine fachliche Unterscheidung ist ohne Hover lesbar, ein Tooltip
  ergänzt nur. „Quittieren“ heißt Empfang bestätigt (Meldung, Auftrag, Fernmeldeskizze), eine
  Erinnerung „erübrigt“ sich.
- **Datensatz-Aktionen werden gebündelt** (LFH-365): ab drei (nach Rechteprüfung) hinter
  **`components/MenueAusloeser.tsx`** (LFH-683, Spec `datensatz-aktionsmenue`). Der Baustein
  trägt Auslöser, `autoFocus`, Einheitsform (neutral, ein Trenner, Gefahr rot) und den Riegel
  gegen Portal-Klicks; kein eigenes `Dropdown` mit Dreipunkt (`menueAusloeser.guard.test.ts`).
  Beim Aufrufer bleiben: die Zählung, der zugängliche Name mit **Zeilenkennung**, die Rückfrage
  per `<Modal>` außerhalb der Zeilen-`map` (kein `Popconfirm`, Etiketten sind Text) und der
  Rechte-Riegel an der Ableitung (ein Callback ist kein Rechtebeleg). Prüft ein Aufrufer
  `aktionen != null`, gibt er bei leerer Menge selbst `null` zurück. Test über
  `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`. Kartenmodus: `Datensicht`
  baut `weitere`.
- **Beenden: Verb, Ort und Sicherung je Art** (LLH-1722, Spec `bedien-muster`,
  `openspec/changes/archive/2026-11-16-tfq6f4kb-loesende-aktionen/design.md` D1): eine Handlung, die einen Datensatz
  beendet, gehört zu genau einer Art, und die Art bestimmt alles:

  | Art             | Verb                                                                               | Ort                                                                                                                                                                                                                    | Sicherung                                                                                                                              |
  | --------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
  | Zuordnung lösen | „Aus <Ziel> lösen“, „Vom <Ziel> lösen“; „Abziehen“ (UHS), „Austragen“ (BR) bleiben | ⋮ der Zeile; sichtbarer Knopf nur als einzige Handlung der Zeile                                                                                                                                                       | ohne Rückfrage, Rückgängig; fällt der Datensatz aus der Ansicht, hält die Zeile „Gelöst · Rückgängig“ (`components/useHoldGeloest.ts`) |
  | Kraft entlassen | „Entlassen“, Material „Aus dem Einsatz nehmen“                                     | Liste: ⋮; Detail: letzter Abschnitt „Aus dem Einsatz“; **nie Hauptaktion einer Karte**                                                                                                                                 | Rückgängig nur, wenn der Rückweg den Zustand davor herstellt, sonst Rückfrage                                                          |
  | Gebilde beenden | „Auflösen“ (endgültig), „Schließen“ (umkehrbar)                                    | Auflösen: letzter Abschnitt der Detailseite (Vorbild `EinheitAufloesen`, `components/BeendenAbschnitt.tsx`); auf einer Fensterseite (UHS) oder ohne Detailseite rot im ⋮; Schließen: Statusschritt                     | Auflösen: Rückfrage mit Folgesatz und benanntem Knopf; Schließen: Rückgängig                                                           |
  | Fehlanlage      | „Stornieren“                                                                       | dort, wo „Auflösen“ oder „Entlassen“ der Seite steht (letzter Abschnitt bei Einheit, BR und Personal, ⋮ bei UHS, Fahrzeug und Material); sonst ⋮, rot hinter dem Trenner (Detailseite: ⋮ des Kopfs); nie ein Kopfknopf | Rückfrage                                                                                                                              |
  | Eigene Buchung  | „Zurücknehmen“ („Zurückziehen“, „Aufheben“ bleiben Fachwörter)                     | Zeile oder ⋮                                                                                                                                                                                                           | Rückfrage, Grund nur, wo das Fach ihn verlangt                                                                                         |

  In der gehaltenen Zeile steht „Gelöst“ träge an der Stelle des Auslösers, der gelöst hat,
  „Rückgängig“ an der Stelle eines Reglers, der nichts löst: ein zweiter Tipp trifft nie den
  Rückweg. Die übrigen Teile der Zeile bleiben unsichtbar an ihrem Platz, damit eine umgebrochene
  Zeile ihre Höhe hält. Eine Person, die im Einheit-Detail über ihr ⋮ aus der Einheit gelöst wird,
  behält keine Zeile: der Hinweis trägt das Rückgängig (design.md D7). Hat eine Zeile keinen
  Regler (UHS-Kräfte, Besatzungsblock der Fahrzeugliste), steht „Rückgängig“ an der Stelle ihrer
  Funktion bzw. Angabe (LLH-1924,
  `openspec/changes/archive/2026-11-17-bq8dvx19-loesen-nachziehen/design.md` D4).

  Jedes Rückgängig einer gelösten Zuordnung schickt `?nur_wenn_frei=1` (Einheit, Material am Ort,
  Besatzung, UHS-Kraft): steht der Datensatz inzwischen woanders, lehnt der Server mit 409 ab und
  nennt den Ort, statt ihn dort still wegzunehmen; das bewusste Zuordnen schickt den Schalter
  nicht (D1). „Austragen“ am Bereitstellungsraum und an der UHS (auch „zurückweisen“ im
  Grundriss) nimmt der Rückweg über `…/{belegung_id}/zuruecknehmen` zurück: ein Eintritt mit
  `ruecknahme_von`, den „seit“, längste Wartezeit und „wartet seit“ übergehen; nur solange der
  Austritt der jüngste Schritt ist und höchstens zehn Minuten zurückliegt, nie nach dem Ausrücken
  und nie für einen Austritt mit Anlass (D2/D3). Fahrzeug, Person und Material nehmen das Entlassen
  vollständig zurück (`…/entlassen/zuruecknehmen` mit dem Vorzustand aus der Antwort des
  Entlassens; die Person ohne neue Periode, LLH-1922; das Material samt Ort, LLH-1923); den Satz
  zu Ausgelassenem bildet `kraefte/ruecknahmeSatz.ts`.

- **Kontextmenü nur über den Baustein** (LLH-1596, Spec `datensatz-aktionsmenue`,
  `openspec/changes/archive/2026-11-08-om9oxxiq-kontextmenue-baustein/design.md`): Rechtsklick, langer Druck (550 ms,
  8 px) und Kontextmenü-Taste/Umschalt+F10 kommen aus **`components/useKontextMenue.ts`**, das Menü
  eines Datensatzes ist **`components/KontextMenue.tsx`** in der Schale `PunktankerMenue`. Die
  Einträge kommen aus derselben Quelle wie Primärknopf und ⋮-Menü (`Datensicht`:
  `datensichtKontext.ts` aus `aktion` + `weitere`), nie aus einer zweiten Liste. Außerhalb der
  `Datensicht` (LLH-1599, `openspec/changes/archive/2026-11-09-lor2qhep-kontextmenue-tabellen/design.md`) beschreibt
  die Seite die Aktionen einer Zeile EINMAL als `WeitereAktionen` und reicht sie an
  `KatalogTabelle.zeilenMenue` bzw. `useZeilenMenueKontext` (Listen, eigene Zeilen) UND an das ⋮
  (`ZeilenMenueAusloeser`); eine Knopfreihe am breiten Schirm hält ein Seitentest gleich. Eine Zeile
  mit Reglern oder Schaltern trägt die Handler nur am Namensteil. Auf Link, Bild (LLH-1598),
  Eingabefeld und markiertem Text und ohne Einträge bleibt das Browsermenü; die Taste öffnet auch auf
  dem Titel-Link. Kein eigenes `onContextMenu` (`kontextMenue.guard.test.ts`); die Lagekarte bleibt
  beim maplibre-Ereignis und teilt nur den Riegel `components/nachklickRiegel.ts`. Hörer, Riegel und
  Tasten-Nachlauf teilen sich alle Flächen, ein Hook je Karte ist also billig (LLH-1598,
  `openspec/changes/archive/2026-11-10-g11xq51l-kontextmenue-karten/design.md`). Eine Lesefläche
  ohne langen Druck setzt `langerDruck: false` (ETB, LLH-1597): Finger und Stift behalten Markieren
  und Systemmenü, Rechtsklick und Tasten öffnen weiter.
- **Karten mit eigenen Knöpfen beschreiben ihre Handlungen einmal als `KartenAktion[]`**
  (`components/kartenKontext.ts`, LLH-1598): erst die Knöpfe der Aktionszeile in ihrer Reihenfolge,
  dann die ⋮-Einträge. Knöpfe und ⋮ lesen Etikett, Sperre (`sperrgrund`), Rückfrage (`rueckfrage`,
  im Menü als Dialog) und Wirkung von dort; das Kontextmenü zeigt alle, über
  **`components/useKartenKontext.tsx`** an der Karte bzw. einen Hook je Liste, wenn die Zeilen eine
  Renderfunktion sind (Chat, Verpflegungsstellen). Sprünge und Auswahlfelder stehen nicht darin.
  Ein Zählschirm (Verpflegungsausgabe) hat bewusst kein Kontextmenü.
- **Ein Sprung ist keine Handlung** (LFH-616): gezählt werden nur ändernde Aktionen; Deeplinks
  („… ↗") stehen als eine Zeile (`data-lfh="inspector-sprung"`), rote Handlung abgesetzt.
- **Drag & Drop zieht nur mit `ZugPointerSensor`** (LFH-519, `components/zugPointerSensor.ts`):
  dnd-kits `PointerSensor` schluckt nach einem Zug jeden Klick, bis ein 50-ms-Timer läuft; unter
  Last verhungert der Timer, und der erste echte Klick geht verloren. Guard und Gegenprobe in
  `zugPointerSensor.test.tsx`, Nachweis `e2e/uhs-grundriss-menue-belegung.spec.ts`.
- **„Genau eine Primäraktion"** prüft der Kopf (`data-lfh="seitenkopf-aktionen"`), nicht global.
  **Höchstens zwei Handlungen als Knopf im Kopf einer Detailseite** (LLH-1722, Spec
  `bedien-muster`): die Primäraktion und eine zweite, ein Statusschritt vor „Bearbeiten“; alles
  Weitere (Stornieren, Bearbeiten an zweiter Stelle, Rückwege) steht im ⋮ des Kopfs. So steht der
  Kopf ab `lg` in der Zeile des Titels, statt unter ihn umzubrechen. Auflösen steht nie als Knopf im Kopf.
- **Ein Anker in der Zeile bedient den Klick allein** (Riegel `closest('a')` in `Datensicht`);
  mit `titel.ziel` erzeugt das `render` keinen Anker.
- **Der Kopf-Slot trägt, was ÖFFNET — nie, was ABSENDET**; Speichern gehört ins `<form>`.
- **Nebenwege im Kopf gehen über `weitere` der `EinsatzSeite`** (LFH-963, LLH-1786, Spec
  `einsatztauglichkeit-layout`, „Der Seitenkopf bündelt Nebenwege unter md und ab Stufe 48“):
  Drucken, CSV, Listenzugriffe und ähnliche Öffnen-Wege stehen in `kompakt` ab `md` als sekundäre
  Knöpfe, unter `md` und in den Stufen 48 / 72 in jeder Breite hinter EINEM Auslöser „Weitere“
  (`MenueAusloeser`, Name nennt die Seite; Weiche `nebenwegeImMenue`, Seiten mit eigenem Kopf
  `useNebenwegeImMenue`). e2e wählt einen Nebenweg über `e2e/nebenweg-kern.ts`. In `aktionen` bleibt nur, was am Handy sichtbar sein
  muss: Segmentleiste und genau eine Erfassung, auf Betroffenen- und Tiere-Liste dazu „Vermisst
  melden“. Nachgezogen sind Betroffene, Tiere, Schäden und die Detailseiten Lagebericht und
  Befehl (LFH-1079: Sprung und Drucken über `etb/useZumEtbEintrag.ts` und
  `components/druck/useDruckNebenwege.ts`; ein gesperrter Weg nennt den Grund im `label`).
  Die Kräfteübersicht trägt „In Lagebericht übernehmen“ als Nebenweg (LLH-1786).
  Wortlaut und Platz jedes Druckeinstiegs: `src/druck/AGENTS.md`, „Wortlaut und Platz der
  Druckeinstiege“ (LLH-1836).
  Herleitung: `openspec/changes/archive/2026-10-06-lfh-963-betroffene-tiere-handy/design.md`,
  Stufen 48 / 72: `openspec/changes/archive/2026-11-18-z137bgm5-seitenkopf-einzeilig/design.md`.
- **Eine Sektion wickelt ihren Seitenrahmen selbst** (`AdminPage` in der Sektion; Drift-Test
  `adminNav.test.tsx`). Detailseite ohne Einzel-Endpunkt, wenn die Listenform alles trägt
  (`/admin/stammdaten/{fahrzeuge,personal}/:id`), sonst Einzel-GET; Admin-Pfade in
  `admin/adminNav.tsx`.

**Inline-Bearbeitung und Status**

- **In einer Tabellenzelle schwebt die Bearbeitung** (LLH-1795, Spec `einsatztauglichkeit-layout`,
  Change `lsug0joq-tabellen-touch` D2): `KatalogTabelle` setzt `AngabeFormProvider form="schwebend"`
  (`components/angabeForm.tsx`) um den Körper, `fluss` um aufgeklappte Zeilen. Eine `InlineAngabe`
  lässt dort ihre Anzeige stehen und öffnet Eingabe, Fehler und Knöpfe in einem Popover an ihr;
  die Spalten bleiben stehen. Ein Klick daneben schließt nicht (Escape, „Abbrechen“, Speichern
  schon), je Tabelle ist höchstens eine offen (eine unveränderte schließt, eine geänderte behält den
  Fokus), der Fokus kehrt auf die Anzeige zurück. Tab aus dem Popover schließt eine unveränderte
  Bearbeitung, eine geänderte hält den Fokus (Tab im Kreis, Shift+Tab auf die Anzeige, Enter dort
  zurück). Eine offene hält die Zeilenfolge der `Datensicht` auch ohne Fokus (`onBearbeitungOffen`
  in `halten`). Karten und Ansichten bearbeiten im Fluss;
  `BemerkungZelle` liest den Kontext nicht. Nachweis `e2e/gate1-ueberlauf.spec.ts` („Bearbeiten
  ohne Sprung“).
- **Overlays in Zeilen erst bei Bedarf** (LLH-1974, Entwurf
  `docs/superpowers/specs/2026-11-19-nuokxhqs-renderkosten-tabellen-design.md`): Ein Baustein, der je
  Zeile einer Liste steht, hängt `Popover`, `Dropdown` oder `Tooltip` erst beim ersten Öffnen ein
  (`components/useErstBeiBedarf.ts`; Träger `InlineAngabe`, `StatusWahl`, `EinsatzfunktionZelle`).
  Ein geschlossener Trigger je Zeile setzt beim Einhängen Zustand im Commit und kostet beim Öffnen
  der Seite einen zweiten, synchronen Render aller Zeilen. Das Overlay richtet sich an einer
  deckungsgleichen, durchlässigen Fläche im Auslöser aus, damit Knopf und Fokus beim ersten Öffnen
  ihren Knoten behalten; wo das nicht geht (`StatusWahl`), gibt der Baustein den Fokus beim
  Schließen selbst zurück. Die `Datensicht` rendert beim ersten Anzeigen stückweise
  (`components/stueckweise.ts`, `STUECK_ZEILEN`), nicht im Druck, nicht virtualisiert und nicht bei
  hervorgehobener Zeile; in der Vitest-Suite ist das aus (`src/test/setup.ts`).
- **Ein leeres Feld muss sagen, dass man es schreiben kann** (Listenform LLH-1791, Spec
  `personal-einsatzangaben`): steht in einer Listenzelle schon ein anderer Wert (die Qualifikation
  neben der leeren Einsatzfunktion), sagt ein Stift-Knopf mit zugänglichem Namen (Etikett und
  Zeilenkennung, „Funktion zu Anna eintragen“) und dem Boden der Stufe das Schreibbare, über
  `InlineAngabe.ausloeser` (Vorbild `kraefte/EinsatzfunktionZelle.tsx`); ohne solchen Wert bleibt
  die Aufforderung als Wort. Optionale Inline-Angaben nehmen
  `components/BemerkungZelle.tsx`, nicht `Typography.Text editable` (Platzhalter `Button type="link"`, Zeilenkennung im Namen,
  Lesezweig „—", Fehler an der Zelle per `data-fehler`, Fokusrückgabe und Wertgleichheits-Riegel
  im Primitiv). Falle: antds `Editable` wertet **legacy `keyCode`** aus — Tasten per `fireEvent`
  mit `keyCode`, Mausweg (`onBlur`) eigens, Speicherfall mit `rerender`. **Pflichtangaben und
  andere Eingabearten** (Datum, Auswahl, Zahl) nehmen `components/InlineAngabe.tsx` (LFH-472):
  eigenes `<form>`, kein Speichern beim Verlassen, leere Pflicht → kein PATCH, alter Wert und
  Hinweis per `data-fehler`; Zeitpunkte über `ZeitpunktEingabe` und Gleichheit am Instant. Die
  Fokusrückgabe beider Primitive steht in `components/useFokusRueckgabe.ts`. Für die feldweise
  Bearbeitung in einer Ansicht (LLH-1103) trägt `InlineAngabe` optional `pruefe` (Grund nach dem
  Absenden als `FeldFehler`, `aria-invalid`, kein Senden; ein unveränderter Wert wird nicht
  geprüft; auch die Überlänge eines Freitexts), `gesperrt` (Grund als Text am Feld oder
  `{ beschreibungId }`, Verweis auf einen Grund an anderer Stelle; der Auslöser ist `disabled`),
  `onEntwurf` (nur die Wechsel geändert ↔ unverändert), `onOeffnen`/`onSchliessen` (Serverstand
  für einen Feld-CAS festhalten, ein offenes Feld an seinem Ort halten) und `OFFEN_LASSEN` als
  Ergebnis von `onSpeichern` (nichts gespeichert, Eingabe bleibt offen). **Kein Bedienziel im
  Wertknopf** (LLH-1426): trägt die Anzeige eigene Ziele (`tel:`/`mailto:` der Verbindungen),
  nimmt die Angabe `bearbeitenDaneben` (Anzeige als Inhalt, Knopf „Bearbeiten“ daneben wie bei
  `BearbeitbaresPaneel`); ein Ziel im Wertknopf warnt in der Entwicklung,
  `test/verschachtelteZiele.ts` prüft im Vitest. `BemerkungZelle` trägt `gesperrt` ebenso: Grund
  am Feld, ein offenes Feld behält den Entwurf und sendet nicht.
  Personendaten werden nur so geschrieben (`frontend/src/personen/AGENTS.md`).
  Einsatzdaten haben nur den Zeilenweg (LFH-1170): eine Zeile schickt ihre Angabe
  (`patcheEinsatz`); ein Vollformular gibt es nicht. Ausnahmen (LFH-1175, Spec
  `einsatzdaten-bearbeitung`): die Zeile „Koordinate“ schickt das Paar, die Zeile „Adresse“ mit
  gewähltem Treffer Adresse und Koordinate zusammen; beide stehen im Paneel „Einsatzort“, die
  Kopfleiste zeigt den Einsatzort nur an. Eine Eingabe, die einen ungültigen Entwurf selbst
  anzeigt (Koordinate), sperrt das Senden über `isValid`.
  Die Einheit-Ansicht hat ebenso nur den Zeilenweg (LLH-1036, Spec `einheit-ansicht`): eine Zeile
  schickt genau ihr Feld (`patcheEinheit`; die Soll-Stärke ihre drei, das taktische Zeichen ein
  `tz_*`-Feld über `patchEinheitZeichen`), kein Formular, keine Speichern-Leiste. Der Inhalt
  hängt an `key={einheitId}`, damit kein Grund und keine offene Zeile zur nächsten Einheit wandert.
- **Jede Ortsangabe nimmt `anzeige/Ortsfeld.tsx`** (LFH-1175, LLH-1108, Spec `ortsfeld`; Ausrollen
  auf die übrigen Felder LLH-1114): Suche nur auf Enter oder „Ort suchen“, nie beim Tippen
  (Nominatim-Regeln, ein Takt für alle); Enter im Feld sendet das umgebende Formular nicht ab. Die
  Suche wird hineingereicht (im Einsatz `sucheOrtImEinsatz`, ohne Einsatz `sucheOrtInOrg`), beide
  ohne Lagekarten-Recht. Eine getippte Koordinate erkennt das Feld selbst. Speichert das Ziel eine
  Koordinate, bekommt das Feld `karte` (Vorschau mit ziehbarer Nadel, im Einsatz Ort-Zeile mit
  `exclude` des Objekts, ohne Einsatz nur der Ortsname eines Kartenpunkts über die Ort-Vorschau der
  Organisation, LLH-1376; „Auf Karte wählen“); `quelle` im Wert sagt, ob die Koordinate am Text
  hängt (`adresse`, `koordinate`) oder auf der Karte gesetzt ist (`karte`). **Personenbezogene
  Adressen nie an den Geocoder:** `ohneSuche="personenbezogen"` (reiner Text, auch keine
  Ort-Vorschau); so „Herkunft / Adresse“ der Person. Den gespeicherten Punkt ohne Bearbeitung zeigt
  `anzeige/Kartenausschnitt.tsx`. Im Formular einer Sache im Einsatz nimmt man
  `anzeige/EinsatzOrtsfeld.tsx` (Suche im Einsatz, `karte` mit Einsatzort als Umgebung) und die
  Abbildungen aus `anzeige/ortsfeldFormular.ts` (LLH-1121): `ortFelder` (Text und Koordinate
  gehen gemeinsam hinaus, die Koordinate nur mit Text oder als Kartenpunkt; ein geleerter Text
  leert auch einen Kartenpunkt, ein Kartenpunkt ins leere Feld setzt die Koordinate als Text, beides
  in `Ortsfeld` über `nachTextaenderung`/`nachKartenpunkt`, LLH-1534), `ortsfeldAusGespeichert` (beim Bearbeiten
  steht eine gespeicherte Koordinate als `quelle: 'karte'`, auch ohne Text; eine Textkorrektur
  behält sie),
  `ortRegeln` (Pflicht und Länge am Text), `ortEingabe` (für einen POST: ohne Angabe fehlt das Feld).
  Eingebaut in Einsatzort, Schaden, Standort der Betreuungs- und Verpflegungsstelle, Sammelstelle
  des Bezirks, Standort von UHS und Bereitstellungsraum, Fundort eines Tiers und Ziel eines
  Auftrags (LLH-1114), Fundort der Personen-Aufnahme und Ort der nachgetragenen Verpflegungsausgabe
  (nur Suche, Formularwert bleibt Text; LLH-1407). **Gekoppelte Geräte erreichen weder Ortssuche
  noch Ort-Vorschau** (Routenliste in `src/geraet/mod.rs`, LLH-1483): `Ortsfeld` zeigt
  dort kein „Ort suchen“, und `useOrtVorschau` fragt nicht, so bleibt die Ort-Zeile jeder Fläche
  leer. Masken, die am Gerät laufen und ihren Wert anders zerlegen (Fundort der Aufnahme,
  nachgetragene Ausgabe), fallen zusätzlich selbst auf ein Textfeld zurück. Strg/⌘ + Enter im Ortsfeld sucht
  nicht, es gehört der Erfassungshülle („Speichern und nächste“).
- **Mengen nehmen `components/MengenFeld.tsx`** (LFH-983): Pflichtname (`beschriftung`, in der
  Zeile mit Kennung: „Menge zu Wolldecke“), ganze Zahlen ab 1, ohne Stufenknöpfe — rc-input-number
  benennt sie fest „Increase/Decrease Value“. Übrige nackte `InputNumber` sind Bestand; ein Riegel
  kommt erst nach dem Sweep.
- **Dezimalzahlen nehmen `components/DezimalFeld.tsx`, Anzeigen den Zahlenkern `anzeige/zahl.ts`**
  (LLH-1146): „1.20 km“ liest eine Einsatzkraft als 1.200. Das Feld zeigt das Komma und nimmt Komma
  wie Punkt an (Pflichtname `beschriftung`, Pflicht `stellen`, ohne Stufenknöpfe); Anzeigen
  schreiben `zahlText(wert, { stellen })` (de-DE, echtes „−“), nie `toFixed`. Koordinaten und
  Wire-/URL-Werte bleiben mit Punkt. Guard `anzeige/zahl.guard.test.ts`: `toFixed` nur an den dort
  bewerteten Stellen, kein Dezimal-`InputNumber` außerhalb des Bausteins.
- **Zeiteingabe in der Anzeigezone** (LFH-692, Spec `zeiteingabe`,
  `openspec/changes/archive/2026-10-01-lfh-692-zeiteingabe-anzeigezone/design.md`): jede Zeiteingabe nimmt
  `anzeige/ZeitpunktEingabe.tsx` (`ZeitpunktEingabe`, `ZeitraumEingabe`), nie antds `DatePicker`
  oder `TimePicker`;
  der Formularwert ist ein **Zeitpunkt** (hin `alsZeitpunkt`, zurück `alsBackendZeit`, Kern
  `anzeige/zeitEingabe.ts`), in die Wanduhr der Anzeigezone wandelt nur das Feld. Tagesgrenzen
  über `keineZukunftstage`/`tagInZone`, Uhrzeiten in Texten über die Rollen der Zeitdarstellung;
  `.local()` steht nur in `anzeige/` (Guard `anzeige/zeitEingabe.guard.test.ts`). Außerhalb eines
  Einsatzes `OrgAnzeigeProvider`. „Jetzt“ beim Erfassen: `frontend/src/offline/AGENTS.md`,
  „Schreiben ohne Netz“. Bewusst Gerätezeit: Uhr und Datenstand im Kopf. Die Suiten-Zone
  Europe/Berlin legt Vitest selbst fest (`test/suitenZone.ts`, LLH-1433), ein `TZ` der Shell
  wirkt nicht, `TZ_ERZWUNGEN` wählt bewusst eine andere. Zonentests stellen die Prozesszone per
  `test/prozessZone.ts` auf UTC — unter der Suiten-Zone wäre Anzeigezone Berlin blind. Eine
  **Uhrzeit ohne Datum** (Verpflegungsplan, LLH-1058, Spec
  `zeiteingabe`, „Uhrzeit ohne Datum“) liest nur `anzeige/uhrzeit.ts:parseUhrzeit` („0630“, „6:30“)
  und legt nur `uhrzeitAmTag` in der Anzeigezone auf einen Tag (doppelte Stunde: die erste, Lücke:
  nach vorn); die Tagesgrenzen `tagesgrenzen`. Getippte Zeitpunkte mit Feldart oder Bezug wählen
  in der doppelten Stunde über `uhrzeitenAmTag` das Mal, das in Feldrichtung dem Jetzt am
  nächsten liegt bzw. als erstes nach dem Beginn kommt (`zeitParser.ts:zeitpunktAm`, LLH-1471). Ein **Kalenderdatum ohne Uhrzeit** (Geburtsdatum,
  LLH-1103, Spec `zeiteingabe`, „Kalenderdatum ohne Uhrzeit und Zone“) ist die Ausnahme von der
  Anzeigezone: gelesen nur über `anzeige/kalenderdatum.ts:parseKalenderdatum` („TT.MM.JJJJ“,
  „T.M.JJJJ“, „TT.MM.JJ“, `YYYY-MM-DD`; zweistelliges Jahr = jüngstes nicht zukünftiges; „heute“
  als Tag der Anzeigezone vom Aufrufer), gespeichert als `YYYY-MM-DD`, gezeigt über
  `formatKalenderdatum` („TT.MM.JJJJ“, Altbestand roh); keine Schnellwahl, keine relative Eingabe.
- **Zeiteingabe ist ein Textfeld** (LLH-1070, Spec `zeiteingabe`, „Eingabe als Text“ ff.,
  `openspec/changes/archive/2026-10-17-ri685cfi-zeiteingabe-tippen-schnellwahl/design.md`): getippte
  Zeiten deutet nur `anzeige/zeitParser.ts:deuteZeit` (taktisch `1430`/`101430`/`101430okt26`,
  deutsch, ISO, relativ `-5`/`+2h`/`j`; Unlesbares wird nie übernommen und nie still korrigiert).
  Das Feld zeigt die DTG nach `anzeige/format.ts:formatDtg` (Entscheidung E1, FwDV/DV 810); **kein
  `format` am Aufruf** (Typ und Guard). Die **Feldart** setzt der Aufrufer, wo sie aus dem Feld
  folgt: `art="ereignis"` (Ereignis-, Alarm-, Eingangszeit, Zeitstand), `art="frist"` (Frist,
  Termin, Ende einer Gültigkeit), ohne Art bei Filtern und Planungszeiten. Schnellwahlen stehen nur
  in `anzeige/zeitSchnellwahl.ts`; der Kalender (antds `Calendar`, nur in `anzeige/`) ist der
  Nebenweg. Tests tippen über `test/zeitEingabe.ts` (`tippeZeit`, `setzeZeit`), nie über
  Kalenderzellen oder Format-Strings. Falle: antds `Input` baut sein Gerüst um, sobald ein Präfix
  oder Suffix kommt oder geht, und das Feld verliert mitten im Tippen den Fokus — das Suffix der
  Deutung steht deshalb immer im DOM. Wo der Hinweis neben der Eingabe keinen Platz hat (ETB-Feldzeile,
  190 px), meldet das Feld ihn per `onHinweis` und zeigt ihn nicht selbst; der Aufrufer nennt ihn
  und verweist per `aria-describedby` darauf (LLH-1917).
- **Unlesbares bleibt stehen und sperrt** (LLH-1768,
  `docs/superpowers/specs/2026-11-20-obmcvm14-stille-korrekturen-sichtbar-design.md`; löst in der
  Spec `zeiteingabe`, „Unlesbare Eingabe wird nicht übernommen“, das „wieder den geltenden Wert
  zeigen“ ab): Verlässt man ein Zeitfeld mit unlesbarem Text, bleibt der Text samt Grund stehen,
  der Formularwert bleibt der geltende. Der Grund geht an die **Eingabesperre**
  (`components/instrument/eingabeSperre.tsx`), die `Feld`, `DatenfeldEingabe` und `InlineAngabe`
  tragen: das Formular sendet nicht und nennt den Grund in der Fehlerzeile, das Feld dann nicht
  noch einmal. Escape verwirft den Text, Enter auf ihm sendet nicht. Ein Zeitfeld in einem
  Formular steht deshalb in `Feld` oder `DatenfeldEingabe`, nie in einem rohen `Form.Item`; das
  ETB sperrt selbst (`onDiscard`, LLH-1866). Liegt der geltende Wert gestern oder morgen, steht
  das am Feld, auch nach der Übernahme.
- **Zeitdarstellung** (LLH-1053, Spec `zeitdarstellung`, Entscheidungen E1–E4 aus LLH-1045): eine
  Zeit für Menschen formatiert nur `anzeige/zeitDarstellung.ts`, in drei Rollen — `zeitpunkt`
  (`101430okt26` bzw. `10.10.26 14:30`), `zeitKurz` (heute `1430`, sonst `091430` bzw. `14:30` /
  `09.10. 14:30`) und `uhrzeit` (`1430` bzw. `14:30`, nur wo der Tag aus dem Zusammenhang folgt);
  in Komponenten über `ZeitAnzeige rolle=…` oder die gebundenen Rollen aus
  `useAnzeigeKonventionen()`. Die volle DTG schreibt Monat klein ohne Umlaut und das Jahr
  zweistellig (FwDV/DV 810, Ausgabe 2018, Teil I 5.1.1.12). Die Darstellung (`taktisch`,
  Vorgabe, oder `datum_uhrzeit`) steht in den Konventionen; wirksam ist Gerät vor Einsatz vor
  Organisation vor Vorgabe (`wirksameZeitdarstellung`), die Gerätewahl liegt in
  `anzeige/zeitDarstellungStore.ts` (Profil „Darstellung auf diesem Gerät“, Sprungpalette).
  **Der Druck nimmt nie die Gerätewahl:** die Provider in `AnzeigeKonventionenContext.tsx` lassen
  sie unter `useDruckModus` weg. Kein
  `.format('…')` und kein `formatiere(…, '…')` mit `HH`/`mm`/`DD`/`YYYY` außerhalb von `anzeige/`
  (Maschinenformate ab `YYYY-MM-DD` ausgenommen); Wächter `anzeige/zeitDarstellung.guard.test.ts`,
  Schuldmenge `OFFEN` leer (seit LLH-1061). Titelvorschlag und Startinhalt eines Lagevortrags werden
  gespeichert und nehmen `konventionenOhneGeraet` (Einsatz vor Organisation, ohne Gerätewahl, wie
  Druck und Servertexte; LLH-1437); ein Eingabefeld zeigt seinen Wert taktisch. Nebenformen im Kern:
  `datum`/`kalendertag` (Tag ohne Uhrzeit, `10okt26` bzw. `10.10.26`), `uhrzeitOhneDatum`
  (Wanduhrzeit `HH:MM` ohne Tag: Verpflegungsplan, Wechselzeiten), `tagUndUhrzeit` (Anfang eines
  Zeitraums), `leereUhrzeit` (Lücke in Ziffernbreite); „heute“ einer Nebenzeit (Nachtrag, Übergabe,
  Zeitraumende) über das `jetzt` von `zeitKurz`.
- **Uhr, Dauer und Datenstand** (LLH-1750, Spec `zeitdarstellung`, Entscheidung E5,
  `openspec/changes/archive/2026-11-18-aovwhho1-zeitformate/design.md`): Die **Uhr** im Kopf, im
  Lagemonitor und im Großbild zeigt die Gerätezeit in der Rolle „Uhrzeit“ der Darstellung (`1731`
  bzw. `17:31`; `formatiereUhr` in `anzeige/zeitDarstellung.ts`, Darstellung über
  `useUhrDarstellung`). Keine Seite stellt eine zweite Uhr neben ihren Titel. Eine **Dauer** bildet
  nur `anzeige/dauer.ts`: `dauer` („45 min“, „8 h“, „5 h 01 min“, nie mit Doppelpunkt; mit `tage`
  ab 24 h „2 d 14 h“, nur für die Einsatzdauer des Einsatzes), `relativ` („vor/seit/in/noch …“,
  mit Tagen, unter einer Minute „gerade eben“ bzw. „in < 1 min“), `vorText`, `dauerZwischen`,
  `dauerAusgeschrieben` (zugänglicher Name). Kräfte-Dauern und eingestellte Längen laufen in Stunden
  weiter, weil sie neben Stunden-Grenzwerten stehen. Der Server schreibt dieselbe Form
  (`src/zeitdarstellung.rs:dauer_text`), beide lesen `anzeige/dauer.faelle.json`. Wächter
  `anzeige/dauer.guard.test.ts` (keine `${n} min`, `${h} h`, `{n} min</…>` und kein Stunden:Minuten mit `padStart` außerhalb von
  `anzeige/`; ausgeschriebene Einheiten in festen Sätzen sieht er nicht).
  Der **Datenstand** heißt überall „Stand 1731“, ohne Netz „· offline“ am Ende, in Gerätezeit
  (`components/Datenstand.tsx`, Text `datenstandText`; Alter in ganzen Minuten der Uhr); mit `alter` (Lagebild, Großbild,
  Lagemonitor, `EinsatzSeite datenstandAlter`) ab einer Minute „· vor 2 min“. Nie „Stand vor 0 s“.
- **Statuswechsel in Kräfte-Listen**: Auslöser ist die Statusanzeige, senkrechtes Menü im Portal
  (`components/StatusWahl.tsx`, `statusBedienung`), am `status`-Slot, nie am `aktion`-Slot
  (`docs/superpowers/specs/2026-07-30-kraefte-listen-statuswechsel-zielform.md`).
- **Statusfarbe: Rollenfarben als getönte Fläche, Mandantenfarben nur als Punkt** (Neuentwurf
  22.09.2026, LLH-1779): `Status` und `StatusKnopf` tönen nach der Rolle, Werte/Kontrast nur in
  `components/instrument/statusFlaeche.ts`; eine gesetzte `status_farbe` ist ein Punkt neben dem
  Wort, nie Fläche oder Rand. Der Knopfrand ist gemessen in `kraefte-kontrast.spec.ts`.
- **Statusmenü und Quittung bei Fahrzeugen** (LLH-1781, Spec `fahrzeugstatus-quittung`):
  `StatusWahl` mit `titel` = Rufname als Menükopf; das Menü misst beim Öffnen den Platz
  (`menueLage`), öffnet zur größeren Seite, begrenzt die Höhe und steht im Handschuh-Betrieb
  in zwei Spalten, wenn eine nicht passt, in drei, wenn auch zwei nicht passen. Quittung und
  Rückweg nach jedem Statuswechsel, auch bei Personal, Material und Einheit: `kraefte/AGENTS.md`,
  „Quittung und Rücknahme eines Statuswechsels“.
- **Material** (LFH-341, `materialStatus`): `im_einsatz` `bedien`, `defekt`/`verbraucht` `alarm`;
  `pages/MaterialPage.tsx` und `kraefte/MaterialAmOrt.tsx` (Material am Ort) lesen beide von dort — zwei
  Farbbehandlungen desselben Enums wären der Fehlerfall, nicht der Kompromiss. Am Ort (LLH-1133,
  Spec `material-am-ort`) ist die Statusanzeige ebenso `StatusWahl`, mit denselben Einträgen
  (`kraefte/materialPosten.ts:materialStatusWahl`) und demselben Schreibweg
  (`api/einsatzMaterial.ts:setzeMaterialStatus`), Ablehnung an der Zeile; Ad-hoc-Material nimmt an
  beiden Stellen nur `kraefte/MaterialAdhocDialog.tsx` (am Ort mit festem `ort`, ein Request).
  Rechte wie beim Zuordnen (Schreibrecht und Freigabe Material); ein beendeter Ort sperrt Zuordnen,
  Erfassen und Ausgeben, nicht Status und Lösen. Nachweis `kraefte/materialSchreibweg.test.tsx`.
  Eine selbst gelöste Zeile hält ihre Stelle als träge Marke „Gelöst“, bis Zeiger und Fokus den
  Baustein verlassen haben (LLH-1254, `components/useHoldGeloest.ts`); Rückgängig
  über `kommunikation/rueckgaengig.tsx`, nicht am beendeten Ort, Ablehnung über dem Block.
- Portal-Menüs sind kein Verlassen der `Datensicht` (`checkVerlassen`, `components/useZuflussSchleuse.ts`); in jsdom wandert der
  Fokus nicht — Handler direkt mit `relatedTarget` prüfen.
- **Ein Status gehört in den Vertrag:** jede `Record<…, StatusDarstellung>` steht in
  `theme/statusFarben.ts` (`ALLE_MAPS` in `statusFarben.test.ts`: 38 am 16.10.2026, LLH-1040 `verpflegungsstelleStatus`); jede weitere
  Karte ist eine begründete Entscheidung (Beispiele: `odlStufe` in
  `openspec/changes/archive/2026-09-21-lfh-78-fachebene-odl/design.md`, `aufbewahrungZustand` in
  `openspec/changes/archive/2026-09-29-lfh-23-retention-rest/design.md` D4,
  `schwaerzungsantragStand` in
  `openspec/changes/archive/2026-10-02-lfh-751-sofort-schwaerzung-auf-antrag/design.md` D9, `capSchwere` in
  `openspec/changes/archive/2026-10-01-lfh-662-dwd-ebene-gueltigkeit-warnstufe/design.md` D5,
  `pegelZustand` in `openspec/changes/archive/2026-10-04-lfh-881-pegelzustand-statusvertrag/design.md` D1–D2,
  `besatzungsUrteil` in `openspec/changes/archive/2026-10-06-lfh-962-farbvertrag-wort/design.md` D1). `theme/statusVertrag.guard.test.ts`: keine Karte außerhalb
  der Datei; rohes `Tag` sperrt der Lint (LLH-1779).

**Farbe und Zeichen**

- **Rot bedient nichts:** `bedien` und Fokusring blau, Rot ist Gefahr. Jede Statusfarbe braucht
  einen **zweiten Kanal** (WCAG 1.4.1). Farbwerte nur aus `theme/tokens.ts`/`theme/rollen.css`.
- **Statusrollen haben eine Bedeutung** (LLH-1778, Spec `statusrollen`): Gelb (`achtung`) heißt
  „jemand muss bald handeln“, Rot (`alarm`) „überfällig, Ausfall, Gefahr“. Ein Zustand des
  Normalbetriebs (unterwegs, eingesetzt, eingegangen, läuft planmäßig) trägt nie Gelb: „gebunden“
  ist überall `neutral` und kommt immer aus `statusKategorie`, nie fest in einer Seite; der
  Eingang „Neu“/„Offen“ ist neutral mit leiser Kante (`linieStark`), Dringliches zeigt die
  Priorität. Die ZAHL der noch nicht gesichteten Meldungen (Kennzahl „Unbearbeitet“) bleibt
  dagegen gelb: gezählt ist sie Handlungsbedarf (Entscheidung 16.11.2026). Einzige Ausnahme an der Kategorie vorbei: der Sprechwunsch (FMS 5 und 0) ist gelb;
  wer den Status EINES Fahrzeugs oder einer Einheit färbt, geht über `fahrzeugStatusRolle` bzw.
  `kategorieDarstellung` (`theme/statusFarben.ts`). Herleitung:
  `openspec/changes/archive/2026-11-16-eon26eat-farbe-entlasten/design.md` (D1–D4).
- **Der Fokusring ist `bedien`** (LFH-737): antds Umriss liest `colorPrimaryBorder`, und
  `antdToken` setzt ihn auf `bedien` (≥ 3 : 1 auf jeder deckenden Fläche,
  `theme/bedienKontrast.test.ts`, `e2e/fokusring-kontrast.spec.ts`), wie die eigenen Klassen in
  `sprache.css`. Er ist zugleich die Ruhefarbe des `Slider`; dessen Zeiger nimmt `bedienHover`.
  Flächen (`warnstufeFlaeche`/`flaechenFarbe`) sind die dritte Darstellungssorte; eine vierte wird
  in `statusFarben.ts` benannt, nicht in `pages/`.
- **Demo-Marke** (LFH-733): Demo-Stammdaten (`ist_demo`) zeigt nur `components/DemoMarke.tsx`
  (`Tag` ohne `color`, kein `StatusTag`, keine Karte in `statusFarben.ts`); Auswahllisten zum
  Disponieren gruppieren sie nur über `stammdaten/demoAuswahl.tsx` hinter die echten Einträge.
  Herleitung: `openspec/changes/archive/2026-10-01-lfh-733-demo-marke-stammdaten/design.md`.
- **Helligkeit: ein Regler, eine Sperre** (LFH-397, Kriterium 8,
  `openspec/changes/archive/2026-09-29-lfh-397-helligkeitsregler-warnsperre/design.md`): dritte Achse im
  `ThemeModeProvider` (`useHelligkeit`, Stufen 100/80/60/40/20, `lifeline-hub.helligkeit`,
  **gespiegelt in `index.html`**), wirkt nur über die Deckschicht `html::after` in `rollen.css`
  (`--lfh-abdunkelung`, `@media screen`), nie über Paletten. Bei aktiver Warnung
  (`einsatz/aktiveWarnung.ts`: Warnstufe mit Rolle `alarm`,
  `meldungen.bestaetigung_ueberfaellig` oder eine jetzt geltende DWD-Warnung mit Rolle `alarm`
  aus `dwdWarnstufe`, nur mit Freigabe `wetter-pegel` und ohne eigenen Abruf, LFH-774) gilt
  `HELLIGKEIT_BODEN_WARNUNG` (abgeleitet über
  Kriterium 5, Guard `theme/helligkeit.test.ts`); Quellen melden sich nur über `useWarnsperre`
  (heute allein `EinsatzLayout`). Die Sperre ändert nie die Wahl.
- **Der dauerdunkle Rahmen hält die Tag-Schwelle** (LFH-434): die Schwelle aus Kriterium 5
  folgt dem Umgebungslicht, nicht dem Token. Jeder Text auf Kopfleiste/Rail, auch ein
  Zustandswort, hält ≥ 7 : 1 auf dem Grund, auf dem er steht (`grund`/`feld`/`aktiv`); einzige
  Ausnahme `rahmenFarben.gesperrt` (≥ 4,5) für Gesperrtes, dann mit Zeichen ohne Farbe auf jeder
  Breite (Schloss in `AppLayout.tsx`). Jede Textfarbe im Rahmen steht in
  `theme/rahmenKontrast.test.ts` und wird dort gerechnet (der Test sieht keine Verwendung, nur
  die Liste). Gilt für jede weitere dauerdunkle Fläche.
- **Knopfreihen über `Knopfreihe`** (LLH-1973, ADR-0070): zwei oder mehr Knöpfe nebeneinander
  stehen in `Knopfreihe` mit dem festen Abstand `md` (12 / 20 / 24 px), so steht auch Rot nie
  bündig neben Neutralem; kein `<Space>`, kein eigener Abstand. Dialogfüße nehmen `fuss` (ab `md`
  rechtsbündig, darunter untereinander in voller Breite). Im `ErfassungsModal` unter `md` klebt nur der Abschluss
  (Primärknopf, Nebenaktionen, Zusammenfassung); „Abbrechen“ steht dort als Text im Schließknopf des
  Kopfs, Einstellungszeile und „Speichern und nächste“ am Formularende (LLH-1763). Primär steht im Kopf, im Paneel und in
  der Zeile vorn, im Fuß hinten; die Reihe ordnet nicht um. In Tabellenzellen und Zeilen, die ihre
  Höhe halten, `umbruch={false}`. Ein `<Space>` in `aktionen` der `EinsatzSeite` wird zum
  Fragment, denn die Kopfhülle ist selbst eine Knopfreihe; nur eine Reihe mit Druckklasse oder
  Hülle bleibt eine eigene `Knopfreihe` (Kräfte, Lagebericht). Bestand in
  `components/knopfreihe.schuld.ts` (Ratsche, `knopfreihe.guard.test.ts`). antds eigene Füße
  (Modal, `modal.confirm`, `Popconfirm`) halten dieselbe Stufe über eine Regel in `index.css` mit
  `var(--ant-padding)`. **Kein Komponenten-Token `marginXS`:** jeder antd-Knopf setzt die Variable
  mit seiner `css-var-…`-Klasse zurück, die Überschreibung kommt am Knopf nie an (gemessen 7 px).
  Nachweis `e2e/dialogfuss-dichte.spec.ts`, `e2e/dokumente.spec.ts`.
- **Destruktiv ist nicht gleich destruktiv** (LFH-363): Umkehrbares („Außer Dienst",
  „Deaktivieren", eine gelöste Zuordnung) → Abstand + `danger`, keine Rückfrage; Unumkehrbares →
  Rückfrage, `Popconfirm` mit `okButtonProps={{ danger: true }}` und benanntem `okText`. **Im
  ⋮-Menü ist nur Unumkehrbares rot** (LLH-1722, D2): ein Lösen, Entlassen oder Austragen mit
  Rückgängig steht neutral unter den umkehrbaren, `gefahr` nur für Stornieren, Auflösen und
  Ähnliches (Wächter `components/menueFarbe.guard.test.ts`). In der Zeile trennt der rote Knopf,
  im Menü der Trenner.
  **Unumkehrbares für den ganzen Einsatz steht nicht im Kopf oder Menü einer Arbeitsseite**
  (LFH-960, Spec `bedien-wortlaut`): der Einsatzabschluss steht als letzter Abschnitt auf den
  Einsatzdaten, am aktiven Einsatz nur für die Einsatzleitung. Er ist die Ausnahme von
  „Unumkehrbares → `Popconfirm`“ (LLH-1814, Spec `einsatz-abschluss`): ein Dialog
  (`pages/einsatzdaten/EinsatzAbschlussDialog.tsx`) nennt die offenen Punkte, sperrt aber nicht,
  und sein roter Knopf „Einsatz abschließen“ wird erst aktiv, wenn Einsatznummer oder Bezeichnung
  eingetippt sind (geprüft nur im Client). Binnen 24 Stunden öffnen Einsatzleitung und System-Admin
  der Einsatz-Org ihn mit Pflicht-Grund wieder (`darfEinsatzWiedereroeffnen`).
- **Ein Iconsatz** (LFH-595, Spec `iconsatz`,
  `openspec/changes/archive/2026-09-30-lfh-595-ein-ikonensatz/design.md`): Icons8
  „iOS 27 Outlined“, für aktive Zustände „iOS 27 Filled“ (`IconPaar`, heute Rail und Stern).
  Import nur über `icons/index.ts`; Register, SVG-Quellen und Stempel in `scripts/icons/`
  (`erzeuge-icons.mjs`, Abschreibprüfung gegen das Icons8-PNG `vergleiche-png.mjs`). Auswählen
  mit PNG, SVG erst nach Freigabe abrufen (Kontingent des Abos). Lücke: Ersatz aus demselben Stil,
  sonst eigene Zeichnung im 50er-Raster mit Vermerk; **nie ein zweiter Katalog**. Jedes Icon ist
  `aria-hidden`, `1em`, `currentColor`, Hülle `anticon` (antds Ausrichtung); antds eigene
  Bauteil-Icons (Auswahlpfeil, Schließkreuz, `loading`) bleiben. Taktische Zeichen, die
  Bildmarke und die Figur des Körperschemas samt Sternchen (`personen/koerperschema/`) sind
  Zeichnungen, keine Icons; Knöpfe neben ihnen tragen Icons des Satzes.
- **Ein Emoji ist kein Icon:** Guard `icons/icons.guard.test.ts` (kein Import aus
  `@ant-design/icons`/`react-icons`, Stempel, kein unbenutztes Icon, kein Emoji im Code); in
  Text-/Druckausgaben ein Kurzwort (`Pers.`/`Fzg.`/`Mtl.`). Erlaubt als Textzeichen: ⧖ und ↗
  (`aria-hidden` neben einem Wort), ✓ im Wortlaut, © in Quellenangaben.

**Personen und Sichtung** (Anlegen mit Sichtung, `AufnahmeFelder`, `SK_META`, Verortungsauftrag):
`frontend/src/personen/AGENTS.md` — gilt auch für `pages/PersonenPage.tsx`, `pages/PersonenDetailPage.tsx`
und `pages/personen/`.

**Rückwege und Fehler**

- **Erst die Umkehrbarkeit, dann der Rückgängig-Knopf** (LFH-343): eine Rückfrage fällt nur, wenn
  es einen **serverseitigen** Rückweg gibt (`POST …/vollzug` → `offen`,
  `POST …/erinnerungen/{eid}/oeffnen`, `uebergang_erlaubt` eine Stufe zurück); sonst bleibt sie.
  Toast `kommunikation/rueckgaengig.tsx` mit festem Schlüssel; nach einer Nutzeraktion ist er
  keine Alarmmeldung (EEMUA 191). Ein Rückgängig stellt den Zustand **vor** der Handlung her, nicht
  nur „wieder aktiv“; was inzwischen anders gebunden ist, lässt es aus und nennt es im
  `SeitenHinweis`, statt es still zu überschreiben (Vorbedingung `nur_wenn_frei` beim Zuordnen,
  LLH-1722). Lücken stehen bei „Beenden: Verb, Ort und Sicherung je Art“.
- **Linker Kartenrand: EINE Farbe, Gefahr gewinnt** (`alarm` vor dem Eingang in `linieStark`,
  sonst `linie`; prüfbar über `data-alarm`/`data-unbearbeitet`; der Eingang ist neutral, Spec
  `statusrollen`). „unbearbeitet" sitzt am `StatusDeskriptor`, keine
  fünfte `KommPhase`. **Eine fällige Erinnerung ist ein Wecker, keine Frist** (LLH-1911): sie
  trägt weder Kante noch Fläche, nur „fällig“ in Achtung aus `ERINNERUNG_FAELLIG`
  (`erinnerung/erinnerungZustand.ts`), im Modul wie im Überblick; ihre Gruppe heißt „Fällig“, nie
  „Überfällig“ (`ERINNERUNG_GRUPPE_LABEL`). Angesprungen trägt sie die Markierung wie jede Karte;
  das Szenario „Erinnerung“ der eingefrorenen Spec `deeplink-hervorhebung` ist damit überholt.
- **Speicherfehler an die Seite, Erfolg an den Toast** (LFH-1077): der Grund einer Ablehnung
  steht am Ort der Handlung, bis zum nächsten Absenden (mittesten): im Dialog über `speicherung`
  der Erfassungs-Hülle oder `SpeicherFehler` (Öffnen und Abbrechen räumen), am Formular oder
  Paneel als `SpeicherFehler`, an der Zeile als `ZeilenFehler` (Grund je Zeile aus
  `components/useZeilenFehler.ts`, gefüttert aus `onMutate`/`onError`, nicht aus
  `mutation.variables`: die Mutation verfolgt nur den letzten Aufruf; in einer `Datensicht` über
  `zeilenFehler`), auf der Lagekarte als Kartenhinweis (`pages/lagekarte/useKartenFehler.ts`),
  Kopfaktionen und Rückgängig aus dem Toast über `SeitenHinweise` (EIN Slot); die Anzeigen in
  `components/SpeicherHinweis.tsx`.
  - Ein Dialog schließt erst beim Erfolg; solange gespeichert wird, ist Abbrechen gesperrt (sonst
    käme die Ablehnung unsichtbar an). Prüfungen ohne Server stehen am Feld.
  - Ist der Ort nach der Antwort nicht mehr sichtbar (Zeile gewandert, Ansicht gewechselt), steht
    der Grund im Seitenhinweis; blendet nur Suche oder Filter die Zeile aus, zeigt ihn die
    `Datensicht` über der Liste. Ein Grund, dessen Ort nie wiederkommt, lässt sich schließen
    (Seiten- und Kartenhinweis). Ein Wechsel von Einsatz oder Detail-Route räumt die Gründe, und
    eine danach scheiternde Anfrage meldet nicht am neuen Ort (Einsatz bzw. Kennung in den
    `variables` mitführen und am Ort mit dem aktuellen vergleichen).
  - Kein `onError`-Toast: ein Fehler-Toast bleibt nur ohne Ort (Zwischenablage, Hintergrund) und
    steht mit Grund in `components/speicherfehler.guard.test.ts`.
- **Gescheiterter Zustandsübergang meldet sich im Dialog** (LFH-535):
  `entwurf/FreigabeDialog.tsx`, kein `modal.confirm`; `freigabeGrund`, Vorrang Speicherfehler;
  Öffnen ruft `freigebenMutation.reset()`. Test zählt `.ant-message`, offen/zu über `ant-zoom-leave`.
- **Fehlende Berechtigung wird benannt, nicht stumm weggeschaltet** (M16): `RechteHinweis` zeigt
  „Nur Ansicht · Grund“ über dem Block (Grund aus `components/nurAnsicht.ts`, wenige Wörter,
  Rollen wie in der Mitgliederverwaltung), Primäraktion gesperrt sichtbar; Zeilenaktionsspalte
  entfällt (M45); gesperrte Einzelzeilen tragen ihren Kurzgrund selbst.
- **Was der Server sicher ablehnt, steht gesperrt mit Grund** (LFH-966): Entfernen und
  Herabstufen der letzten Einsatzleitung, Deaktivieren des letzten aktiven Admins und des
  eigenen Kontos. Der Grund steht in wenigen Wörtern neben der Aktion (`aria-describedby`),
  Wortlaut in `stammdaten/rechteText.ts`. Die eigene Herabstufung ohne Systemrolle fragt nach
  (kein eigener Rückweg); der Knopf nennt die Handlung.
- Sofort-Speichern-Zeile sperrt nur sich (`ModulEinstellungsListe`: `laeuftKey`/`fehlerKey` aus
  `mutation.variables`, Fehlerzeile `data-fehler`).
- Zeilenlayouts ohne feste Spaltenbreite (Grid `minmax(0, 1fr) auto auto`, unter `md` gestapelt
  ohne Spaltenköpfe; Beschriftung über `modulZeilenStil`, `<label htmlFor>` nur an bedienbaren
  Zeilen).
- Ein Absende-Ziel erscheint nie später als seine Felder (`pages/LoginPage.animation.test.ts`).
- Dieselbe Eingabe nicht zweimal bauen: `components/OtpEingabe.tsx` (injizierte `id`
  durchreichen, `sendetRef` in der Absende-Funktion, kein `size`).

**Formularseiten**

- **Aufgeteilte Route erbt den Vollersatz-Vertrag:** `PUT …/settings` ist Vollersatz — die
  Sektionen (`…/einstellungen/{allgemein,verhalten,aufbewahrung,module}`,
  `einsatzEinstellungenPfad`) schicken über `einstellungen/einsatzEinstellungenForm.ts`
  (`zuUpdate`) immer alle Felder mit, auch `basemap_modus`, `karten_zoom_start`,
  `fachebenen_sichtbar`. Jede Sektion stellt ihre Queries selbst (kein `useOutletContext`).
  Speichern-Leiste sticky im `<form>` (`htmlType="submit"`), gebaut nur über
  `<div {...useSpeicherLeiste()}>` (`components/speicherLeiste.ts`; mit „Abbrechen“ daneben
  `useSpeicherLeiste({ hasAbbrechen: true })`, Abstand `padding`) — sie bringt den Fokusabstand
  mit (LFH-475, `scroll-padding` über `:root:has(...)` in `index.css`, Nachweis
  `e2e/fokus-verdeckung.spec.ts`); `speicherLeisteStil`/`feldrasterStil` rein, die Breite liest
  der Aufrufer aus `useViewport`.
- **Eine Speichern-Leiste je Seite, und sie speichert jedes Feld der Seite** (LFH-979, Spec
  `formularseiten`): kein zweites `<Form>` mit eigenem Knopf daneben; ein PATCH schickt nur die
  geänderten Felder, der Toast nennt genau sie. Sofort wirkende Wege (Logo, Modulzeilen) sind
  keine Felder. **Gilt für Formularseiten** (Einstellungen, Stammdaten-Detail); in einer Ansicht
  gilt stattdessen „höchstens eine offene Bearbeitung je Seite“ (LLH-1139, „Bearbeiten in der
  Ansicht“ unter der UI-Form-Leitlinie): ein Paneel mit eigenem Fuß ist dort kein zweiter
  Speicherweg.
- **Ungespeichertes ist sichtbar** (LLH-1829, Design-Doc
  `docs/superpowers/specs/2026-11-19-l1flywem-speichermodelle-kennzeichnen-design.md`): ein Feld,
  das vom geladenen bzw. zuletzt gespeicherten Stand abweicht, trägt am Etikett einen Punkt „•“
  (`GeaendertPunkt` in `Feld` und `DatenfeldEingabe`, für Vorleser „(geändert)“), gerechnet von
  `components/aenderungsstand.tsx` (`AenderungsstandProvider` INNERHALB des `<Form>`, nie
  `isFieldsTouched`; nach Erfolg `merke(gesendet)` über `useAenderungsstandMerken`). „Speichern“
  steht nur als `components/SpeicherKnopf.tsx`: ohne Änderung gesperrt, daneben „Keine
  Änderungen“ bzw. „N Änderungen“; wer das `<Form>` sperrt, reicht `disabled` mit. Enter ohne
  Änderung schließt eine Bearbeitung (`EnterOhneAenderung`). Wächter
  `components/speicherKnopf.guard.test.ts`: jede Datei mit `useSpeicherLeiste` nutzt beides. Eine
  offene `InlineAngabe` zeigt ab der ersten Änderung „Nicht gespeichert“ mit Achtungskante (ohne
  Tastenerklärung, „Text erklärt nie die Bedienung“); ein Klick daneben schließt sie nur
  unverändert (still).
- **Formularseiten mit Leiste tragen den Verlassen-Schutz:** Merker
  `components/useFormularVerlassenSchutz.ts` (eigener Zähler, nicht `isFieldsTouched`;
  `onValuesChange` → `geaendert`, `fassung()` beim Absenden, `gespeichert(fassung)` nur bei
  Erfolg; `aktiv` = Schreibrecht, `schluessel` = Datensatz-ID bei `key={id}`; im Bearbeiten-Modus
  einer Detailseite `aktiv` = Sitzung offen, `schluessel` nur bei offener Sitzung, LLH-1101) plus
  `<VerlassenRueckfrage>` (`components/VerlassenRueckfrage.tsx`, `useBlocker` bei Pfadwechsel,
  „Bleiben“/„Verwerfen“). Seiten, die jede Zeile sofort speichern (`EinsatzModule`), nicht. Tests
  jeder Seite mit `VerlassenRueckfrage`, auch über den Merker unten, rendern mit
  `renderMitProviders(…, { datenRouter: true })` — `useBlocker` wirft ohne Data Router.
- **Ein offenes, geändertes Einzelfeld in einer Ansicht trägt denselben Schutz** (LLH-1103, Spec
  `formularseiten`, „Rückfrage vor dem Verlassen“): über den Merker
  `components/offeneBearbeitung.tsx` (`OffeneBearbeitungProvider` speist
  `useFormularVerlassenSchutz` und rendert `VerlassenRueckfrage`; ein Feld meldet sich mit
  `useOffeneBearbeitung(etikett)` über `onEntwurf` an, eine `InlineAngabe` ohne eigenes
  `onEntwurf` selbst, LLH-1468). Höchstens ein Entwurf je Seite: die übrigen Felder sind gesperrt
  mit „Erst „Name“ speichern oder abbrechen“, der Grund steht an EINER Stelle. Wer selbst anmeldet,
  zeigt ihn selbst (`useOffeneBearbeitungGrund`; wo er steht, sagt die Bereichsdatei, für
  Personendaten `frontend/src/personen/AGENTS.md`). Eine Listenseite stellt dafür
  `<OffeneBearbeitungGrundZeile />` in die Werkzeugzeile ihrer `Datensicht` (`werkzeuge`,
  LLH-1480): solange sie steht, sperren sich die selbst angemeldeten Inline-Angaben und die
  `BemerkungZelle`n der Seite mit Verweis darauf (`aria-describedby`); ohne sie sperren sie nicht.
  Ein eigenes `gesperrt` (ohne Netz) geht vor. Ein offenes Feld ohne Änderung meldet sich nicht an.
  **Ein Wechsel in der Seite, der die offene Bearbeitung aushängt** (Segmentleiste oder Reiter ohne
  Pfadwechsel), geht über `useWechselNachRueckfrage` desselben Merkers: mit Änderung
  dieselbe Rückfrage (`VerlassenDialog`), ohne still; der Provider umfasst dafür auch die Leiste
  (LLH-1415, Vorbild `pages/VerpflegungPage.tsx`; ebenso Fahrzeuge, Liste ↔ Tableau, LLH-1468). Ein
  Wechsel, der sie stehen lässt, fragt nicht (Gruppierung der Materialliste: die Zeile behält ihren
  Schlüssel).
- Ein Collapse-Kopf im Formular ist kein Übermittlungsknopf (`MaterialFormModal.test.tsx`).
- **Direkteinstieg** (LFH-347, `components/Direkteinstieg.tsx`,
  `components/EinstiegSwitcher.tsx`, `components/direkteinstiegKern.ts`; Tabelle unter `…/liste`;
  Schlüssel `<praefix>:letzteAuswahl:<einsatzId>` ist gepinnt). **Ein reiner Kern bekommt ein Suffix** (`…Kern.ts`): gleicher Basename
  wie die `.tsx` kollidiert case-insensitiv, Vite löst `.ts` vor `.tsx` auf („Element type is
  invalid").
- Stärke EINMAL summieren (`anzeige/staerke.ts:summiereStaerke`, `null` bei leerer Menge); je
  Abschnitt nur `pages/einsatzabschnitte/abschnittStaerke.ts` (wer im Abschnitt steht, LLH-1744).
  „Abschnitt anlegen" ist eine Erfassung mit drei Feldern (`ErfassungsModal`), den Datensatz gibt
  es erst nach dem Absenden; das Detail bearbeitet jede Angabe einzeln (`patcheAbschnitt`, ein
  Feld je PATCH, Spec `einsatzabschnitt-bearbeitung`, LFH-1208,
  `openspec/changes/archive/2026-10-11-lfh-1208-abschnitt-bearbeiten-in-ansicht/design.md`).

**Entwürfe** (Verlustschutz, Navigationsschutz, „Entwurf speichern“, gegliederte Dokumente über
`entwurf/DokumentEntwurf`): `frontend/src/entwurf/AGENTS.md` — gilt auch für `lageberichte/`,
`pages/BefehlDetailPage.tsx` und `pages/LageberichtDetailPage.tsx`.

**Layout und Live**

- **Eine Höhenkette endet nicht am Layout** (LFH-343, H51): `AppLayout`/`EinsatzLayout` wachsen
  mit; Scrollbereiche begrenzen die Seite selbst in `dvh` (`pages/ChatPage.tsx`: Messung per
  Callback-Ref, `ant-row` mit `flexWrap: 'nowrap'`); geprüft mit
  `toBeInViewport()`, nie `toBeVisible()`.
- Stick-to-bottom hängt an der jüngsten id, nicht an der Länge.
- **Live-Updates springen nicht unter dem Cursor:** Sammelbanner statt Einschieben (CLS ≤ 0,1,
  WCAG 3.2.5); Alarmbudget EEMUA 191/ISA-18.2: 1–2 je 10 min, ≤ 3 Stufen. **Kein Blinken auf
  lesbarem Text.** Einzige Ausnahme ist die Alarmzone (LLH-1735, Entscheidung Ruben 15.11.2026):
  ein Alarm schiebt den Inhalt um seine Zeile, statt ihn zu verdecken; CLS-Messungen laufen ohne
  anstehenden Alarm. Zweite Ausnahme ist der Präsenzhinweis (LLH-1946, Entscheidung Ruben
  19.11.2026): er ersetzt die Vermerkzeile, und nur an einer Angabe ohne Vermerk kommt eine Zeile
  dazu.
- **Ein Eingang ist Information, kein Alarm** (LLH-1062, LLH-1143, Spec `benachrichtigungen`,
  „Eingangshinweis“): alle Eingänge eines Einsatzes (Stufe `hinweis`) stehen gebündelt im
  Eingangsband **unten** (`alarm/Eingangsband.tsx`, `alarm/useEingangshinweis.tsx`), nie in der
  Alarmzone: die trägt nur Alarme, Org-Hinweise und Unwetter. Am Handschirm teilen sich Alarme
  und Eingänge eine Leiste von 48 px, die bei Fokus in einem Eingabefeld einklappt, außer ein
  Alarm steht an (LLH-1738). ✕ blendet aus, ohne zu quittieren. Der dezente Ton höchstens 1 je 2 min, kein neuer Eintrag
  während einer Eingabe (erst beim Verlassen des Feldes), keiner auf der Seite, deren
  Sammelbanner ihn trägt. Kein eigener Zeitgeber. e2e-Greifer: `[data-lfh="eingangsband"]`.
- **Eine Zahl für Eingänge** (LLH-1143, Spec `benachrichtigungen`, „Ungelesene Eingänge im
  Tab-Titel“): Knopf „Eingänge“ (`alarm/EingaengeKnopf.tsx`, Zelle `kopf-alarm`), Tab-Titel und
  App-Badge und die Leiste am Handschirm (`alarm/HandyLeiste.tsx`, LLH-1738) lesen denselben
  Verlauf (`alarm/useBenachrichtigungVerlauf.ts`, ein Key, ein Abruf);
  abgeglichen wird er nur im Knopf (`useVerlaufAbgleich`). Keine zweite Zahl daneben. Die Zahl
  steht als Plakette über dem Zeichen (`alarm/EingaengeZahl.tsx`, nimmt keine Breite). Bündelt
  der Kopf die Alarmzentrale (`useKopfBuendelt`, Handschirm und Tablet mit Finger), trägt deren
  Ziel Zahl und Eintrag „Eingänge“, kein eigener Knopf: der Kopf hat dort keine 48 px übrig.
  Ab `lg` gibt die Suche die Breite des Knopfs her (Raster aus Name und Suche, `kopfRasterSpalten`).

## Frontend — Keine Arbeitsplatzachse (LFH-456)

Neben Form (LFH-19) und Kontext (LFH-327) gibt es **keine dritte Bedienachse „Arbeitsplatz“**
(Entscheidung 29.09.2026, `openspec/changes/archive/2026-09-29-lfh-456-keine-arbeitsplatzachse/design.md`,
Spec `bedien-arbeitsplatz`).

- **Einstieg statt Achse:** Eine Fläche für einen Arbeitsplatz ist ein Einzelfall. Sie wird
  über einen Einstieg in einer bestehenden Fläche erreicht (Primäraktion im Seitenkopf,
  Sprungmarke, Leeraktion eines Paneels, Sprungpalette) und hat eine Adresse, die als Lesezeichen
  taugt. Was je Standort verschieden ist, trägt die Kontext-Achse **am Gerät**; „Fükw-Arbeitsplatz“
  in `theme/dichte.ts` meint das Gerät. Keine Wahl einer „Arbeitsweise“, keine Vorbelegung
  von Startziel, Primäraktion, Modulreihenfolge oder Dichte je Person; `standard_modul` gilt für
  den ganzen Einsatz. Je Person liegen nur das Palettengedächtnis „Zuletzt“,
  der ETB-Standard-Rufname (`benutzer_einstellungen::BEKANNTE_SCHLUESSEL`, geschlossener
  Schlüsselraum; der Rufname ist ein Wert, keine Arbeitsweise) und der **Gelesen-Stand** der
  Benachrichtigungen (Server, `benachrichtigung.quittiert_at`, LLH-1143: ein Zustand, keine
  Arbeitsweise; er wandert mit der Person auf jedes Gerät).
- **Nicht zuständig für Rechte:** Sichtbarkeit und Schreibrecht kommen allein aus `EinsatzRolle`,
  Systemrolle und Modulfreigabe (`einsatz/schreibrecht.ts`, `berechtigung::erlaubte_module`). Ein
  Einstieg prüft die Modulfreigabe seines Ziels (`istSprungGesperrt`, gesperrt sichtbar: Knopf
  `disabled` mit `title={KEINE_BERECHTIGUNG}`, Link und Kennzahl-Ziel entfallen). Der Rahmen fängt
  jede Route in ein gesperrtes Modul ab (`ModulGesperrt`, LFH-888,
  `openspec/changes/archive/2026-10-04-lfh-888-modulwaechter-gesperrte-sprungziele/design.md`) und wartet
  beim Kaltstart auf die Freigaben; die Zielseite prüft weiter ihren Datensatz. Verweise in
  Datenzeilen bleiben offen, für sie gilt der Rahmen. Fernmeldewesen und Informationstelefon
  ebenso (LLH-1180, i6k6mzed).
- **Aufnahme** (`personenAufnahmePfad`): Einstiege sind die UHS-Kopfzeile „Patient aufnehmen“
  (LFH-341/C6, nur `aktiv` und mit Schreibrecht) und die Leeraktion des Sichtungspaneels. Die
  Palette führt „Person erfassen“ auf Liste + Modal und **keinen** Aufnahme-Befehl.
- **Wiedervorlage** einer wählbaren Arbeitsweise nur mit Feldbefund (Personenwechsel zwischen
  Arbeitsplätzen auf einem geteilten Gerät, dem Lesezeichen und Einstiege nicht genügen) oder bei
  einem dritten Einstieg in dieselbe Fläche. Transport hat keine eigene Fläche (Lücke, kein Anlass).

## Frontend — Erfassungs-Norm (LFH-332/B4)

**Erfassungsformulare nehmen `components/Erfassung.tsx`** (`ErfassungsModal`,
`ErfassungsFormular`); ein handgebautes `<Modal>` + `<Form>` ist ein Fehler.

**Zwei Muster, ein Verb, ein Enter-Vertrag, ein Pflichtfehler** (LLH-1766, Entwurf
`docs/superpowers/specs/2026-11-20-bn81riye-erfassung-verb-enter-design.md`; schreibt die Spec
`bedien-muster`, „Einen Datensatz anlegen“, fort):

- **Zwei Muster.** **Zeile**: Serienerfassung neben einer Liste oder Zeitachse, bleibt nach dem
  Senden offen, leert, Fokus ins erste Feld (`Schnellerfassungszeile`, `SchnellAnlegen`; aufgeklappt
  als `ErfassungsFormular` im Klappteil über der Liste: Meldungen, Nachforderungen, Erinnerungen,
  Zusage). **Dialog**: jede andere Erfassung (`ErfassungsModal`, `AnlegenModal`), schließt nach
  dem Senden, mit `serie` „Speichern und nächste“. Die eigene Seite bleibt die Ausnahme ab Ablauf
  oder > ~5 Pflichtfeldern und folgt dem Vertrag des Dialogs. Die Felder eines aufgeklappten
  Formulars folgen den Feldzeilen des Dialogs.
- **Ein Sendeverb.** „Erfassen“ (ohne Objekt; Titel, Zeile oder Klappkopf nennen es) auf jeder
  Erfassung eines Einsatz-Datensatzes; die ETB-Formen „Erfassen als HHMM“ und „Berichtigung
  erfassen“ sind dasselbe Verb. „Anlegen“ beim Neuanlegen von Struktur und Verwaltung (Einsatz,
  Abschnitt, UHS, Bereitstellungsraum, Kanal, Benutzer, Stammdaten, Kataloge, Planung,
  Schichtplan, Einstellungen); ein Dialog für Anlegen und Bearbeiten heißt nach Modus „Anlegen“
  bzw. „Speichern“. Fachhandlungen behalten ihr Verb, weil der Knopf ihre Folge nennt (Auftrag
  erteilen, Entlassen, Disponieren, Registrieren, Senden im Chat …). Im Grenzfall „Erfassen“, wenn
  der Datensatz zum Einsatzgeschehen gehört, „Anlegen“, wenn er Rahmen für andere ist. Wächter
  `components/erfassungsVerb.guard.test.ts` (Liste der erlaubten Verben; ein neues braucht dort
  einen Eintrag mit Grund).
- **Ein Enter-Vertrag nach Feldart** (`components/enterVertrag.ts`): einzeilig sendet Enter auf
  jeder Zeigerart (`enterKeyHint="send"` an den Feldern der Zeilen); mehrzeilig im Dialog bricht
  Enter um; mehrzeilig in der Zeile sendet Enter nur mit feinem Zeiger, mit grobem bricht es um;
  Strg/⌘+Enter sendet überall (ohne `serie` über die Tastaturaktion `speichern`, mit `serie`
  „Speichern und nächste“), Umschalt+Enter nie. Enter bei offener Vorschlagsliste wählt nur aus.
  Die ETB-Leiste verschärft die Zeile (`frontend/src/etb/AGENTS.md`).
- **Ein Pflichtfehler „‹Feld› fehlt“**: jede Pflichtregel über `pflicht('‹Feld›')` aus
  `components/pflichtRegel.ts` (Hauptwort des Labels, ohne Artikel, „Bitte“ und Anrede; Hinweis
  als `zusatz`: „Anzahl fehlt — 0, wenn niemand“). Der `ConfigProvider` setzt denselben Text als
  Rückfall (`validateMessages.required`); antd nimmt dafür nur ein Text-Label, deshalb immer der
  ausdrückliche Name. Wächter `components/pflichtRegel.guard.test.ts`.

- **Absende-Knopf im `<form>`, deshalb sendet Enter** (native Übermittlung; `Input.TextArea`
  behält den Zeilenumbruch). Fußzeile selbst gerendert (`footer={null}`), kein
  `onOk={() => form.submit()}`.
- **Ein `Select` schluckt Enter** (`BaseSelect/index.js:246`) — bei Select-Masken die Struktur
  prüfen: kein `.ant-modal-footer` **und** `knopf.closest('form')` ≠ `null`
  (`components/Erfassung.test.tsx`).
- **Fokus im ersten Feld** beim Öffnen und nach jedem Serien-Speichern (`requestAnimationFrame`).
- **Scheitert die Prüfung, rollt die Hülle zum ersten fehlerhaften Feld** (Mitte, mit Fokus, nach
  `onPruefungGescheitert` und dem Commit, damit ein aufgehender Klappteil schon steht) **und nennt
  die Fehlertexte über dem Knopf** (`data-lfh="erfassung-pruefung"`, Alarmfarbe, `aria-live`, am
  Primärknopf `aria-describedby`); die Zeile folgt den Feldern und geht auf jedem Weg hinaus
  (LLH-1759). Ein Formular baut das nicht selbst nach.
- **Der Fuß klebt am unteren Rand**, solange die Maske höher ist als der Schirm: im Dialog
  (`fussKlebt="dialog"`, setzt `ErfassungsModal`, LLH-1274) und auf einer Seite mit langer Maske
  (`fussKlebt="seite"`: Aufnahme, Meldung erfassen; LLH-1761). Steht der Fokus im Formular, rückt
  er über die Bildschirmtastatur (`components/tastaturVersatz.ts`, VisualViewport; kein
  `interactive-widget` im Viewport-Meta). Kurze Formulare in Paneelen kleben nicht. Entwurf:
  `docs/superpowers/specs/2026-11-20-j45fvu8l-handy-hauptaktion-kleben-design.md`.
- **Am Handy klebt im Dialog nur der Abschluss** (LLH-1763, Entwurf
  `docs/superpowers/specs/2026-11-20-zpnrt6qz-handy-dialog-fuss-design.md`): unter `md` trägt das
  `ErfassungsModal` „Abbrechen“ statt des Kreuzes im Kopf (derselbe Schließweg, dieselbe Sperre),
  klebend nur Primärknopf, Nebenaktionen und Zusammenfassung; „Werte behalten“ und „Speichern und
  nächste“ stehen nicht klebend am Formularende (`data-lfh="erfassung-serie"`). Auf der Seite
  (`fussKlebt="seite"`) ebenso, nur bleibt „Abbrechen“ im klebenden Fuß (LLH-1761). Ein Abschluss mit
  Wirkung im Einsatz („RTW nötig“) ist Nebenaktion, nie Serienteil.
- **Zurückgesetzt wird auf JEDEM Weg hinaus** (Erfassen, Abbrechen, Kreuz, Escape); der
  Aufrufer ruft kein `resetFields()`; Vorbelegen zum Bearbeiten (`setFieldsValue`) ist kein Reset. **`destroyOnHidden` setzt rc-field-form nicht zurück.**
- **Geänderte Eingaben gehen nie ohne Rückfrage verloren** (LLH-1755, Design-Doc
  `docs/superpowers/specs/2026-11-20-t103cygu-dialoge-schuetzen-eingaben-design.md`): die Maske
  schließt nie; mit geänderten Feldern fragt jeder Weg hinaus erst „Eingaben verwerfen?“
  (`VerwerfenDialog`, „Weiter bearbeiten“ hat den Fokus). „Geändert“ heißt: angefasst
  (`onValuesChange`, nie `setFieldsValue`) und anders als `initialValues`. Ein Dialog um ein
  eigenes `ErfassungsFormular` (Aufträge) leitet Kreuz und Escape über `steuerungRef` und
  `keyboard={false}`; ohne eigenen Abbrechen-Knopf über `ohneAbbrechenKnopf`.
- **Handgebaute Dialoge mit Eingabe** (LLH-2010, Design-Doc
  `docs/superpowers/specs/2026-11-20-e127jfu7-formulardialoge-schuetzen-design.md`): ein eigenes
  `<Modal>` mit gesteuerten Feldern, das kein Formular ist (Bestätigung mit Grund, Einfelddialog,
  Postenliste), nimmt `useVerwerfenSchutz` (`components/VerlassenRueckfrage.tsx`): `modalProps`
  ins `<Modal>`, `rueckfrage` daneben, „geändert“ heißt anders als beim Öffnen. Ein reiner
  Auswahldialog sperrt nur die Maske (`mask={{ closable: false }}`,
  `wrapProps={MASKE_HAELT_FOKUS}`). Wächter: `components/dialogEingabe.guard.test.ts`.
- **`onErfassen` lehnt bei Ablehnung ab** (`mutateAsync`); die Felder bleiben stehen.
- **Zahlenfelder prüfen statt kappen** (LLH-1768): kein `InputNumber` trägt `min`, `max` oder
  `precision` (antd setzt den getippten Wert beim Verlassen still um: Alter 250 → 120, 2,5 → 3;
  Wächter `components/zahlfeld.guard.test.ts`). Grenzen nimmt `components/ZahlFeld.tsx`
  (`min`, `max`, `ganz`, `einheit`), Mengen `MengenFeld`, Dezimalzahlen `DezimalFeld` (`stellen`
  prüft, rundet nicht); sie melden den Grund über `useZahlEingabe` an die Eingabesperre, das
  Formular sendet dann nicht. Ohne Sperrstelle darüber (kein `Feld`, keine `InlineAngabe`) geht
  ein abgelehnter Wert nicht hinaus und bleibt im Feld stehen; ein Dialog ohne Formular, der
  sendet, stellt selbst eine `SperrStelle` und sperrt seinen Knopf (`useSperrSammler`). Eine Regel am `Feld` ist `zahlRegel` (`components/zahlRegel.ts`).
  Geprüft wird nur, was die Person ändert: ein gespeicherter Altwert sperrt nicht.
- **Eine Frist ist beim Anlegen mit „jetzt + 30 min“ vorbelegt** (`VORGABE_FRIST_MINUTEN`,
  `anzeige/zeitSchnellwahl.ts`; Erinnerung, Wiedervorlage), nie mit „jetzt“.
- **Serienmodus** (`serie`): „Speichern und nächste" hält offen, leert, zählt, fokussiert, ruft
  `form.submit()` von Hand; die Serien-Marke wird in `onFinish` verbraucht **und in
  `onFinishFailed` gelöscht**. **Strg/⌘ + Enter** löst es aus (nur bei `serie`); Riegel
  `sendetRef` in `abschicken`.
- **„Werte behalten"** (`uebernahme`) ist eine Einstellung: eigene Zeile über den Knöpfen,
  **Vorgabe AUS** — in `components/Erfassung.tsx` **und** `pages/EtbPage.tsx` (`useState(false)`).
  Im ETB übernimmt er Von, An, Meldeweg **und den Eintragstyp** (LLH-1112); aus beginnt der
  Folgeentwurf als „Meldung“, ein neuer Reiter über „+“ immer. Nie übernommen: Ereigniszeit,
  Veranlassung, Dateien.
- **Der Tastaturvertrag steht am Knopf, nie im Text** (LFH-1078): Tastenkappe ↵ an „Erfassen“
  nur bei feinem Zeiger und ab `lg`, Kürzel in `aria-keyshortcuts`; keine Hinweiszeile, kein Kürzel im
  Platzhalter (`etb/Schnellerfassung.tsx`).
- **Ein Freitext, für den es Stammdaten oder Einsatzdaten gibt, nimmt `components/StammdatenFeld.tsx`**
  (LLH-1144, Spec `stammdaten-feld`); Freitext bleibt erlaubt und als „frei“ erkennbar (Wort, keine
  Farbe allein), ein gewählter Wert trägt seine Herkunft. Quellen sind Adapter in
  `stammdaten/vorschlagsquellen.ts` (Gruppen „Im Einsatz“, „Stammdaten“, „Zuletzt verwendet“, Demo
  dahinter); eine neue Quelle ändert das Feld nicht. Wertform `{ text, ref? }`, `nurText` wo nur Text
  gespeichert wird. **Der oberste passende Vorschlag ist markiert; Enter und Tab nehmen ihn**, Tab
  springt danach weiter (kein `preventDefault`, rc-select bekommt Tab und Enter der offenen Liste
  nicht). Freitext trotz Treffer über den letzten Eintrag „„…“ als Freitext übernehmen“; passt
  nichts, ist er beim Tippen der einzige (Change `kwc2yszv-etb-neuentwurf`, D5). **Enter bei
  offener Liste sendet nie**, bei geschlossener gilt die Norm oben (`enterSendet`); wer per Enter
  absendet, nimmt `onUebernahme` mit `ausListe: false`. „In Stammdaten übernehmen“
  nur über einen bestehenden Katalog mit reiner Textanlage (heute „Externe Stellen“), ohne
  Stammdaten-Recht gesperrt mit Grund; nicht in der ETB-Leiste. Eingebaut: ETB Von/An (Feldzeile und
  Rufname-Abfrage), Meldung Absender/Empfänger. Ein genau getippter Vorschlag steht zuoberst; ohne
  Tippen oder Pfeilmarkierung nehmen Enter und Tab keinen Vorschlag. **Dieselbe Tastaturregel gilt
  für Felder mit mehreren Werten** (LLH-1753): `fuehrung/VorschlagsSelect.tsx` trägt sie für
  Auftragsempfänger, Verteiler (`EmpfaengerWahl`), Erinnerung und Führungsstelle
  (`EinWertAuswahl`); nie `mode="tags"`, das den Tipptext vor die Treffer stellt und markiert. Nach
  der Wahl schließt die Liste; Verlassen nimmt nichts, ein Ein-Wert-Feld den Tipptext nur, wenn
  kein Treffer passt.
- **Ein-/Zweifeld-Kataloge nehmen `components/SchnellAnlegen.tsx`** (bewusst kein `<Form>`).
- **Feldbudget** (LFH-19): Modal ≤ ~3, Schnellerfassung ≤ ~4 sichtbare Felder, Rest eingeklappt.
  Zählen nur mit `forceRender`, immer mit Gegenprobe „Aufklappen → Zahl steigt". Ausnahme
  „Neuen Einsatz anlegen“ (LFH-1175, Entscheidung 11.10.2026; LLH-1816, Entscheidung
  19.11.2026): sechs Felder. Zuerst die Einsatz-Vorlage, weil sie das Menü des ganzen Einsatzes
  bestimmt und das Stichwort sie einstellt (Modulzahl darunter, Vorgabe „Alle Module“); das letzte
  ist der optionale Einsatzort; ein siebtes gehört in die Kopfdaten. Darunter der eingeklappte
  Teil „Mitglieder“ (LLH-1820, `pages/MitgliederKlappteil.tsx`): zählt nicht zu den sechs, sein
  Kopf nennt die Wahl („nur Einsatzleitung“, „Einsatzleitung + 2 Personen“), die Auswahl lädt erst beim
  Aufklappen; eine Ablehnung des Servers nennt die Person in der Fehlerzeile des Dialogs. Ausnahme
  „Lagemeldung erfassen“ (LLH-1921, Entscheidung 17.11.2026, Change
  `asthqrqj-anlegen-vereinheitlichen`, design.md D4): vier Felder untereinander, weil die
  Empfängerfunktion bestimmt, wer „Neue Meldung“ bekommt.
- **Ein Pflichtfeld gehört nie hinter den Collapse**; Felder, die eine Ablehnung auslösen können,
  bleiben sichtbar (Auftrag: Empfänger als `fuehrung/EmpfaengerWahl.tsx`, Präfix `abschnitt:<id>`/
  `einheit:<id>`). Einzige Ausnahme: ein Klappteil, der bei einem Prüffehler darin selbst aufgeht
  (`onPruefungGescheitert` der Hülle) und dessen Kopf jede Abweichung von der Vorgabe nennt
  (LFH-974, `meldungen/MeldungFormular.tsx`).
- **Freitext nie länger als der Server erlaubt** (LFH-937, Spec `eingabegrenzen`): Grenzen nur aus
  `api/eingabegrenzen.ts` (Spiegeltest `tests/eingabegrenzen_spiegel.rs`). Mehrzeilige Felder
  (TextArea, Markdown) tragen den Zähler `count={zeichenGrenze(max)}` aus
  `components/zeichenGrenze.tsx`; natives `maxLength` nur bei kurzen einzeiligen Feldern ohne
  antd-Zähler. Der Zähler erscheint erst ab 80 % (Höhenbudget der ETB-Leiste), Überlänge in
  `alarmText` und als Wort („zu lang“). **Es wird nie gekürzt**, auch kein vorbelegter oder
  eingefügter Text: Überlänge bleibt stehen und sperrt das Senden — im Formular über
  `zeichenRegel` (Pflicht an jedem Feld mit `zeichenGrenze`), außerhalb eines Formulars über
  `istZuLang` am Sende-Knopf. Die Schnellerfassung prüft die Länge **vor** Upload und Queue
  (`laengenVerstoss`): ein zu langer Baustein wird nie eingereiht.
- Dichte kommt vom `ConfigProvider`. `test/utils.tsx` rendert ein **nacktes** `ConfigProvider`
  ohne Theme — Höhen-/Trefferflächen-Aussagen im Vitest belegen nichts.

## Frontend — Druck (LFH-71/LFH-22)

**Gedruckt wird über den Browser, nie auf dem Server**; kein `window.print()` direkt, Druckknöpfe
sind `DruckKnopf`. Regeln: `frontend/src/druck/AGENTS.md` (gilt für jede Seite mit Druckwurzel).

## Frontend — Deeplink-Muster (Route vs. Query-Param)

Quelle der Wahrheit: `frontend/src/routing/deeplinks.ts` — keine Template-Literals für
Einsatz-Pfade (`docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md`).

- **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` bei Vollseiten-Detail (uhs, br, lagebericht,
  befehl, person, tier, schaden, einheiten, personal), sonst **Query-Param** `?<modul>=<id>`
  (`?fahrzeug=`, `?abschnitt=`, `?meldung=`, `?auftrag=`, `?erinnerung=`, `?gefahrengebiet=`, ETB
  `?eintrag=`);
  `?neu=1` fokussiert die Schnellerfassung. Stabile DB-`id`; `parseRouteId`.
- **Ein Objekt, das es nicht (mehr) gibt** (LLH-1827, Spec `seiten-zustaende`, Change
  `a12ms7g9-seitenzustaende` D4/D5), eine Form je Weg:
  - **Detailseite** im Einsatzrahmen, in einer Zeile entschieden: `istNichtGefunden(error)` (nur
    `ApiError` 404) oder eine ungültige Kennung (`parseRouteId` → `null`) zeigt
    `SeitenNichtGefunden` (`components/SeitenZustand.tsx`): „<Sache> gibt es nicht (mehr)“ in der
    Grammatik der Sache, genau ein Knopf zur Liste aus `routing/deeplinks.ts`, kein „Erneut
    abrufen“, keine Servermeldung, die Adresse bleibt (kein stilles `Navigate`), der Rahmen merkt
    sie nicht als letzten Ort. Jeder andere Fehler bleibt `SeitenFehler` mit „Erneut abrufen“.
  - **Query-Param-Deeplink** über `useQueryParamSelektion`: `anwenden` liefert `false`, wo die
    Existenzprüfung scheitert; erfährt die Seite es erst später (404 des Einzelabrufs, Suche in
    einer zweiten Liste), ruft sie `melde(id)`, aber nur bei sicherem Befund (keine weitere Seite,
    kein gescheiterter Abruf). Bereit und sicher ist eine Liste über `deeplinkStand` (am Hook):
    angewandt wird erst ohne laufenden Abruf (ein alter Cache kennt ein eben angelegtes Objekt
    nicht), ein `false` zählt nur frisch und ohne Fehler, ohne Netz hebt der Cache still hervor.
    Was auf derselben Seite steht (Block der Entlassenen), gilt als vorhanden. Die Seite zeichnet
    die Lage als `DeeplinkHinweis` über der Liste
    („<Sache> #<id> gibt es nicht (mehr)“, `info`, `role="status"`, nie Toast) und ruft
    `schliesse()` in ihrer Wahl; eine `ListeDetail` bekommt solange `vorauswahl={false}`, nichts
    ist gewählt. Wächter `components/DeeplinkHinweis.guard.test.ts`.
- **Jede Detailansicht, die bearbeitet werden kann, hat eine Item-Route** (LLH-1139, „Bearbeiten
  in der Ansicht“): eine offene Bearbeitung braucht eine Adresse, auf die Verlassen-Schutz,
  Brotkrume und Lesezeichen zeigen. Ein Query-Param bleibt Auswahl oder Zeilenmarke in einer Liste
  und leitet, wo er eine Ansicht meint, auf die Route weiter (`?einheit=` wie unten). Die Route
  entsteht mit dem Fach-Ticket, das die Ansicht bearbeitbar macht; offen ist sie für den
  Einsatzabschnitt (`?abschnitt=` wählt heute im Detailpaneel).
- **Zwei Bestands-Params neben einer Item-Route** (LLH-1060 D2): `?einheit=` an der
  Einheitenliste leitet auf `einheitDetailPfad` weiter (an der Kräfteübersicht ist `?einheit=` ein Auftrag,
  `kraefteuebersichtPfad`, LLH-1049). `?personal=` bleibt **Zeilenmarke** der Personalliste
  (`personalPfad`): Lagekarte, Schaden und Kräfteübersicht springen auf die hervorgehobene Zeile, um
  die Person im Vergleich zu zeigen; Sprungpalette, Namenslink und Block „Entlassen“ öffnen die
  Personenansicht (`einsatzkraftPfad`), ihre Brotkrume führt auf die Zeilenmarke zurück.
  `?befehl=` wählt einen Befehl im Reiter „Einsatzbefehle“ (`auftraegePfad`), die Item-Route des
  Befehls bleibt Vollseite für Entwurf, Druck und Deeplink.
- **Ansicht und Filter gehören in die Adresse** (LLH-1826, Entwurf
  `docs/superpowers/specs/2026-11-19-yht1wcsw-ansicht-filter-rueckweg-design.md`): jede Wahl über
  einer Einsatzliste (Ansicht, Segment, Filter, Suche) ist ein Query-Parameter, gelesen und
  geschrieben über `routing/useAdressWert.ts` (`useAdressWert`, `useAdressWahl` ohne feste Vorgabe,
  `useAdressSchalter`, `useAdressKennung`, `useAdressText`, `useAdressSuche` entprellt,
  `useAdressWertNachRueckfrage` für eine Ansicht, deren Wechsel eine offene Bearbeitung aushängt).
  Geschrieben mit `replace`, die Vorgabe fehlt in der Adresse, ein unbekannter Wert gilt als
  Vorgabe. **Kein Sitzungsspeicher** dafür: ein Neueinstieg über das Modulmenü beginnt mit der
  Vorgabe, damit ein vergessener Filter nichts versteckt (nur Sortierung, Spaltenfilter und die
  Suche einer Tabelle mit `useListenGedaechtnis` merkt die Sitzung, LLH-1086). Kein `useState` für eine solche Wahl, auch nicht je Einsatz
  (`…NachEinsatz`): ein anderer Einsatz ist eine andere Adresse. Ausgenommen: die Personensuche
  (Namen), Aufklappzustände, die Gerätehülle für die Rollposition. Mehrere Schreiber im selben Zug
  (Link-Aufträge, Listengedächtnis, Werte) gehen über `useAdressAenderung`
  (`routing/useLinkAuftrag.ts`), nie über `setSearchParams` vom Stand des Renders: der zweite
  stellte sonst zurück, was der erste geändert hat. Zwei Listen auf einer Seite tragen getrennte
  Namen (Befehle: `befehle_…`). ETB: `etbFilterPfad`/`parseEtbFilter`, `mitQuery` kodiert;
  ETB-Systemeinträge: `frontend/src/etb/AGENTS.md`. Unbekannter
  Enum-Wert wird ganz verworfen (exhaustiver `Record<EtbTyp, true>`). Für Tabellen gilt eine
  gemeinsame Kodierung (LLH-1086, `listenZustandParams`/`parseListenZustand`): `sort=<spalte>:auf|ab`
  (`aus` = bewusst unsortiert, die Vorgabe steht nicht da), `f.<spalte>=a,b`, `q=`; geschrieben
  mit `replace`, fremde Parameter bleiben, Unbekanntes prüft `bereinigeListenZustand` weg.
- **Ortspfad zur Liste über `ListenRueckweg`** (LLH-1997): Ein Ortspfad-Glied, das auf eine Liste
  oder eine übergeordnete Seite führt, ist `ListenRueckweg` (`components/ListenRueckweg.tsx`), nie
  ein nackter `Link`, im Einsatz wie in der Verwaltung. Kam man per PUSH von genau diesem Pfad
  (Query zählt nicht), geht der einfache Klick per `navigate(-1)` zurück, damit Ansicht, Filter und
  Rollposition wieder stehen; das `href` trägt die vorige Adresse für Strg- und Mittelklick. Sonst
  ist es ein Link auf das Ziel. Ein Ziel mit Zeilenmarke, die die Liste wählt und hervorhebt (Befehl,
  `?befehl=`), bekommt `zeilenmarke` und bleibt immer ein Link. Die Herkunft je Verlaufseintrag merkt `VerlaufMerken` im
  `BetriebsLayout` (`routing/verlaufGedaechtnis.ts`, `sessionStorage lfh:verlauf`, räumt bei jedem
  Ausgang). Andere Rückwege (nach Storno oder Löschen, „Zur Liste“ in `SeitenNichtGefunden`) bleiben
  Links: nach einer Aktion ist kein Zurück im Verlauf gemeint. Herleitung:
  `docs/superpowers/specs/2026-11-19-z7oww8sf-ortspfad-rueckweg-liste-design.md`.
- **Rollposition beim Zurück** (LLH-1826): `components/RollWiederherstellung.tsx` im
  `BetriebsLayout` (Stab und Einsatzrahmen; in der Gerätehülle rollt das `main`, dort nicht). Sie
  merkt die Position je `location.key` (`routing/rollGedaechtnis.ts`, `sessionStorage`), stellt sie
  beim POP wieder her, sobald die Seite hoch genug ist (höchstens `ROLL_FRIST_MS`), gibt bei eigener
  Eingabe auf und hält still, wenn die Adresse ein Deeplink-Ziel trägt (`traegtZiel`; ein neuer
  Deeplink-Parameter gehört in `ZIEL_PARAMETER`; ein Filter trägt nie den Namen eines Ziels, Wächter `routing/rollGedaechtnis.guard.test.ts`). PUSH beginnt oben, REPLACE rollt nicht.
- **Zeit in der URL** ist UTC ohne Zone (`dayjs(s)` läse Ortszeit) — Umkehr in `anzeige/zeitEingabe.ts`
  mit eigenem Test. Kodierung per Round-Trip durch `URLSearchParams` prüfen.
- Filterleiste nur bei **fremder** Änderung neu aufsetzen (nach der Navigation); entprellt wird
  in der Leiste. Unter Fake-Timern: `fireEvent.change`, kein `userEvent.type`, kein `findBy*`.

## Frontend — Query-Key-Registry (LFH-122/307/312)

Quelle der Wahrheit: `frontend/src/api/queryKeys.ts`.

- `einsatzKeys` (`EINSATZ_KEYS`): jeder Key genau einmal klassifiziert — live über
  `EINSATZ_STREAM_EVENTS` oder `NICHT_LIVE_KEYS`. `globalKeys` (`GLOBAL_KEYS`) für alles darüber.
- **Der Einsatzkopf ist live** (LFH-555, `openspec/changes/archive/2026-09-30-lfh-555-einsatzkopf-live/design.md`):
  Ereignis `einsatz` mit leerer Gate-Menge (Tür des Stroms = Tür des Kopf-GET; leer steht nur
  `einsatz`, `mitglieder`, `lagged` und der empfängergebundenen `benachrichtigung` zu, Guard
  `ungegatet_sind_nur_lagged_einsatz_mitglieder_und_benachrichtigung`), invalidiert Kopf und
  Stand der Lagebesprechung. **`mitglieder`** (i6k6mzed, D2) feuert bei `PUT`/`DELETE
…/mitglieder/…` neben `einsatz` und invalidiert Mitglieder, Aufträge, Erinnerungen und
  Modulzähler: die Mitgliedschaft ist die eine Quelle der Auflösung S1–S6 → Person. Es feuern PATCH, Abschluss, Frist und Termin oder Abschluss der
  Lagebesprechung **nur bei geändertem Termin**; `meine_*` und `lagekennzahlen` lösen es nicht aus.
- **Einsatzliste und Stammdaten sind live** (LFH-734, Spec `org-live`): `globalKeys` sind wie die
  Einsatz-Keys genau einmal klassifiziert — live über `ORG_STREAM_EVENTS` (Ereignisse
  `einsatzliste`, `stammdaten`) oder `NICHT_LIVE_GLOBAL_KEYS` (Guard (g)). **Ein Tab, eine
  Live-Verbindung:** der Einsatz-Strom trägt die Org-Ereignisse mit; außerhalb eines Einsatzes
  öffnet die Betriebszeile `/api/live` (`live/useOrgLiveStream.ts`), der ruht, solange ein
  Einsatz-Strom offen ist (`live/einsatzStromStore.ts`). Verbindungsbau nur über
  `live/liveVerbindung.ts`, keine zweite `EventSource`.
- **Präsenz ist kein Cache** (LLH-1946, ADR-0074): das Ereignis `praesenz` füllt den Store in
  `live/praesenz.ts` (kein Query-Key, nicht über den Sammler), gelesen über `usePraesenzAnderer`.
  Gemeldet wird nur über die Prop `praesenz` an `InlineAngabe`, nie aus einer Seite selbst.
- **Live-Ereignisse invalidieren nur über den Sammler** `live/liveInvalidierung.ts` (LFH-922,
  Spec `live-abgleich`): je Key ein Abgleich je 300-ms-Fenster, `cancelRefetch: false`, verdeckte
  Tabs markieren nur. `modulZaehler` läuft über einen zweiten Sammler mit 1-s-Fenster
  (`ZAEHLER_SAMMELFENSTER_MS`, LFH-935): ein Burst kostet je Tab einen Zählerabruf. Seiteneffekte (Ton, Toast, Status) bleiben sofort. Spätere Live-Abnehmer
  (Modulzähler, ETB-Zeitachse, Meldungen) übernehmen ihn, statt eigene Timer zu bauen. Ein
  Neuaufbau des Browsers nach dem Kontroll-Ereignis `position` gleicht im Einsatz-Strom nur die
  Org-Keys ab (der Server liefert per `Last-Event-ID` nach), sonst und bei neuer Verbindung voll.
- **Gezielter Abgleich nach Payload** (LFH-931, Spec `live-abgleich`): trägt ein Ereignis seine
  Objekt-Kennung, ordnet `EINSATZ_STREAM_ZIELE` zu — nur das Detail bei `nur_inhalt`, nur die
  Anhangliste bei `anhang`, eine Zeile über `live/zeilenAbgleich.ts` (bis 10 Kennungen je
  Fenster, sonst und bei verdecktem Tab, Fehler oder fehlender Liste der Sammler). Ohne Kennung
  gelten die Prefixe aus `EINSATZ_STREAM_EVENTS`, `lagged` gleicht weiter alles ab. Jeder gezielte
  Key liegt unter den Prefixen seines Ereignisses (`queryKeys.test.ts`); eine zeilenweise
  abgeglichene Liste sortiert wie ihr SQL (Vergleichsfunktion neben dem Fetcher). Der Zeilenabruf
  ist so wenig protokolliert wie die Liste; eine auditierte Detail-Route ist keine Zeilenquelle,
  jeder Tab schriebe bei jedem Ereignis eine Protokollzeile. Personen haben deshalb eine eigene
  Zeilen-Route (`…/personen/{pid}/zeile`, LLH-1682), die nur liefert, was die Liste zeigt; dort
  heißt ein 404 mit `grund: "nicht_in_liste"` (`ApiError.grund`) „gehört nicht hinein“ und nimmt
  die Zeile heraus. Jeder andere 404 (unbekannte Route) und bei Schäden jeder 404 geht an den
  Sammler. Hat sich eine abgerufene Zeile während ihres Abrufs geändert (optimistische Änderung),
  wird sie nicht überschrieben, sondern im nächsten Fenster erneut abgerufen. Eine
  Seitenkette (`useInfiniteQuery`) bekommt eine Zeile nur innerhalb des geladenen Fensters
  (`fensterEinsortieren`, LFH-1075); entscheidet über die Zugehörigkeit nur der Server
  (Suchbegriff), geht die Kette an den Sammler. Kennzahlen gleicht immer der Sammler ab.
- **Storno sperrt offene Detailseiten** (LLH-1832, Spec `storno-sperre`): Person, Tier, Schaden
  und Betreuungsstelle zeigen einen Storno ohne Zutun. Oben steht `components/StornoBanner.tsx`
  („Storniert von … um …“), alle Schreibwege hängen an `storniert_at`. Tier- und Schadendetail
  sind dafür live; die Person gleicht ihren protokollfreien Stand ab (`personStand`), die
  Betreuungsstelle fragt ihn erst ab, wenn sie aus der Übersicht fällt
  (`betreuungsstelleStand`). Eine offene Eingabe verliert dabei ihren Text nicht: `InlineAngabe`
  hält einen geänderten Entwurf schreibgeschützt, wenn `darfSchreiben` wegfällt; Formulare
  sperren ihre Felder über `entwurfNurLesen` (Text `readOnly`, sonst `disabled`) und zeigen nur
  „Schließen“. Eine unberührte Bearbeitung schließt.
- **Kein Inline-String-Array als Query-Key** (`queryKeys.guard.test.ts`, `queryKeyScan.ts`).
- **Wire-Strings sind eingefroren** (`globalKeys.test.ts`, gegen handgeschriebene Literale).
- Sub-Keys: String-Union-Token als zweites Element; der argumentlose Accessor ist der
  Invalidierungs-Prefix (`personal()` und `personalListe('alle')`).
- **Testfallen:** ohne gemounteten Observer `new QueryClient()` statt `neuerQueryClient()` (dessen
  `gcTime: 0` räumt beim ersten `await`);
  **Charakterisierungstests bauen ihre Keys als Literale**, nicht über die Factory.
- **Ein neuer Prefix entscheidet über `LAGEBILD_OFFLINE`** (auf die Platte oder ausdrücklich
  draußen): `frontend/src/offline/AGENTS.md`.
- **Eine Mutation, die eine `erfasse…OfflineFaehig`-Funktion ruft, und Seitentests ohne Netz**
  (`networkMode`, `setzeOnline`): `frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“.

## Frontend — Lint-Disziplin

- **oxlint** (LLH-2020, ADR-0089): `pnpm lint` = `oxlint --deny-warnings
--report-unused-disable-directives`. Jede Warnung und jede tote Direktive bricht das Gate;
  Warnungen an der Wurzel beheben. Das Regelset steht einzeln in `.oxlintrc.json` (keine
  Kategorien), damit ein oxlint-Update keine Regel still einschaltet; eine neue Regel ist eine
  eigene Entscheidung.
- `exhaustive-deps` strukturell lösen (Primitive, `useMemo`/`useCallback`). Ausnahmen nur als
  `oxlint-disable-next-line <regel>` an der gemeldeten Zeile mit Begründung; keine
  Block-Disables, keine toten Direktiven.
- **Eigene Riegel per AST-Selektor** stehen im Plugin `lfh` (`lint/riegel-plugin.js`, heute die
  e2e-Riegel). Die JS-Plugin-API von oxlint ist Alpha: jeder Riegel bekommt Musterdateien in
  `lint/riegel-plugin.test.ts`, damit ein Update, das Selektoren bricht, rot wird.
- **Eigene AST-Prüfungen in Guard-Tests** lesen den Quelltext über `lib/sourceAst.ts`
  (oxc-parser), nie über `typescript`: TypeScript 7 bringt die Compiler-API nicht mehr mit.

## Frontend — Typecheck mit TypeScript 7 (LLH-2020)

`typecheck` und `build` rufen `tsc` direkt; seit TypeScript 7 startet `bin/tsc` das native
Go-Binary (Spitze rund 3,1 GB Arbeitsspeicher, Node-Heap spielt keine Rolle mehr, LLH-1405 ist
damit hinfällig). Der Typ-Codegen braucht noch die Compiler-API von TypeScript 6 und holt sie über
`scripts/ts6-fuer-codegen.mjs` aus `@typescript/typescript6` (Rückbau: LLH-2068).

## Frontend — Browserspeicher (LFH-942)

- **`localStorage` nur über `lib/sichererSpeicher`** (`sicherLesen`, `sicherSchreiben`,
  `sicherEntfernen`, `sicherSchluessel`); `lib/sichererSpeicher.guard.test.ts` macht jeden anderen
  Zugriff rot. Auf gehärteten Rechnern ist `localStorage` `null` oder wirft, ein Wurf im Render
  lässt die Seite weiß.
- **Eine Einstellung wirkt auch ohne Speicher:** erst den State setzen, dann schreiben; ohne
  gespeicherten Wert gilt die Vorgabe (Farbschema: Nachtbetrieb).
- Jeder Speicherort steht in `GERAETESPEICHER`: `frontend/src/offline/AGENTS.md`.
- Herleitung: `openspec/changes/archive/2026-10-06-lfh-942-browserspeicher-abgesichert/design.md`.

## Sitzung über mehrere Tabs (LFH-387)

Geschrieben wird nur über `apiSend`/`apiUpload` (tragen `X-Erwarteter-Benutzer-Id`, Server
antwortet bei fremder Kennung 412). Regeln: `frontend/src/auth/AGENTS.md`.
