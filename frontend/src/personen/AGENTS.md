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
  Patientenkopf (`personen/Patientenkopf.tsx`: Sichtung mit DTG und „vor n min“, „Zustand /
  Verdacht“, Aufenthalt bzw. Verbleib, letzte Notiz), Verlauf, Personendaten, eingeklappt Bezüge,
  Fotos und Dateien, Zugriffsprotokoll; ein Baum. Sichten, Verbleib und Notiz gehen im Kopf ohne
  Dialog (eigenes Paneel je Handlung, Grund am Ort); der Kopf hat eine Lesefassung (`modus="lesen"`)
  für Schnellansichten. Den Aufenthalt (UHS- und Platzname, seit) liefert der Detail-GET
  (`aufenthalt`), kein zweiter Abruf beim Öffnen. Personendaten im `Datenraster`, leere Angaben
  in EINER Zeile „Ohne Angabe: …“, kein `Descriptions`. Nachweis: `e2e/betroffene-handy.spec.ts`.
- **Bezüge** (LLH-1129): Tier und Schaden als EINE Liste in Einsatzsprache
  (`personen/PersonBezuege.tsx`), „Bezug hinzufügen“ über eine gemeinsame Suche freier Tiere und
  Schäden (`BezugHinzufuegenDialog`, XOR-Leerung im selben PATCH), „Bezug lösen“ mit Grund an der
  Zeile; lädt erst aufgeklappt. Der Aufenthalt in einer UHS ist kein Bezug, er steht im Kopf
  („In UHS aufnehmen“, „Verlegen“, „Austragen“; nicht am Gerät).
- **`SK_META`** führt Schlüssel von `sichtungsfarben` oder `null`, keine CSS-Werte.
- **Verortungsauftrag** per `lagekartePfad(…, { platzieren })` → `?platzieren=<typ>:<id>`;
  `parsePlatzierenAuftrag` verwirft Unbrauchbares ganz; die Karte räumt den Parameter und betritt
  den Modus nur mit Schreibrecht, bei `person` zusätzlich nur mit freigegebenem Modul „Personen“
  (`personenZugriff === 'frei'`, LFH-670). Koordinaten in der Schadens-Erfassung: LFH-453.
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
