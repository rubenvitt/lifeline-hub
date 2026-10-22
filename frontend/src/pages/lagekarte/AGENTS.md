# Lagekarte — Regeln

Gilt für `frontend/src/pages/lagekarte/` und `pages/LagekartePage.tsx`, ergänzt `frontend/AGENTS.md`.
Pfade relativ zu `frontend/src/`.

**Die Lagekarte bedient den Kontext mobil** (LFH-557, Entscheidung 30.09.2026): lesen, verorten,
eine Figur zeichnen; Vergleichen und Verwalten bleiben Fükw und Tablet. Die Form ist **kein
Drawer**, die Leiste trägt Inhalt, und die Ausnahme des Navigations-Drawers gilt für sie nicht.
Ab `lg` steht die Leiste (300 px) neben der Karte, darunter **unter** ihr, am Handschirm per
Vorgabe zu (`lagekarte/leistenWahl.ts`), und jeder Kartenmodus gibt die Karte frei (LFH-765).
Nachweis bei 390 px: `e2e/lagekarte-smoke.spec.ts` (Überdeckung, freie Karte über dem Fuß),
`e2e/lagekarte-touch.spec.ts` (Gesten, Modi). Eine neue feste Breite in der Kartenspalte bricht
diese Zusage.

- **Warnstufe trägt der TEXT** (LFH-357, Rangfolge `src/gefahr/repo.rs`): `zonenBeschriftung` (`pages/lagekarte/zonenStil.ts`),
  „Warnstufe: <label>" nur aus `warnstufeKarte`; fehlender Nachschlag = „unbekannt" (die Farbe
  rundet vorsichtshalber auf `keine`/Alarm); „keine" = keine Stufe gesetzt. Kollision des
  `zonen-label` ist nicht abgesichert (eigene Entscheidung).
- **Trefferzone `controlHeight`** an jedem Marker (`KarteMarker.trefferDurchmesser`,
  `marker-einsatzort-treffer`); Personen zusätzlich 2 px schwarze Außenkante. **Fachebenen-Punkte
  und -Bündel ebenso** (LFH-600,
  `openspec/changes/archive/2026-10-01-lfh-600-fachebenen-punkte-trefferzone/design.md`):
  `fachebene-<key>-treffer` aus `AktiveFachebene.treffer`, Rolle `fachebeneTreffer`, gleichrangig
  mit der Marker-Zone (der nächste Punkt gewinnt); der gezeichnete Radius bleibt die Stufe und
  wächst nie mit der Dichte. Kontur als Doppelkante wie bei Personen (2 px weiß am Kreis, 2 px
  Schwarz als `-kante` darunter), Nachweis `e2e/fachebenen-kontrast.spec.ts`. Bild-Ziehgriffe
  (`pages/lagekarte/bildGriffe.ts`) in `max(controlHeight, 44)`, je Modus scharf, Moduswechsel
  wartet auf `dragend`; in „Größe" Ecken immer, eine Kante nur ohne Überlappung mit Ecke oder
  Kante (`scharfeGriffe`, neu bei `move`/`dragend`/`setzeEcken`, nie im Zug; LFH-764).
- **Ein Tipp gehört genau einem Ziel** (LFH-764,
  `openspec/changes/archive/2026-09-30-lfh-764-lagekarte-griffe-klickwege/design.md`): jeder Karten-Klickhörer fragt
  `klickzielAm` (`Kartenflaeche.tsx`, ein Urteil je Originalereignis) → `entscheideKlickziel`
  (`pages/lagekarte/klickziel.ts`): gezeichnetes Punktziel > Trefferzone > Fläche. Eine neue
  Klickebene braucht eine Rolle in `ordneKlickebene` (Guard in `klickziel.test.ts`).
  **Mehrere Flächen am Punkt wählt der Mensch** (LFH-812,
  `openspec/changes/archive/2026-09-30-lfh-812-lagekarte-flaechen-auswahlmenue/design.md`): erst entdoppeln (Zone
  über Füllung + Umriss zählt einmal), ab zwei `mehrdeutig` → `FlaechenwahlMenue` am Tipppunkt,
  eigene vor Fachebenen, Kennung aus `flaechenwahl.ts`; Wahl über dieselben Callbacks, aus im
  exklusiven Modus (Prop `flaechenwahl`). Geschlossen wird nur über `onOpenChange`.
- **Kontextmenü an der Kartenstelle** (LFH-776, Spec `lagekarte-kontextmenue`,
  `openspec/changes/archive/2026-10-03-lfh-776-lagekarte-kontextmenue/design.md`): Rechtsklick und langer Druck kommen
  als EIN maplibre-Ereignis `contextmenu` (`Kartenflaeche.tsx`); offen nur an einem Ort
  (`istOrtsziel` in `klickziel.ts`: freie Karte, Fläche — nie Punktziel oder Trefferzone), gesperrt
  über die Prop `kontextmenue` (`null` im exklusiven Modus). Nach dem langen Druck liegt der Finger
  noch: `nachklickRiegel.ts` hängt VOR jedem Dropdown am `window` (Capture) und schluckt die
  Ereignisse des Abhebens. Einträge und Rechte nur aus `kontextEintraege` (`kontextmenue.ts`).
  Punktmenüs der Karte (Flächenwahl, Kontextmenü) teilen die Schale `PunktankerMenue.tsx`; ein Kopf
  steht über dem Menü, nie als antd-Gruppe (rc-menu fokussierte sonst die Gruppe). Nachweis
  `e2e/lagekarte-touch.spec.ts` (langer Druck per CDP, Rechtsklick).
