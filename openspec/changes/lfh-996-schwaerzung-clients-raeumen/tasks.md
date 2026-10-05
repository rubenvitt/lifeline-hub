# Tasks

## 1. Backend: Schwärzungsstand im Kopf (D1)

- [ ] 1.1 Test zuerst (rot): nach dem Vollzug eines Personen-Antrags trägt `GET /api/einsaetze/{id}`
  `teilschwaerzungen: 1`, die Einsatzliste ebenso; nach einer Kategorie-Schwärzung zusätzlich
  eins mehr; ohne beides fehlt das Feld (Presence per `contains_key`, `src/AGENTS.md`,
  Typ-Codegen). Ein vollzogener Einsatz-Antrag zählt nicht.
- [ ] 1.2 `EinsatzAnzeige.teilschwaerzungen: Option<i64>` mit `skip_serializing_if`, Zählung als
  Unterabfrage in Kopf-Laden und `liste_fuer` (design.md D1). Tests aus 1.1 grün.
- [ ] 1.3 `scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts` mitcommitten.

## 2. Backend: Meldungen des Purge-Laufs (D2)

- [ ] 2.1 Test zuerst (rot): ein Abonnent des Einsatzes erhält `einsatz` nach dem Vollzug eines
  Personen-Antrags, eines Einsatz-Antrags, nach einer Kategorie-Schwärzung und nach der
  Vormerkung in Phase A; kein `einsatz` nach einem Vollzug ohne Wirkung und nach Phase B.
  Ein Org-Abonnent unter den Lesern erhält in den vier Fällen `einsatzliste`.
- [ ] 2.2 `live::org::kopf_melden(pool, live, einsatz_id, zusaetzlich)`;
  `routes::einsatz::kopf_geaendert_fuer` darauf umstellen (bestehende Tests der Kopf-Ereignisse
  bleiben grün), Phase A, `vollziehe_faellige` und K2 rufen sie nach dem Erfolg. Tests aus 2.1
  grün.
- [ ] 2.3 Mutationsprobe: den Aufruf in `vollziehe_faellige` für `Vollzug::Person` entfernen, 2.1
  muss rot werden; zurückdrehen.

## 3. Frontend: Wächter und Räummarke (D3, D4)

- [ ] 3.1 Tests zuerst (rot, eigener `QueryClient`): steigender Stand im Kopf entfernt unbeobachtete
  Queries des Einsatzes, ruft beobachtete neu ab (auch ein Personendetail), lässt den Kopf und
  andere Einsätze stehen; gleicher oder erster Stand räumt nichts; ein aus der Liste
  verschwundener Einsatz setzt die Sperrmarke und entfernt seine unbeobachteten Queries; ein
  neuer Einsatz ohne Vorgänger bleibt; ein Fehlerabruf der Liste löst nichts aus.
- [ ] 3.2 `frontend/src/offline/schwaerzungsWaechter.ts` nach D3/D4, eingehängt in
  `erzeugeQueryClient`. Tests aus 3.1 grün.

## 4. Frontend: Platte und Vorrat (D5)

- [ ] 4.1 Tests zuerst (rot): `lagebildStandZulaessig` lehnt einen Stand vor der Räummarke ab;
  ein beobachteter Query mit altem Stand wird nach dem Anstoß nicht dehydriert; ein Vorrat-Eintrag
  des Einsatzes fällt bei der nächsten Speicherung, der eines anderen Einsatzes bleibt; Vorbelegung
  aus dem Vorrat: Kopf im Vorrat ohne Feld, erste Liste mit `teilschwaerzungen: 1` → Vorrat des
  Einsatzes fällt (Szenario „zwischen zwei Sitzungen“); Liste im Vorrat mit Einsatz 7, neue Liste
  ohne → Vorrat von 7 fällt.
- [ ] 4.2 Vierte Bedingung in `lagebildStandZulaessig`, Vorbelegung des Wächters in `abonnieren`
  (`lagebildSitzung.ts`). Tests aus 4.1 grün, Bestandstests unter `frontend/src/offline/` grün.
- [ ] 4.3 Mutationsprobe: die Räummarken-Bedingung in `lagebildStandZulaessig` entfernen, 4.1 muss
  rot werden; zurückdrehen.

## 5. Regeln und Abschluss

- [ ] 5.1 `frontend/src/offline/AGENTS.md`: Abschnitt zum Räumen nach Schwärzung (Räummarke,
  verschwundener Einsatz, Queue bleibt) mit Verweis auf diese Change; `src/AGENTS.md`,
  Org-Ereignisse: `kopf_melden` als gemeinsamer Weg, Aufbewahrung: Meldungen des Purge-Laufs.
  Prettier über `frontend/`.
- [ ] 5.2 `./scripts/check-all.sh` grün (Umgebungsrot nach Gegenprobe gegen `alpha` benannt),
  Vitest und Rust-Tests grün.
- [ ] 5.3 Code-Review (`superpowers:requesting-code-review`), Befunde eingearbeitet.
- [ ] 5.4 `/opsx:archive` im selben Branch, danach der PR gegen `alpha`.
