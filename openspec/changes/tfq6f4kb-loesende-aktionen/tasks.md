# Tasks

Jede Aufgabe mit Verhaltensänderung entsteht per TDD: zuerst der Test, der ohne die Änderung rot
ist. Pfade im Frontend relativ zu `frontend/src/`.

## 1. fx4335q2: Muster festlegen (Regel, ADR, Bausteine)

- [x] 1.1 `frontend/AGENTS.md`, Bedien-Leitlinie: Block „Beenden: Verb, Ort und Sicherung je Art“ (D1) unter „Aktionen“; „Destruktiv ist nicht gleich destruktiv“ um die Menüregel (D2) schärfen; Kopfregel (D3) bei „Genau eine Primäraktion“; „Bearbeiten in der Ansicht“ und „Form nach Umfang“ um D8 samt Altstellenliste ergänzen; „Rückwege und Fehler“ nennt die Lücke bei Personal und Material. Prettier über `frontend/` grün
- [ ] 1.2 Neue ADR `docs/architektur/entscheidungen/ADR-<nächste>-…` (Nummer größer als jede auf `origin/alpha`) mit Regeln aus D1–D4 und einer `## Prüfung`, die mindestens „kein `aktion`-Slot mit Entlassen in Kräfte-Listen“ und „Stornieren nicht als sichtbarer Knopf“ als `verbiete` prüft; `scripts/adr-fuer.sh` nennt sie für die betroffenen Seiten, ADR-Wächter grün
- [x] 1.3 `useHoldGeloest` nach `components/useHoldGeloest.ts` herauslösen (D7), MaterialAmOrt darauf umstellen; `kraefte/MaterialAmOrt.test.tsx` unverändert grün
- [x] 1.4 MaterialAmOrt: gehaltene Zeile trägt „Rückgängig“ an der Stelle der Statuswahl, nicht am beendeten Ort (Spec `material-am-ort`); Test „Rückgängig in der gehaltenen Zeile“ und „zwei Tipps auf Lösen treffen nie Rückgängig“ rot→grün
- [x] 1.5 Wächter der Menüfarbe: ein Lösen-, Entlassen- oder Austragen-Eintrag mit `gefahr` ist rot (Test in `components/`, Gegenprobe mit einem präparierten Eintrag)

## 2. zjnw0rkj: Fahrzeug „Entlassen“ vollständig zurücknehmen

- [x] 2.1 Prüfen, dass `…/fahrzeuge/{ef}/entlassen` nicht zur öffentlichen API v1 gehört (`src/AGENTS.md`, `src/api_doc.rs`); Ergebnis im Commit nennen
- [x] 2.2 Repo: `entlassen_tx` liefert den Vorzustand (D5) inkl. `status_id`, `status_seit`, `zuletzt_entlassen_at`, `fuehrungsstelle_id`, `beladung`; Repo-Test in `src/fahrzeug/disposition_repo.rs` rot→grün
- [x] 2.3 Repo: `zuruecknehmen_tx` mit Riegel (Aufrufer, Art, `entlassen_at`, zehn Minuten), Status ohne Zeitachse, Bindungen nur frei, `ausgelassen`; Repo-Tests je Teil und je Auslassung (Spec `kraefte-entlassung`, „Rücknahme lässt Verändertes aus“, „Rücknahme nur direkt nach dem Entlassen“)
- [x] 2.4 Route `POST …/entlassen/zuruecknehmen` in `src/routes/einsatz_fahrzeug.rs` und `src/app.rs` (Gate `EinsatzSchreibzugriff<Fahrzeuge>`, `fordere_zielmodul` für Einheiten, Material, Raum), ETB „Entlassung zurückgenommen“, Live-Meldungen wie beim Entlassen; Antwort von `…/entlassen` als `{ fahrzeug, vorzustand }`; `src/api_doc.rs`
- [x] 2.5 Integrationstest in `tests/einsatz_fahrzeug.rs`: Szenario „Entlassen und Rückgängig“ vergleicht den Zustand vorher und nachher (Status, Status seit, Einheit, Besatzung, Raum, Führungsstelle, Beladung), dazu 409 nach Reaktivieren und für eine andere Person
- [x] 2.6 Typ-Codegen (`scripts/check-typ-codegen.sh`), `api/openapi.json` und `api/types.generated.ts` mitcommitten
- [x] 2.7 Frontend: `api/einsatzFahrzeuge.ts` (`entlasseDisposition` mit Vorzustand, neue `nimmEntlassungZurueck`); `pages/FahrzeugePage.tsx`: Rückgängig ruft die Rücknahme mit dem gehaltenen Vorzustand, `ausgelassen` erscheint im `SeitenHinweis`; Kommentar an `entlassenMutation` berichtigen; Tests in `pages/FahrzeugePage.test.tsx` („Rückgängig nimmt die Entlassung zurück“, „nennt Ausgelassenes“) rot→grün
- [x] 2.8 Karte: kein `aktion` „Entlassen“, Menü der Karte beginnt mit „Entlassen“ (neutral), Status bleibt im Titel; Tests `:853`, `:1174` umschreiben; `e2e/gate1-ueberlauf.spec.ts` und `e2e/kraefte-schmal.spec.ts` nachziehen
- [x] 2.9 Doku: `docs/anwender/kapitel/fahrzeuge.md` (Entlassen und Rückgängig, Karte), Bilder-Spec und Bilder des Kapitels neu erzeugen

## 3. d9x8cge8: „Aus Einheit lösen“ mit Rückweg, Zeile hält ihre Stelle