- **Betreuung auf der Karte** (LFH-673, `openspec/changes/archive/2026-09-29-lfh-673-betreuung-auf-der-lagekarte/design.md`):
  Marker-Ebene wie UHS (`alleVerortet`, `?platzieren=betreuungsstelle:<id>`), Sperre an der
  **Datenquelle** (`pages/lagekarte/betreuungEbene.ts`);
  Ort-Vorschau kennt keine Stellen (`src/geocoding/marker.rs`); Verortung ohne ETB, live über
  `Geschrieben::still_geaendert`; Zonentyp `evakuierungsbezirk` (`lage_zone.evakuierungsbezirk_id`).
- **Bereitstellungsräume auf der Karte** (LLH-1107, Spec `bereitstellungsraum-lagekarte`): Muster
  der Betreuung (`alleVerortet`, Objektliste, `?platzieren=bereitstellungsraum:<id>`, Sperre
  an der Datenquelle `pages/lagekarte/brEbene.ts`, Fach `einsatzKeys.br` der Modulseite). Das
  Zeichen D.2.1 hängt am Typ (`bereitstellungsraumZeichen` in `zeichen/fachobjektZeichen.ts`),
  nicht an `tz`. Die Plakette ist `label` plus `beschriftungZusatz`: Fahrzeuge nur aus `belegung`,
  Stärke nur über `staerkeImRaum`, unvollständig weggelassen. Geplant heißt gestrichelter Ring
  (`geplantRing.ts`, Bild `ring|geplant` über den Bild-Resolver, Layer `marker-geplant` und
  `spider-geplant`, Klickziel wie der Statusring) plus das Wort „geplant“, nie eine Farbe.
  Die Räume fließen über die Marker-Quelle, also ohne eigenen Schlüssel für
  `wendeKartenDatenAn` (sie gehen mit `marker`).
- **Tiere auf der Karte** (LLH-1123, Spec `tier-lagekarte`): Muster der Bereitstellungsräume
  (`alleVerortet`, Objektliste, `?platzieren=tier:<id>`, Sperre an der Datenquelle
  `pages/lagekarte/tierEbene.ts`, Fach `einsatzKeys.tiere`). Nur `aktiv` und `vermisst` stehen auf der
  Karte, abgeschlossene und stornierte nie. DV 102 kennt kein Tier ohne Zustand: der Marker bleibt
  ein Kreis mit Kurzzeichen „T“ (`tierMarker.ts`), kein Eigenbau-Zeichen; vermisst heißt Rolle
  `achtung` plus das Wort „vermisst“. Die Liste trägt Halterkontakt und Kennzeichnung, deshalb
  bewusst nicht in `LAGEBILD_OFFLINE`.
- **Kartenquellen eines fremden Moduls laden nur mit Freigabe des Servers** (LFH-669, Spec
  `modul-freigabe`, `openspec/changes/archive/2026-10-01-lfh-669-modulfreigabe-vom-server/design.md` D4):
  `useLagekarteDaten` fragt UHS, Schäden, Einheiten, Fahrzeuge, Abschnitte, Gefahrengebiete,
  Lagemeldungen und Rückmeldungen nur bei `istKeyFreigegeben(<modul>, freigaben)` ab, Betreuung,
  Bereitstellungsräume und Tiere über ihren Ebenen-Zugriff (`betreuungEbene.ts`, `brEbene.ts`,
  `tierEbene.ts`), ohne bekannte Freigaben gar nicht. Gesperrt ist kein Ausfall (keine Rohdaten, kein Eintrag im
  Ausfallhinweis); fehlen die Freigaben, nennt der Ausfallhinweis „Berechtigungen“. Eine neue
  modulgebundene Quelle bekommt dasselbe Gate; der Modul-Key folgt `PFAD_KEY` in
  `src/einsatz/modul.rs`.
- **Objektsuche/Zeichenwahl** (LFH-716,
  `openspec/changes/archive/2026-09-29-lfh-716-lagekarte-markersuche-zeichenpicker/design.md`): die
  Objektliste (`MarkerSuche`) liest `objektEintraege` über `suchbareMarker`
  (`pages/lagekarte/objektsuche.ts`); beide prüfen die Modulsperre **je Typ**, auch für die nicht
  verorteten (nicht nur an der Datenquelle). Enter sendet über `onAbsenden`
  mit Spec; `FreiesZeichenInspector` entprellt (600 ms) mit eigenem Merker, Bezeichnung
  kontrolliert. Enter-Tests über `userEvent.keyboard`.
- **Ortssuche im Objektsuchfeld** (LFH-638, Spec `lagekarte-ortssuche`,
  `openspec/changes/archive/2026-10-01-lfh-638-lagekarte-ort-suche/design.md`): `MarkerSuche` erkennt
  eine Koordinate beim Tippen (`anzeige/koordinatenErkennung.ts`, dieselbe Quelle wie die
  Sprungpalette) und sucht eine Adresse **nur auf Enter** (`AdressGruppe`, Route `…/karte/ort-suche`;
  kein Autovervollständigen, Nominatim-Regeln; die Zustandstexte teilt sie mit dem Ortsfeld über
  `anzeige/ortssuche.ts`). Die Suchnadel (`suchnadelLayer.ts`) ist **keine
  Klickebene** (keine Rolle in `ordneKlickebene`, Guard in `suchnadelLayer.test.ts`), liegt unter
  der Eigenposition, lebt nur im Seitenzustand und trägt Beschriftung und „Suchnadel entfernen“ im
  Fuß-Band `SuchnadelBand`. `?zentrum=` setzt die Nadel mit, `?ort=` belegt das Suchfeld vor.
