# Personen und Sichtung — Regeln

Gilt für `frontend/src/personen/`, `pages/personen/`, `pages/PersonenPage.tsx` und
`pages/PersonenDetailPage.tsx`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

- **Sichtung geht mit dem Anlegen mit** (`POST …/personen` mit `sichtung`, eine Transaktion,
  unter `war_neu`) — kein nachgeschobener Request (Offline-Idempotenz). Mit `vermisst` 422,
  unbekannte Kategorie 400.
- **Eine Sichtungswahl für jeden Ort** (LLH-1083, Spec `sichtungswahl`): `personen/SichtungsWahl.tsx`
  in der Erfassung (`abwaehlbar`, eine zurückgenommene Wahl heißt „ohne Sichtung“), in der
  Nachsichtung (`SichtungFelder` in `SichtungDialog.tsx`, Fläche + „Übernehmen“) und überall, wo
  später gewählt wird. Reihenfolge `SK_REIHE` (`personMeta.ts`), kein `Select` für die Sichtung.
- **Eine Erfassungsmaske ist ein Bauteil, kein Ort:** `personen/AufnahmeFelder.tsx` (ohne
  `<Form>`) für Modal und `/einsaetze/:id/personen/aufnahme`; Budget verschieben, nicht dehnen.
- **Eine Maske „Betroffene erfassen“, ein Wort „erfasst“** (LFH-963, Spec `betroffene-erfassung`,
  Entscheidung 9): Kopfknopf, `?neu=1` und Aufnahme-Route öffnen dieselbe Maske
  (`AufnahmeModus` `erfassen | vermisst`), neben ihr nur „Vermisst melden“. Angelegt wird mit
  Status `erfasst`; die Maske sagt es (`FOLGESTATUS_HINWEIS`: „mit Sichtung → betroffen“).
  Filter, Tabelle und Dialog nennen den Status gleich („Erfasst“, nie „Neu“). Summen heißen
  „gesamt“, weil „erfasst“ ein Status ist. Unter `xl` steht die `Sichtungszeile` über dem
  Statusfilter (die Seitenleiste rutscht unter die Liste).
- **Personen-Detail** (LLH-1094, Spec `personen-detail`): eine Spalte in fester Folge —
  Patientenkopf, Verlauf, Personendaten, eingeklappt Bezüge, Fotos und Dateien,
  Zugriffsprotokoll; ein Baum. Den Aufenthalt (UHS- und Platzname, seit) liefert der Detail-GET
  (`aufenthalt`), ebenso Transporte, Maßnahmen und Verletzungen: kein zweiter Abruf beim Öffnen.
  Personendaten im `Datenraster`, leere Angaben in EINER Zeile „Ohne Angabe: …“, kein
  `Descriptions`. Nachweis: `e2e/betroffene-handy.spec.ts`.
- **Patientenkopf mit vollem PAT-Kern** (`personen/Patientenkopf.tsx`, Change
  `y18v58dt-pat-kern`, D14): Kopfzeile mit PAT-Nummer und Marke „kontaminiert“
  (`personen/PatKennzeichen.tsx`), darunter ab `lg` zwei Spalten — links Sichtung (DTG, „vor n
  min“, „bestätigt: Name“), „Zustand / Verdacht“, Aufenthalt bzw. Verbleib, Transport; rechts
  Maßnahmen, Verletzungen (Liste, ab `md` Mini-Figur) und letzte Notiz. Maßnahmen und
  Verletzungen höchstens drei, dann „+ n weitere“: bei 1280 × 800 und 1440 × 900 steht alles
  ohne Bildlauf (Nachweis `e2e/personen-detail.spec.ts`). Sichten, Verbleib, Transport, Maßnahme
  und Verletzung haben je ein Paneel, die Notiz eine Zeile; kein Dialog, Grund am Ort. Alle
  Mutationen liegen im Kopf: immer nur ein Paneel offen, der Wechsel ist gesperrt, solange eines
  speichert. Transport, Maßnahme und Verletzung nur mit `darfBehandeln` (am Gerät
  `geraetDarf('person-behandlung')`, nur UHS). Die Lesefassung (`modus="lesen"`) dient den
  Schnellansichten.