- [x] 3.1 Backend: `PUT …/einheiten/{eid}/fahrzeug/{ef}` mit `?nur_wenn_frei=true` antwortet 409 mit der Einheit, wenn das Fahrzeug in einer anderen steht; ohne Parameter unverändert; Test in `tests/einsatz_einheit.rs` rot→grün
- [x] 3.2 Backend: `PUT …/einheiten/{eid}/personal/{ep}` mit `?nur_wenn_frei=true&als_fuehrer=true` (und `fahrzeug_id`, falls das Lösen das Fahrzeug der Person löst — in `mitglied_repo.rs` prüfen) stellt Mitgliedschaft, Fahrzeug und Führerrolle in einer Transaktion her; besetzter Führerplatz wird genannt; Tests rot→grün; Typ-Codegen falls Antwort sich ändert
- [x] 3.3 `pages/einheit/einheitAnsichtKern.ts`: Fahrzeug-Menü-Builder mit „Aus Einheit lösen“ (neutral, nur mit Schreibrecht Einheiten); Personen-Lösen-Einträge neutral; Tests in `einheitAnsichtKern.test.ts` rot→grün
- [x] 3.4 `pages/einheit/FahrzeugeBesatzung.tsx`: roter Zeilenknopf weg (Baum- und flacher Zweig), ⋮ mit Zeilenkennung, Kontextmenü am Namensteil (Spec `datensatz-aktionsmenue`, Zeilen mit Reglern); gehaltene Zeile „Gelöst · Rückgängig“ über `useHoldGeloest` mit gedämpfter Besatzung; Toast; Rückgängig mit `nur_wenn_frei`, Ablehnung im Seitenhinweis; Tests in `FahrzeugeBesatzung.test.tsx` und `EinheitDetailPage.test.tsx` (Doppeltipp löst ein Fahrzeug, Rückgängig in der Zeile, 409 nennt die andere Einheit) rot→grün
- [x] 3.5 Personen: Rückgängig-Hinweis nach „Aus Einheit lösen“ und „Vom Fahrzeug lösen“, inkl. Führerrolle; Test rot→grün
- [x] 3.6 Wächter und e2e: `components/aktionsabstand.guard.test.ts` (Eintrag FahrzeugeBesatzung streichen), `e2e/einheit-fixture.ts` (`fahrzeugLoesen` als Menüziel), `e2e/gate3-trefflaeche.spec.ts`, `e2e/fokus-verdeckung.spec.ts`, `e2e/einheit-ansicht.spec.ts` nachziehen
- [ ] 3.7 Doku: `docs/anwender/kapitel/einheiten.md` (Schritt „Aus Einheit lösen“ im ⋮, Rückgängig), Bild `einheiten/besatzung.png` neu erzeugen

## 4. fx4335q2: Beenden und Kopf in den übrigen Modulen nachziehen

- [ ] 4.1 Bereitstellungsraum (`pages/bereitstellungsraum/BrDetailPage.tsx`): „Stornieren“ aus dem sichtbaren Kopf ins ⋮ des Kopfs mit Dialog „BR stornieren“; „Auflösen“ als letzter Abschnitt mit Rückfrage; Kopf ≤ 2 Knöpfe; Tests rot→grün; `components/rueckfrage.guard.test.ts` grün
- [ ] 4.2 UHS (`pages/uhs/UhsDetailPage.tsx`): „Auflösen“ als letzter Abschnitt (Sperre „noch n Personen“ bleibt), Kopf „Patient aufnehmen“ + „Bearbeiten“ ohne `BreiteHalten`-Reserve für Auflösen; Tests rot→grün
- [ ] 4.3 Evakuierungsbezirk (`pages/EvakuierungsbezirkPage.tsx`): „Bearbeiten“ ins ⋮ des Kopfs, Kopf ≤ 2 Knöpfe; Test „Kopf in einer Zeile bei 1180 px“ (e2e) rot→grün
- [ ] 4.4 Betreuungsstelle (`pages/BetreuungsstelleDetailPage.tsx`): „Schließen“ ohne Belegung zeigt Rückgängig (zurück auf `in_betrieb`), mit Leermeldung nicht; Kopf ≤ 2 Knöpfe prüfen; Tests rot→grün
- [ ] 4.5 Verpflegungsstelle (`verpflegung/StellenListe.tsx`): Ellipse an „Auflösen …“/„Stornieren …“ entfernen; Test nachziehen
- [ ] 4.6 Übrige Stellen aus dem Inventar gegen D1 prüfen (Tier, Schaden, Person, Einsatzabschnitt, UhsKraefte „Abziehen“, BR „Austragen“, Material, Personal); Abweichungen beheben oder im Commit begründen; Kopfregel an Tier und Schaden prüfen
- [ ] 4.7 Doku: Kapitel `uhs`, `bereitstellungsraeume`, `betreuung`, `evakuierung` (und Verpflegung, falls betroffen) samt Bilder-Specs nachziehen und Bilder neu erzeugen; Mitänderungsregel `docs/architektur/AGENTS.md` (Kapitel 8/11) prüfen

## 5. Folgeaufgaben und Integration

- [ ] 5.1 Folgeaufgaben über `zunder-task-anlegen` am Parent: UHS/BR in der Ansicht bearbeiten; Anlegen vereinheitlichen; Personal-Entlassen vollständig zurücknehmen; Material „Aus dem Einsatz nehmen“ vollständig zurücknehmen; Material am Ort: Vorbedingung beim Rückgängig. Links in `frontend/AGENTS.md`-Altstellenliste und im PR
- [ ] 5.2 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, dazu die geänderten e2e-Specs einzeln grün

## Workflow follow-up

- Review vor dem PR (Phase 4 von `dev-zunder-orchestrieren`), bestätigte Befunde behandeln.
- `/opsx:archive tfq6f4kb-loesende-aktionen` im selben Branch, Verweise auf den Change-Pfad nachziehen.
- PR gegen `alpha` mit Bildern und Abschnitt „Review“.