- **Schwebende Bänder werden gestapelt, nicht per `zIndex` gestaffelt** (LFH-355,
  `pages/lagekarte/KartenFuss.tsx`): ein Rahmen (`pointerEvents: 'none'`), Bänder als
  Flow-Geschwister mit `bandStil(…)` (`'auto'`, nie `position: 'absolute'`). Der Fuß endet vor der
  Knopfspalte (`fussStil(knopfKante)`) und oben an der Karte; kein `overflow` am Rahmen. Das
  Werkzeugmenü ist das oberste Kind (`marginBlockEnd: 'auto'`, rollt in sich) und überdeckt so
  weder Knopfblock noch Bänder.
- **Das Zeitachsen-Band hat höchstens zwei Reihen** (LFH-899, Spec `lagekarte-zeitachse`,
  `openspec/changes/archive/2026-10-04-lfh-899-zeitachse-band-flacher/design.md`): zwei Gruppen,
  die nicht in sich umbrechen (Wiedergabe: Ausblenden, Abspielen, Schieber · Stand: Auswahl
  „Stand“, Sichern); Stände nur über die Auswahl, nie als Knopfreihe; die Bezeichnung im Dialog.
  Abstände nur aus `bandStile` (Staffel), Deckel und Zielabstand in `e2e/leisten-flaeche.spec.ts`.
- **Jeder Kamera-Aufruf sagt, wer bewegt** (LFH-766, `lagekarte/kamera.ts`, D2 in
  `openspec/changes/archive/2026-10-02-lfh-766-eigenposition-anflug-genauigkeit/design.md`):
  letztes Argument `BEDIENUNG` (Knopf, Tipp, `flyToZiel`) oder `AUTOMATISCH` (Startansicht,
  Eigenpositions-Anflug); Wächter `kamera.guard.test.ts`. Daran entfällt der erste Anflug der
  Eigenposition nach einer Bedienung.
- **Die Karte kippt nicht** (`touchPitch: false` **und** `maxPitch: 0` in `Kartenflaeche.tsx`).
- **Karte ohne Grafik** (LLH-1353, Spec `lagekarte-kartengrundlage`): ohne WebGL2 wirft maplibres
  Konstruktor `GPUInitializationError`. Der Karten-Effekt baut die Karte nur über
  `wennDarstellbar` (`lagekarte/kartenGrafik.ts`), das genau diesen Wurf fängt (am `name`, die
  Test-Nachbauten exportieren die Klasse nicht); jeder andere fliegt weiter. Dann bleibt `mapRef`
  `null`, die Fläche zeigt `KARTE_NICHT_DARSTELLBAR` (`data-lfh="karte-nicht-darstellbar"`), die
  übrige Seite bleibt bedienbar; jeder Effekt und jede Handle-Methode prüft deshalb auf `null`.
  `KartenHandle.isDarstellbar()` gibt den Grund an den Lageplan (`useLageplan`: Druck und Anlage
  nennen ihn). Kein Wort über WebGL2 in der Oberfläche, das steht im Anwenderkapitel. Nachweis
  `e2e/lagekarte-ohne-grafik.spec.ts` (Chromium per Init-Skript, Firefox ohne Nachbau). **Jede
  andere maplibre-Karte** baut ebenso über `wennDarstellbar` und zeigt an ihrer Stelle
  `KarteNichtDarstellbar` (`anzeige/Kartenausschnitt.tsx`, LLH-1370): der Ausschnitt des
  Einsatzorts, `betreuung/BezirkKartenbild.tsx` und die Karte des Lagemonitors
  (`geraet/LagemonitorKarte.tsx`, LLH-1377, Großbild über `hoehe`/`schrift`); Nachweis
  `e2e/kartenausschnitt-ohne-grafik.spec.ts`, `e2e/geraet-lagemonitor-ohne-grafik.spec.ts`.
- **Fachebenen nennen ihr Alter** (LFH-591,
  `openspec/changes/archive/2026-09-30-lfh-591-fachebenen-datenalter/design.md`): `abgerufen` im
  Umschlag ist der Abruf durch den Server, `stand` bleibt der Datenstand der Quelle (KRITIS,
  Energie, Luftqualität). `ok()` setzt es, der Cache trägt es mit (Rückfall `gespeichert_at`).
  Veraltet ist eine Marke am `ok`, kein Status; Schwelle `veraltetNachMin` je Ebene
  (`fachebenen.ts`, Tabelle in `docs/fachebenen-quellen.md`), Anzeige nur über
  `FachebeneStand.tsx`, Takt `components/useMinutenTakt.ts`.
- **Warnebenen enden nach 6 h, DWD-Warnungen nach ihrem Ende** (LFH-662,
  `openspec/changes/archive/2026-10-01-lfh-662-dwd-ebene-gueltigkeit-warnstufe/design.md`): NINA und DWD liefern
  einen Cache-Stand über `WARN_OBERGRENZE` nicht mehr aus (`swr_weg`, kalt → `offline`), die
  übrigen Ebenen bleiben bei 48 h. `EXPIRES ≤ jetzt` filtern **beide** Seiten: der Server bei
  jeder Auslieferung (`dwd_gueltige`, der Cache hält den Rohstand), der Client im Minutentakt
  (`dwdGueltigkeit.ts`) für gehaltene Daten. `angekuendigt` (`ONSET > jetzt`) setzt nur der
  Client; gestrichelt über die eigene Ebene `-line-angekuendigt`, nie über einen
  datengetriebenen `line-dasharray`. Schwere im Inspector nur aus `dwdWarnstufe`/`capSchwere`.