- **Ein Schreibweg für die medizinischen Einträge** (`personen/personEintragSpeichern.ts`,
  `useSavePersonEintrag`): Sichtung, Verbleib, Notiz, Transport, Maßnahme und Verletzung gehen an
  jeder Ansatzstelle (Kopf, Zeilen-Sichtung, Sichtungs- und Verbleib-Dialog, Grundriss) über ihn,
  nie direkt über die POSTs aus `api/einsatzPerson.ts`. Ohne Netz merkt er vor (Regeln in
  `frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“); vorgemerkt gibt es keinen neuen
  Serverstand, die Quittung „Offline vorgemerkt“ steht am Ort.
- **Verlauf: jüngster Stand gewinnt** (Spec `personen-verlauf`): jeder Eintrag trägt seine
  Erfassungszeit, der aktuelle Stand (Sichtung, Verbleib, Transport) folgt der jüngsten
  Erfassungszeit, nicht der Ankunft. Ein nachgereichter älterer Eintrag steht im Verlauf
  (`personen/PersonVerlauf.tsx`) zu seiner Zeit mit „nachgetragen …“ (Ankunft mehr als
  `NACHTRAG_SPIELRAUM_MS` nach der Erfassungszeit, `istNachgetragen` in `personMeta.ts`) und
  ändert den Kopf nicht. Aufgehobene Maßnahmen und
  Verletzungen bleiben im Verlauf, mit Zeit des Aufhebens.
- **Transport, Maßnahme, Verletzung** (Specs `personen-transport`, `personen-massnahmen`,
  `personen-verletzungen`): Transport ist ein voller Stand (Priorität, Art, Fachrichtung, alles
  leer hebt auf), Maßnahme und Verletzung werden angehängt und genau einmal aufgehoben (zweites
  Aufheben 409, am Ort). Kataloge und Wörter nur aus `personMeta.ts` (`MASSNAHME_WORT`,
  `VERLETZUNG_ART_WORT`, `transportText` …), Wahl über `personen/FlaechenWahl.tsx`. Die
  Transportpriorität ist ein neutraler Tag mit Wort (`personen/PrioritaetMarke.tsx`): die Sichtung
  bleibt die einzige Farbachse an der Person. Sie sortiert nach der Sichtungskategorie
  (`pages/uhs/dringlichkeit.ts`, D10), nie davor.
- **PAT-Nummer und Kontamination** (LLH-1326): Stammdaten der Person, je einzeln inline über den
  PATCH, nie ohne Netz (gesperrt mit Grund). „kontaminiert“ kommt aus dem Statusvertrag
  (`theme/statusFarben.ts`, Rolle `achtung`, nie `alarm`); „nicht kontaminiert“ trägt keine Marke.
  Die Suche der Liste hängt die PAT-Nummer an die Spalte `reg`, die Palette trifft sie exakt
  (`command-palette/datensaetze.ts`).
- **Körperschema** (LLH-1120, Spec `koerperschema`, D13): ein Baustein
  `personen/Koerperschema.tsx` für Lesen, Markieren und Druck; Geometrie nur in
  `personen/koerperschema/geometrie.ts` (normiert 0..1 je Ansicht, drei Umrisse, eine
  Regionskarte; Guard `geometrie.test.ts`: jeder Mittelpunkt in jedem Umriss), Figur nach
  Geschlecht, Name und Nummer in `koerperschemaKern.ts`. Markieren in zwei Tipps (Region, dann
  Art; Schwere vorher optional), Aufheben am Sternchen; ohne Netz merkt das Markieren vor, das
  Aufheben ist gesperrt mit Grund (die Route trägt weder `client_id` noch Erfassungszeit). Die
  Nummer folgt fest der Erfassungsfolge, auch über aufgehobene (Lücken bleiben). Sternchen in der
  Textfarbe mit Nummer, nie in der Alarmfarbe; Farben nur aus `koerperschemaFarben`
  (`theme/tokens.ts`, Kontrast in `theme/koerperschemaKontrast.test.ts`). Trefferzonen
  mindestens Steuerhöhe, im Handschuh 72 × 72 px auch für Hand, Fuß und Hals
  (`figurMassstab`; Nachweis `e2e/trefflaeche-pruefflaechen.spec.ts`).
- **Bezüge** (LLH-1129): Tier und Schaden als EINE Liste in Einsatzsprache
  (`personen/PersonBezuege.tsx`), „Bezug hinzufügen“ über eine gemeinsame Suche freier Tiere und
  Schäden (`BezugHinzufuegenDialog`, XOR-Leerung im selben PATCH), „Bezug lösen“ mit Grund an der
  Zeile; lädt erst aufgeklappt. Der Aufenthalt in einer UHS ist kein Bezug, er steht im Kopf
  („In UHS aufnehmen“, „Verlegen“, „Austragen“; nicht am Gerät).
- **Zeilenaktionen der Betroffenenliste** (LLH-1130, Spec `betroffene-lagedaten`): die
  Sichtungszelle ist der Auslöser (`personen/ZeilenSichtung.tsx`, Popover mit `SichtungsWahl` und
  „Übernehmen“, Grund an der Zeile), die leere Verbleib-Zelle bietet „Verbleib erfassen“, das
  Zeilenmenü „Sichten“, „Verbleib erfassen“, „Auf Lagekarte verorten“ (mit `zurueck`). Alles über
  `bedienung` von `personenSpalten`; das Gerät gibt nur `darfSichten`, kein Menü. Unter „Nur
  Lücken zeigen“ bleibt eine aus der Zeile geschlossene Lücke stehen, bis sich die Sicht ändert.
  Ein Wort „Fundort“ für `antreff_ort` (Wächter `personen/fundortWort.guard.test.ts`).
- **`SK_META`** führt Schlüssel von `sichtungsfarben` oder `null`, keine CSS-Werte.
- **Verortungsauftrag** per `lagekartePfad(…, { platzieren })` → `?platzieren=<typ>:<id>`;
  `parsePlatzierenAuftrag` verwirft Unbrauchbares ganz; die Karte räumt den Parameter und betritt
  den Modus nur mit Schreibrecht, bei `person` zusätzlich nur mit freigegebenem Modul „Personen“
  (`personenZugriff === 'frei'`, LFH-670). Einstiege von einer Datensatzseite setzen `zurueck: true`;
  danach zeichnet die Karte die Ebene „Betroffene“, ohne den Schalter umzustellen, und bietet
  „Zurück zu R-…“ an (LLH-1125, `frontend/src/pages/lagekarte/AGENTS.md`, „Verortungsauftrag von
  außen“). Koordinaten in der Schadens-Erfassung: LFH-453.
- **Die Kartenansicht hat eine Schleuse** (LFH-668,
  `openspec/changes/archive/2026-10-01-lfh-668-betroffenen-karte-schleuse/design.md`): solange Maus/Stift über der
  Ansicht, der Fokus darin oder ein Bündel aufgefächert ist, halten die Marker Menge, Folge und Lage
  (`personen/kartenSchleuse.ts`); Sichtung und Beschriftung fließen, neu/verlegt/entfallen wartet
  im Sammelbanner der Standzeile (feste Höhe). Entfallene bleiben bis dahin stehen. Touch zählt nur
  über `onSpiderOffen`; Fokus zählt nur von der Tastatur (ein Fokus bis 1 s nach Druck oder Loslassen
  im Bereich räumt die Bedingung, der Canvas ist fokussierbar), ein Druck außerhalb klappt das Bündel ein. Nachweis: `e2e/betroffene-karte-schleuse.spec.ts`.
- **Fotos und Dateien** (LFH-757, Spec `personen-anhaenge`): aufklappbarer Abschnitt der
  Detailseite (`pages/personen/PersonAnhaenge.tsx` über den geteilten Block
  `components/erfassungsAnhaenge/ErfassungsAnhaenge`, `huelle="abschnitt"`, `vorschau={false}`);
  die Liste lädt erst mit dem Abschnitt. Jeder Download steht serverseitig im Zugriffsprotokoll, deshalb nur als bewusster
  Verweis, nie als Vorschau. `personAnhaenge` hängt am `person`-Ereignis, das Detail (`person`)
  bleibt nicht live, und die Anhangliste steht nicht im Lagebild offline.
- **Zugriffsprotokoll** (LFH-916, Spec `personen-zugriffsprotokoll`): nur die Einsatzleitung sieht
  es, die Einsicht selbst ist unprotokolliert und nicht live. Die Listenzugriffe (Export, Druck)
  öffnet der Kopf-Knopf „Listenzugriffe“ der Personenliste als Schnellansicht
  (`personen/ListenzugriffeDrawer.tsx`, lädt erst offen); das Zugriffs-Audit der Detailseite zeigt
  zusätzlich die Listenzugriffe aus dem Erfassungsfenster der Person (Server:
  `person/audit_repo.rs`, `liste_je_person`).