- **Fachebenen antworten bedingt** (LFH-594, `fachebene_antwort` in `routes/karte.rs`): ETag =
  Hash der ausgelieferten Bytes (nicht `gespeichert_at`), `private, no-cache`, 304 ohne Body;
  `If-None-Match` vergleicht schwach (`support::if_none_match_matcht`). Das 304 löst der
  HTTP-Cache des Browsers auf — `apiGet` setzt **keine** `cache`-Option. Nachweis auf der
  Leitung per CDP: `e2e/fachebenen-bedingt.spec.ts` (Playwrights `status()` meldet 200).
- **Unter `lg` gibt jeder Kartenmodus die Karte frei** (LFH-765,
  `openspec/changes/archive/2026-09-30-lfh-765-lagekarte-modi-karte-freigeben/design.md`): abgeleitet aus
  `exklusiverModusAktiv` in `leisteSichtbar` (`lagekarte/leistenWahl.ts`), nie per Aufruf je
  Startweg; nach dem Modus gilt wieder der vorherige Zustand (Entscheidung 29.09.2026).
  „Leiste einblenden" im Modus ist `umschalteImModus` (nie gespeichert). Ab `lg` erzwingen die
  Leistenmodi die Leiste wie bisher.
- **Leistenmodi haben je Breite eine Bedienstelle** (LLH-1028, Spec `lagekarte-kartenleiste`):
  die Bedienung von Platzieren, Taktischem Zeichen, Bild einpassen und der Rückmeldung
  „… verortet“ ist EIN Baustein `ModusBedienung` (`PlatzierSteuerung.tsx`). Unter `lg` steht sie im
  Fuß-Band `PlatzierSteuerung`, ab `lg` im Modus-Band der Leiste (`ModusBand.tsx`, direkt unter der
  Segmentleiste, außerhalb der Ansichten); Prop `modusBedienung: 'fuss' | 'band'`. Unter `lg`
  trägt das Modus-Band nur Titel und Zusatzangaben (Koordinate, Mittelpunkt). Zeilen und Paneele
  zeigen nur den Zustand („wird platziert“, „wird eingepasst“) — je Breite genau ein Knopf je
  Handlung, auch wenn die Ansicht wechselt. Eingabeentwürfe leben im Band, das je Ziel neu
  eingehängt wird (`key`).
- **Verortungsauftrag von außen** (LLH-1125, Spec `lagekarte-verortungsauftrag`,
  `openspec/changes/archive/2026-10-18-pao1s6uw-verorten-rueckweg/design.md`): `?platzieren=<typ>:<id>[&zurueck=1]`
  startet über `onVerortungsauftragStart`. Der **Ebenen-Vorrang** ist abgeleitet, nie gespeichert:
  `verortungsTyp` im Hook (bis zum Unmount), gezeichnet wird `layerMitVorrang`
  (`lagekarte/verortungsauftrag.ts`), Schalter, Schmutzig-Erkennung und Speichern lesen weiter
  `layer`; die Schalterzeile trägt „eingeblendet“, die Modulsperre bleibt an der Datenquelle.
  Nach Erfolg wird der Modus zu `verortet` (kein exklusiver Modus, kein Toast): Marker gewählt und
  angeflogen, Rückmeldung „<Kennung> verortet“ mit „Zurück zu …“ (nur mit `zurueck`) und „Auf der
  Karte bleiben“, unter `lg` im Fuß-Band, ab `lg` im Modus-Band der Leiste — je Breite genau ein
  Knopf je Handlung. Der **Rückweg** folgt allein aus Typ und Kennung (`rueckwegPfad`, exhaustiver
  `Record`; UHS ohne äußeren Einstieg `null`), nie aus der URL (kein offener Weiterleiter). Ein
  Start in der Karte selbst (Objektliste, Einsatzort) endet wie bisher mit Toast und
  Modusende (LFH-765). Nachweis `e2e/lagekarte-betroffene.spec.ts`, `e2e/lagekarte-touch.spec.ts`.
- **Die Kartenleiste hat drei Ansichten** (LLH-1028, LLH-1033, Spec `lagekarte-kartenleiste`):
  erste Zeile ist eine `Segmentleiste` (`rolle="tablist"`) „Ebenen“ · „Objekte“ · „Auswahl“ auf
  festen Dritteln (`.lfh-leisten-ansichten`, mit Auswahl `--drei` in `lagekarte.css`). „Auswahl“
  gibt es nur mit einer Auswahl; ohne sie bleibt ihr Drittel leer (kein gesperrtes Segment). Alle
  Tabpanels bleiben montiert (`hidden`): Suchbegriffe, Filter, Klappzustand und Entwürfe überleben
  Wechsel und Modus ohne eigenen Speicher; die Rollfläche merkt sich ihre Lage je Ansicht,
  „Auswahl“ beginnt oben. Die gemerkte Ansicht hält `LagekartePage` (`useLeistenAnsicht`, je
  Gerät, `lfh:lagekarte:leiste-ansicht`, nur „Ebenen“/„Objekte“), den Vorrang der Auswahl
  `useAuswahlVorn` (Seitenzustand, nie gespeichert: eine neue Auswahl-Kennung und jeder Tipp auf
  einen Marker oder eine Zeile holen sie nach vorn, ein Tipp auf „Ebenen“/„Objekte“ lässt sie
  bestehen). Die Seite entscheidet daraus, ob ein abgelehnter Ansichts-Speicherversuch im Kopf der
  Ebenen oder als Kartenhinweis steht (Kopf nur bei sichtbarer Leiste UND „Ebenen“ gezeigt;
  LFH-1077). Rückweg „← Ebenen/Objekte“ im Kopf der Auswahl hebt alle Auswahlen auf; Esc ebenso
  (Zuhörer der Seite, nur bei offener Auswahl, nicht bei Zeichnen/Kreis/Messen, Overlay, Feld,
  `repeat`). Esc-Reihenfolge: offenes Werkzeugmenü (eigener Zuhörer, nimmt die Taste) → offenes
  Bündel (`Kartenflaeche`, Capture-Phase, nimmt die Taste) → Auswahl → Fokus; jede Stufe setzt
  `preventDefault`, jede prüft `defaultPrevented`. `?ort=` schaltet auf „Objekte“, merkt das wie
  ein Tipp und lässt die Auswahl bestehen; „Zeichenwerkzeuge“ ändert weder Ansicht noch
  Sichtbarkeit der Leiste (LLH-1038). e2e-Wege: `e2e/leisten-kern.ts`.
- **Objekte = eine Liste** (LLH-1033, Spec `lagekarte-objektsuche`, `MarkerSuche.tsx`): Suchfeld,
  Marke „Nicht verortet“ (`SegmentUmschalter`, Filter; 0 → „Alles verortet“, Lagebild-Ausfall →
  „—“), der Einsatzort als erste Zeile, darunter Gruppen je Art (`OBJEKT_GRUPPEN`, fester Rang,
  Kopf „verortet/gesamt“, nur-verortete Arten nur die Zahl), ohne Begriff zu und je Gerät gemerkt
  (`lfh:lagekarte:objekte-gruppen`, `useObjektKlapp`), mit Begriff/Filter vorläufig offen. Gruppiert
  wird rein (`gruppiereObjekte`). Eine verortete Zeile ist ein `<button>` (anfliegen, auswählen),
  eine nicht verortete trägt nur „Platzieren“/„Fläche zeichnen“ bzw. „nicht verortet“; das laufende
  Ziel steht bei jedem Filter mit „wird platziert“ (Abbrechen im Modus-Band). Ein Abschnitt ohne
  Fläche ist zusätzlich wählbar (`istWaehlbar`): Inspector mit `ohneOrt`, Marker aus
  `abschnittOhneFlaeche` (`marker.ts`), nie in Karten- oder Wählliste. Kein Typ-Zeichen je Zeile,
  keine `unterEbene` an der `Liste` (Auswahlliste, LFH-826).
- **Ebenen = ein Ebenenbaum** (LLH-1028, `Ebenenbaum.tsx`, lagekarte-eigen): Gruppen und
  Untergruppen sind Daten (`EBENEN_GRUPPEN`, `FACHEBENEN_GRUPPEN` in `leistenDaten.ts`, Wächter
  „jede Ebene genau einmal“) — eine neue Ebene bekommt dort ihre Gruppe. Eine Zeilenform für eigene
  und Fachebenen: die Zeile ist der Schalter (`<button role="switch">`, Name = Ebenenname), kein
  zweiter `Switch`; Geltung und Stand einer Fachebene per `aria-describedby`, Klassenlegende unter
  dem Knopf (eine Liste darf nicht in einen Knopf). Gruppenschalter `role="checkbox"` mit
  `aria-checked="mixed"`, schaltet nur frei zugängliche Ebenen (`gruppenZustand`/`gruppenZiel`);
  keiner an „Fachebenen“ als Ganzem und an „Hintergrund“. Klappzustand `useBaumKlapp`
  (`lfh:lagekarte:ebenen-gruppen`); „Ebene suchen“ öffnet Gruppen mit Treffern nur für die Dauer
  der Suche und schreibt den Klappzustand nicht. Eine Gruppe mit Fehler-Slot steht offen. Kopf
  (Kartenansicht, „Ebene suchen“) rollt mit, Segmentleiste und Modus-Band stehen. Die
  Kartengrundlage steht im Baum nur unter `md` (ab `md` über der Karte). Bild-Hintergründe haben
  ihre eigene Zeilenform (`BildHintergruende.tsx`: Schalter, Deckkraft, Menü). Nachweis
  `e2e/lagekarte-ebenenbaum.spec.ts` (1440 × 900 ohne Rollen, Handschuh-Maße).
- **Kartengrundlage** (LFH-558, Spec `lagekarte-kartengrundlage`, Herleitung D6 in
  `openspec/changes/archive/2026-09-30-lfh-558-lagekarte-kartenpfade-fixture-basemap/design.md`):
  die Karte entsteht mit dem Blindstil, der Style der Ansicht kommt per `setStyle`. Jeder
  angewandte Style öffnet ein eigenes Abstufungsfenster bis zu seinem `style.load`
  (`stilFehlerWaechter.ts`); darin zählt jeder Fehler ohne `tile`, also wirft die Karte dort
  selbst keinen (`getSource` vor `isSourceLoaded`).
  Browser-Nachweis mit der Fixture-Basemap (`e2e/kartenFixture.ts`, „gelesen“ = dekodiert):
  `e2e/lagekarte-kartengrundlage.spec.ts`, `e2e/lagekarte-kachelpfad.spec.ts`.
- **Zeichen auf dunkler Grundlage rastern mit dem Render-Theme `dark`** (LLH-1141, Spec
  `lagekarte-taktische-zeichen`): ist das aufgelöste Kartenthema `dark` (`loeseKartenTheme`, Prop
  `kartenTheme` der `Kartenflaeche`), rastert jedes Zeichen (Fachobjekt und freies Zeichen) mit
  `ZEICHEN_THEME_DUNKEL` (`zeichen/zeichenTheme.ts`, Theme `dark` von @einsatzzeichen, ESZ-119):
  weiße Hinterlegung eng an der Tinte, Kopfmarken und Fahrwerk weiß, Körper unverändert; am Tag
  ohne Theme. Keine helle Fläche hinter dem Zeichen, kein eigenes Einfärben oder Invertieren. Das
  Thema steht im Bildschlüssel (`ez|dark|…`, nur `markerIconKey`/`baueZeichenRegistry` bilden
  ihn): ein Wechsel gibt jedem Marker ein neues Bild, kein Neuladen. Gezeichnet wird nur über
  `zeichneKartenZeichen` (`zeichenDichte.ts`), nie direkt über `addSymbolImage`. Der Lageplan
  zeigt die Karte, wie sie steht. Die Inspector-Kachel eines Fachobjekts nimmt auf dunklem Paneel
  dasselbe Theme. Nachweis `e2e/lagekarte-zeichen-kontrast.spec.ts` (Pixel, ≥ 3 : 1).
- **Vertagte Kartendaten tragen einen Schlüssel** (LFH-943, D2/D3 in
  `openspec/changes/archive/2026-10-05-lfh-943-945-lagekarte-ressourcen/design.md`):
  `wendeKartenDatenAn(map, schluessel, anwenden)` hält je Karte und Schlüssel höchstens eine
  wartende Anwendung; die Schlange läuft in der Folge der letzten Anmeldung (zuletzt angemeldet
  liegt oben), sofort nur bei leerer Schlange. Bereit ist der angewandte Stil (`style._loaded`),
  nie `isStyleLoaded()` — das wartet auf jede Kachel. Eine neue Ebene bekommt einen eigenen
  Schlüssel; Daten, die je Render neu entstehen, vergleicht der Effekt vorher mit dem Inhalt
  (Abschnitte, LFH-945).
- **Ein aufgefächertes Bündel überlebt eine reine Inhaltsänderung** (LFH-668,
  `openspec/changes/archive/2026-10-01-lfh-668-betroffenen-karte-schleuse/design.md`, D5): gleiche Schlüssel in gleicher
  Folge an gleicher Lage (`nurInhaltGeaendert`, `spiderfy.ts`) → Blätter bleiben stehen und nehmen die
  neuen Eigenschaften (`aktualisiereSpiderBlaetter`), die Hülle des neu gebauten Donuts bleibt
  durchlässig; sonst klappt der Spider zu. Verglichen wird mit dem EINGESPIELTEN Stand
  (`wendeKartenDatenAn` kann vertagen). `onSpiderOffen` meldet nur Wechsel, A→B ohne
  Zwischen-`false`; `KartenHandle.klappeSpiderEin()` klappt von außen ein.
- Nachweise: `e2e/lagekarte-smoke.spec.ts`, `e2e/gate1-ueberlauf.spec.ts`,
  `e2e/lagekarte-touch.spec.ts` (LFH-713, `hasTouch`, Trefferwache `elementFromPoint`), `fokus-verdeckung.spec.ts`; Kartenaufbauten sieht
  `e2e/fokus-kern.ts` nur über `zusatzKandidaten`, das Abschneiden der nachgiebigen Zeitachse nur
  über `beschnitt` (LFH-811: Tab/Shift+Tab in jedem Kartenmodus bei 390 und 768 px).

**Zeichnen und Messen**

- **Messwerkzeug**: exklusiver Modus in `useKartenInteraktion`, ohne Schreibrecht, per Escape
  beendbar, Stand über `messQuelle.ts`; `messZeichnung.ts` nimmt nur die gewählte Geometrie.
  **Jede terra-draw-Instanz eigener `prefixId`** (`td-abschnitt`/`td-zone`/`td-mess`), **immer
  mit `td-`** (Wächter `zeichnungPraefix.guard.test.ts`): die Eigenposition liegt über den
  Lagedaten, aber unter der ersten `td-*`-Ebene (LFH-766,
  `openspec/changes/archive/2026-10-02-lfh-766-eigenposition-anflug-genauigkeit/design.md` D3);
  Messung vor `setStyle` räumen, nach `style.load` neu.
- **Controller vor `map.remove()`** (LFH-943, Spec `lagekarte-ressourcen`,
  `openspec/changes/archive/2026-10-05-lfh-943-945-lagekarte-ressourcen/design.md` D1): die
  terra-draw-Controller (Abschnitt, Zone, Messen) und die Bildgriffe baut der Cleanup des
  Karten-Effekts in `Kartenflaeche.tsx` ab, BEVOR er `map.remove()` ruft. Ein eigener Abbau-Effekt
  liefe erst danach (Deklarationsreihenfolge), terra-draws `stop()` schriebe auf eine fehlende
  Quelle, und der Modulwechsel endete in der Fehlerseite. `zerstoeren()` fängt einen Wurf
  trotzdem ab. Nachweis `e2e/lagekarte-modulwechsel.spec.ts`.
- **Lageplan** (LLH-1051, Spec `lagekarte-druck`): Druck und Anlage nur über
  `KartenHandle.nimmBildAuf` (`kartenAufnahme.ts`: `once('render')` + `toBlob`, kein
  `preserveDrawingBuffer`, kein Warten auf Kacheln). DOM über der Karte gehört nicht aufs Bild;
  die Bündel-Donuts sind DOM und kommen als Daten (`donutBild`) mit, `lageplanBild.ts` zeichnet
  sie nach. Legende nur aus dem Gezeichneten (`lageplan.ts`: Marker, Flächen, `zonenFeatures`,
  aktive Fachebenen, sichtbare Bilder), nie aus den Schaltern. Anlage nur mit Art `lageplan`
  über den bestehenden Anlagen-Weg; ein neuer Lagevortrag über die API, nie über die Seite.
- **Zeichnen per Link** (LFH-825, Spec `lagekarte-zeichnen`,
  `openspec/changes/archive/2026-10-03-lfh-825-zeichnen-deeplink-lagekarte/design.md`): `?zeichnen=<zonentyp>[:flaeche|:linie]`
  liest `LagekartePage` als **Literal** (Guard der Sprungpalette), wartet auf `ladt`, startet nur
  mit `darfSchreiben` über `onZoneZeichnenStart` (stabil per `useCallback`) und räumt immer.
  Typ und Form prüft `parseZeichnenAuftrag` (`routing/deeplinks.ts`), die Geometrie
  `zeichenAuftragZuEntwurf` über `ZONE_TYPEN`; die Farbe der freien Skizze ist
  `FREIE_SKIZZE_VORGABEFARBE`, für Werkzeugmenü und Link dieselbe. Das Zonen-Zeichnen startet in
  `Kartenflaeche` erst mit angewandtem Style-JSON (Merker ab `style.load`, nie
  `isStyleLoaded()` — das wartet auf Kacheln) und beginnt nach `setStyle` neu wie die Messung.
  **Bezug `&bezirk=<id>`** (LLH-1069, Spec `betreuung-lagekarte`): nur am Typ
  `evakuierungsbezirk` (`parseZeichnenBezug`, sonst ganzer Auftrag `null`), wartet zusätzlich auf
  `rechteBekannt` und `bezirkeGeladen`, startet nur mit freiem Modul Evakuierung für einen Bezirk
  der Kartenliste (`lagekarte/bezirkZeichnen.ts`) und räumt `zeichnen` und `bezirk` zusammen. Der
  Entwurf trägt `bezirk`: POST mit `label` und `evakuierungsbezirk_id`, keine Serie, danach der
  Modus `gebietGezeichnet` (Rückmeldung wie `verortet`, Rückweg nur aus der Kennung).
- **Kreis um einen Punkt** (LLH-1043, Spec `lagekarte-zeichnen`): Zonen-Form `kreis` ohne
  terra-draw (dessen Kreis-Modus sperrt im Zieh-Zug das Verschieben und geht am Touchschirm im
  Klick-Zug nicht). Band `KreisSteuerung.tsx` (Zahl + Schnellwahl als Hauptweg), Vorschau und
  Radius-Griff in `kreisVorschau.ts` (Ebenen `td-zone-kreis-*`, keine Klickebene, Griff vor
  `map.remove()` abbauen). **Das Polygon rechnet der Server** (`lage_zone::kreis_polygon`, 64
  Ecken); `geo.ts` `kreisPolygon` ist nur Vorschau, beide pinnen ≤ 1 % bei 54° N. Grenze
  `KREIS_RADIUS_M_MAX` gespiegelt. Link `?zeichnen=<typ>:kreis&radius=<m>&mitte=<lat>,<lon>` ist
  ein stabiler Vertrag: `radius`/`mitte` liest `LagekartePage` als Literal, verwirft sie einzeln
  (`parseKreisVorbelegung`) und räumt alle drei. Esc: Figur = Mitte. Eine neue Geometrie per PATCH
  löscht die Kreisangaben. Mit Bezug (`evakuierungsbezirk:kreis&bezirk=<id>`) trägt der Kreis ihn
  wie die Fläche: POST mit `kreis`, `label` und `evakuierungsbezirk_id`, keine Serie, Art fest.
- **Zone bearbeiten** (LLH-1344, Spec `lagekarte-zeichnen`): Einstieg nur im `ZonenInspector`
  („Punkte bearbeiten“, an einer Kreiszone „Mitte verschieben“), nie im Werkzeugmenü. Punktweise
  ist ein eigener exklusiver Modus `bearbeiten` (Stand rein in `zonenBearbeitung.ts`, Karte in
  `zonenBearbeitungKarte.ts`: Ebenen `td-zone-bearbeiten-*`, keine Klickebene, Griffe als Marker
  ≥ 44 px, gedrängte Griffe per `sichtbareGriffe` weg, Abbau vor `map.remove()`), kein
  terra-draw-Auswahlmodus (Entfernen nur per Rechtsklick). Die Mitte ist der Kreis-Modus mit
  `entwurf.bearbeiten` (Art fest, keine Serie; Mittengriff in `kreisVorschau.ts`, nur mit
  Radius). „Übernehmen“ = genau EIN PATCH (`geometrie` bzw. nur die geänderten
  `kreis_mitte_lat/lon`, `kreis_radius_m`); das Polygon rechnet der Server. Esc: Figur = Abweichung
  vom Gespeicherten. Die bearbeitete Zone fehlt in der Zonenebene (`zonenKarte` der Seite); nach
  Übernehmen/Abbrechen ist sie wieder gewählt.
- **Werkzeugmenü an der Karte** (LLH-1038, Spec `lagekarte-zeichnen`): der Knopf
  „Zeichenwerkzeuge“ (nur mit Schreibrecht) klappt `Werkzeugmenue.tsx` auf, das im `KartenFuss`
  steht (Zustand in der Seite, Knopf mit `aria-expanded`/`aria-controls`). Kein Popover am Knopf,
  kein `PunktankerMenue`, keine Klickebene, kein `contextmenu`. Einträge nur aus `werkzeugZeilen`
  (`werkzeugZeilen.ts`, rein über `ZONE_TYPEN`: Hauptknopf = Vorgabeform des Links, daneben
  „Linie“/„Kreis“). Taktisches Zeichen: „Zuletzt verwendet“ startet direkt, „Weitere …“ öffnet
  `ZeichenWahlDialog` (der Entwurf lebt dort), ein laufendes Zeichen zeigt nur „wird platziert“.
  Offen nimmt es Esc (eigener Zuhörer mit `preventDefault`; `escGehoertOverlay` kennt
  `[data-lfh="werkzeugmenue"]`), ein Druck außerhalb von Menü und Knopf schließt es, jeder Eintrag
  gibt den Fokus an den Knopf. Messen ist kein Eintrag (eigener Knopf, Formen in
  `MessSteuerung`). Die Leiste trägt keinen Zeichenweg; nur „Fläche zeichnen“ an einem nicht
  verorteten Abschnitt verortet ein Objekt.
- **Esc beim Zeichnen ist zweistufig** (LFH-712, Entscheidung 28.09.2026): erstes Esc verwirft
  die Figur mit Quittung, der Modus bleibt; Esc ohne Figur beendet ihn (Messen: ein Esc). Stufe
  aus `lagekarte/zeichnenEsc.ts`, **ein** `keydown`-Zuhörer der Seite, terra-draw-Modi mit
  `keyEvents: { cancel: null }`. Offene antd-Overlays schließen per eigenem `window`-keydown
  **ohne** `preventDefault` → Riegel `escGehoertOverlay`, `defaultPrevented` allein reicht nicht.
  Punktzahl aus terra-draws `history`, nie aus DOM-Klicks (die laufen an terra-draw vorbei).

**Abschnittsfokus**

- **Fokus ist Darstellung, kein Filter** (LLH-1057, Spec `lagekarte-abschnitt-fokus`): Zustand
  nur in `useAbschnittFokus.ts`, an den Einsatz gebunden, nie in Ansicht, Gerätespeicher oder
  URL. Fremde Kräfte (Einheiten, Fahrzeuge, Abschnittszeichen und -flächen fremder Abschnitte;
  eigen = Abschnitt samt Unterabschnitten, Einheiten nach `abschnittDerEinheit`) bekommen
  `gedaempft: true` (`daempfeMarker`/`daempfeFlaechen` in `abschnittFokus.ts`); die Layer lesen
  es datengetrieben über `deckkraftImFokus` (`markerLayer.ts`). Nie aus der Liste filtern —
  Ebenenbaum, Zähler, Suche und Klickziele sehen den Fokus nicht. Ohne Fokus kommt dieselbe Liste
  zurück (Identität, LFH-945). Ein Bündel tritt nur zurück, wenn alle Blätter gedämpft sind
  (LLH-1349): die Cluster-Aggregation zählt `ungedaempft` (`clusterTypProperties`), 0 heißt
  gedämpft (`buendelGedaempft`, Donut und `donutBild` für den Lageplan); ein gemischtes bleibt voll.
- Einstieg in der Karte nur über „Abschnitt fokussieren“ im `Inspector` (Prop
  `onAbschnittFokussieren`), nicht an der Listenzeile; von außen über den Sprung „Auf Karte
  zeigen ↗“ im Detail der Seite Einsatzabschnitte (LLH-1349, `SprungKnopf`, gesperrt ohne Freigabe
  Lagekarte). Band `FokusBand.tsx` im `KartenFuss`. Kamera über
  `KartenHandle.fokussiere`/`stelleKameraHer` (`fokusKamera.ts`, `BEDIENUNG`): der Stand vor dem
  ersten Fokus bleibt beim Wechsel A → B. Esc nur bei aktivem Fokus und ohne Modus: erst ein
  offenes Bündel, dann die Auswahl, dann der Fokus (`escZiel`; der Auswahl-Zuhörer der Seite und
  dieser nehmen die Taste, wer sie genommen sieht, tut nichts). Ein Abschnitt ohne Fläche kommt
  über die Objektliste in den Inspector (siehe „Objekte = eine Liste“). `?abschnitt=<id>` liest die Seite als Literal, wartet auf
  `ladt` und `start`, räumt immer.

**Zielgliederung der Leiste (LLH-1023, Entscheidung 20.10.2026) — Zielbild, noch nicht gebaut**

Vorgabe für jeden Umbau der Kartenleiste. Bis ein Punkt gebaut ist, gelten die Regeln oben
unverändert; das Ticket, das ihn baut, schreibt die betroffene Regel oben und die Specs fort und
streicht den Punkt hier. Zustände und Entwurf: `docs/design/2026-10-20-lagekarte-leiste/README.md`.

- **Die Leiste bleibt 300 px** und Inhalt (Kopf, LFH-557): keine Reiter am Kartenrand, kein
  Drawer, keine neue Breite. Ein neuer Klappzustand bekommt einen Schlüssel in `GERAETESPEICHER`.
- **Reihenfolge:** LLH-1028 (Gerüst, Modus-Band, Ebenenbaum), LLH-1033 (Objekte, Auswahl),
  LLH-1038 (Werkzeugmenü samt Kreis als Form) und „Abschnitt fokussieren“ (LLH-1057) sind gebaut
  (Regeln oben).
