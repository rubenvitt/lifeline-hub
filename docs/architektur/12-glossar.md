# 12. Glossar

Stand: 23.10.2026 (alpha dcc500f5).

Ein Begriff je Zeile. Wo eine Spec oder ein Design den Begriff festlegt, verweist die Zeile
dorthin, statt ihn neu zu definieren. Begriffe der Oberfläche, die modulübergreifend gelten, legt
Spec [`bedien-begriffe`](../../openspec/specs/bedien-begriffe/spec.md) fest, Modulnamen Spec
[`modul-benennung`](../../openspec/specs/modul-benennung/spec.md) mit dem `label` in
`frontend/src/einsatz/modulRegistry.ts`. Die Begriffe rund um Meldungen stehen in der Tabelle
„Begriffe“ von [`docs/design/2026-10-21-meldungsmodell/README.md`](../design/2026-10-21-meldungsmodell/README.md).

## 12.1 Fachbegriffe

| Begriff | Bedeutung | Quelle |
| --- | --- | --- |
| Ablösung | Ablösen einer Einheit nach ihrer Schicht; eine Zeile ist eine Schicht mit Fälligkeit, geplanter ablösender Einheit und Vollzug. | `src/abloesung/mod.rs`, Spec [`kraefte-abloesung`](../../openspec/specs/kraefte-abloesung/spec.md) |
| Auftrag | Top-down-Strang des Führungsvorgangs (Befehlsgebung, Vollzug, Kontrolle) mit Quittung je Empfänger. | `src/auftrag/mod.rs`, Spec [`auftraege-befehle`](../../openspec/specs/auftraege-befehle/spec.md) |
| Bereitstellungsraum (BR) | Ort, an dem Einheiten und Fahrzeuge auf ihren Einsatz warten; Status `geplant`, `aktiv`, `aufgeloest`. | `BrStatus` in `src/bereitstellungsraum/mod.rs`, Spec [`bereitstellungsraum-belegung`](../../openspec/specs/bereitstellungsraum-belegung/spec.md) |
| Betreuungsstelle | Stelle zur Betreuung und Unterbringung Betroffener. | Modul „Betreuung“ in `frontend/src/einsatz/modulRegistry.ts`, [`frontend/src/betreuung/AGENTS.md`](../../frontend/src/betreuung/AGENTS.md) |
| Betroffene | Modul für Vermisste, Betroffene und Patienten eines Einsatzes. | `frontend/src/einsatz/modulRegistry.ts`, [`frontend/src/personen/AGENTS.md`](../../frontend/src/personen/AGENTS.md) |
| DTG | Taktische Datum-Zeit-Gruppe, etwa `101430okt26`; Vorgabe der Zeitdarstellung. | Spec [`zeitdarstellung`](../../openspec/specs/zeitdarstellung/spec.md), Entscheidung E1 |
| Einheit | Taktische Einheit im Einsatz mit Führer, Mannschaft und Fahrzeug. | `src/einheit/`, Modul „Einheiten“ in `frontend/src/einsatz/modulRegistry.ts` |
| Einsatz | Die Lage, in der gearbeitet wird; gehört genau einer Organisation. | `Einsatz` in `src/einsatz/mod.rs` |
| Einsatzabschnitt | Räumlich oder fachlich abgegrenzter Teil eines Einsatzes mit eigenen Einheiten. | `src/einsatzabschnitt/`, Spec [`einsatzabschnitt-bearbeitung`](../../openspec/specs/einsatzabschnitt-bearbeitung/spec.md) |
| Einsatzbefehl | Freigegebenes Dokument mit Verteiler und Fassungen, dessen Empfang quittiert wird. | `src/befehl/`, Spec [`befehl-quittung`](../../openspec/specs/befehl-quittung/spec.md) |
| Einsatzleitung, Führungspersonal, Beobachter | Die drei Rollen im Einsatz; nur die Einsatzleitung administriert ihn. | `EinsatzRolle` in `src/einsatz/mod.rs` |
| Einsatznummer | Vom System erzeugtes, unveränderliches Aktenzeichen, je Organisation und Jahr fortlaufend. | Spec [`einsatznummer`](../../openspec/specs/einsatznummer/spec.md) |
| ETB (Einsatztagebuch) | Nachweis der Führung; Einträge werden nie geändert, nur berichtigt. | [`frontend/src/etb/AGENTS.md`](../../frontend/src/etb/AGENTS.md), Specs [`etb-vorgaenge`](../../openspec/specs/etb-vorgaenge/spec.md), [`etb-berichtigung`](../../openspec/specs/etb-berichtigung/spec.md) |
| Evakuierung | Räumungsbezirke und ihr Stand evakuiert. | Modul „Evakuierung“ in `frontend/src/einsatz/modulRegistry.ts`, Spec [`betreuung-evakuierung`](../../openspec/specs/betreuung-evakuierung/spec.md) |
| Fernmeldewesen | Modul des S6 mit Funkplan, Fernmeldeskizze und Kommunikationsplan. | [`frontend/src/stab/AGENTS.md`](../../frontend/src/stab/AGENTS.md), Spec [`fernmeldewesen`](../../openspec/specs/fernmeldewesen/spec.md) |
| FMS-Status | Fahrzeugstatus nach Funkmeldesystem (1 Frei auf Funk bis 0 Prio. Sprechwunsch); ein Eintrag im Statuskatalog der Organisation kann über `fms_anker` (0 bis 9, optional) an einen FMS-Status gebunden sein. | `STATUS_STARTLISTE` in `src/fahrzeug/mod.rs`, `migrations/0008_fahrzeug_status.sql` |
| Fükw, Führungs-Tablet, ortsfeste Stelle (BHP/BTP), mobil | Die vier Einsatzkontexte, für die die Oberfläche gebaut wird. Die Kürzel Fükw, BHP und BTP stehen im Repo nur abgekürzt; eine Langform ist nirgends belegt. | [`frontend/AGENTS.md`](../../frontend/AGENTS.md), Abschnitt „Bedien-Leitlinie“ |
| Führungsorganisation | Organigramm nach FwDV 100, abgeleitet aus der Einsatzgliederung. | Spec [`fuehrungsorganisation`](../../openspec/specs/fuehrungsorganisation/spec.md) |
| Führungsstelle | Die eigene Führungsstelle eines Einsatzes (ELW, Einsatzleitung) als Gegenstelle für Funkplan und Skizze. | `src/einsatz/fuehrungsstelle.rs`, Spec [`einsatz-fuehrungsstelle`](../../openspec/specs/einsatz-fuehrungsstelle/spec.md) |
| Funkplan | Aus Abschnitten, Einheiten, Fahrzeugen und Sprechgruppen abgeleitete Tabelle nach FwDV 100 Anlage 5. | Spec [`stab-funkplan`](../../openspec/specs/stab-funkplan/spec.md) |
| Gefahren | Gefahrenmatrix und Warnstufen eines Einsatzes. | Spec [`gefahrenmatrix`](../../openspec/specs/gefahrenmatrix/spec.md) |
| Lagebericht, Lagemeldung, lagerelevant, Meldung | Festgelegt im Meldungsmodell. | [`docs/design/2026-10-21-meldungsmodell/README.md`](../design/2026-10-21-meldungsmodell/README.md), Abschnitt „Begriffe“; Spec [`meldungseingang`](../../openspec/specs/meldungseingang/spec.md) |
| Lagebesprechung | Termin mit Vorbereitung und Entschluss; eigenes Modul. | [`frontend/src/lagebesprechung/AGENTS.md`](../../frontend/src/lagebesprechung/AGENTS.md), Spec [`lagebesprechung`](../../openspec/specs/lagebesprechung/spec.md) |
| Lagebild | Die Lage in Zahlen und die jüngsten ETB-Einträge; jede Zahl hat genau einen Rechenweg. | Modul „Lagebild“ in `frontend/src/einsatz/modulRegistry.ts`, Spec [`lage-verdichtung`](../../openspec/specs/lage-verdichtung/spec.md) |
| Lagefeststellung | Mehrzahl des ETB-Typs „Lage“; keine Lagemeldung. | [`frontend/AGENTS.md`](../../frontend/AGENTS.md), Abschnitt „Begriffe“ |
| Lagekarte | Karte mit Einsatzort, Objekten, taktischen Zeichen und Gefahrengebieten. | [`frontend/src/pages/lagekarte/AGENTS.md`](../../frontend/src/pages/lagekarte/AGENTS.md) |
| Meldebild | Status, Stärke und Gliederung der Kräfte (Modul-Key `kraefteuebersicht`). | `frontend/src/einsatz/modulRegistry.ts`, `src/einsatz/modul.rs` |
| Nachforderung | Anforderung weiterer Kräfte oder Mittel mit Zusage, Anmarsch und Eintreffen, jeder Schritt im ETB. | `src/nachforderung/`, Specs [`nachforderung-erfassung`](../../openspec/specs/nachforderung-erfassung/spec.md), [`etb-vorgaenge`](../../openspec/specs/etb-vorgaenge/spec.md) |
| Organisation | Der Mandant: Träger der Stammdaten, Einstellungen und Einsätze. | `src/org/`, [Querschnitt 8.1](08-querschnittliche-konzepte.md) |
| PAT-Nummer | Kennung eines Patienten im Patientenkopf. | [`frontend/src/personen/AGENTS.md`](../../frontend/src/personen/AGENTS.md) |
| Schichtmodell | Stammdatum der Organisation: wie lange eine Schicht läuft (Rhythmus oder Wechselzeiten) samt Vorwarnung. | `src/schichtmodell/mod.rs` |
| Sichtung | Einstufung eines Patienten in SK I bis SK IV, dazu `tot` und `unverletzt`. | `Sichtungskategorie` in `src/person/mod.rs`, Spec [`sichtungswahl`](../../openspec/specs/sichtungswahl/spec.md) |
| Sprechgruppe | Funk-Sprechgruppe der Organisation oder eines Einsatzes. | `src/sprechgruppe/mod.rs`, `tests/sprechgruppe_katalog.rs` |
| Stab, Sachgebiete S1 bis S6 | S1 Personal, S2 Lage, S3 Einsatz, S4 Versorgung, S5 Presse- und Medienarbeit, S6 Information und Kommunikation. | `Sachgebiet` in `src/stab/mod.rs`, [`frontend/src/stab/AGENTS.md`](../../frontend/src/stab/AGENTS.md) |
| Standard-Rufname | Eigenname: der vorbelegte Absender eines Mitglieds im ETB. | Spec [`bedien-begriffe`](../../openspec/specs/bedien-begriffe/spec.md), Szenario „Eigenname bleibt“ |
| Stichwort | Einsatzstichwort; die Organisation führt Vorschläge dafür. | `src/stichwort/mod.rs` |
| UHS (Unfallhilfsstelle) | Stelle mit Behandlungsplätzen, Belegung und Material; Status endet in `aufgeloest`. | `src/uhs/mod.rs`, Modul „Unfallhilfsstellen“ in `frontend/src/einsatz/modulRegistry.ts` |
| Verpflegungsstelle | Stelle der Verpflegung mit Portionen, Sonderkost und Ausgabe. | `src/verpflegung/`, Spec [`kraefte-verpflegung`](../../openspec/specs/kraefte-verpflegung/spec.md) |
| Vorgabe | Wert, der gilt, wenn niemand etwas wählt. | Spec [`bedien-begriffe`](../../openspec/specs/bedien-begriffe/spec.md) |

## 12.2 Technikbegriffe

| Begriff | Bedeutung | Quelle |
| --- | --- | --- |
| ADR | Architekturentscheidung als Datei mit prüfbaren Regeln. | [`docs/architektur/AGENTS.md`](AGENTS.md), [Architekturentscheidungen](09-architekturentscheidungen.md) |
| Archiv (Aufbewahrung) | Nur lesender, dem System-Admin vorbehaltener Zugang zu gesperrten Einsätzen unter `/api/aufbewahrung`. | `src/aufbewahrung/`, [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Aufbewahrung“ |
| CAS | Vergleich mit dem Stand beim Öffnen vor dem Schreiben (`basis_geaendert_at`, `erwartet`); Verstoß ist 409. | [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Statuscode-Konvention“ |
| Change | Laufende OpenSpec-Änderung unter `openspec/changes/<name>/`, nach Abschluss im Archiv. | [Wurzel-`AGENTS.md`](../../AGENTS.md), Abschnitt „Planung und Ausführung“ |
| `client_id` | Kennung eines offline erfassten Eintrags, die den erneuten Versand idempotent macht. | `src/etb/repo.rs`, [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md) |
| Demo-Marke | Herkunftsmarke, die Demo-Daten kennzeichnet; einzige Quelle für „ist Demo“. | [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Demo-Daten zur Laufzeit“ |
| Design System „Lifeline Hub“ | Aus dem Code erzeugte Sammlung von Tokens und Bausteinen. | [`docs/design/design-system/`](../design/design-system/), Spec [`design-system-artifact`](../../openspec/specs/design-system-artifact/spec.md) |
| Dev-Seed | Testdaten und Dev-Anmeldung, nur mit Cargo-Feature `dev-seeds`. | `src/dev/`, Spec [`dev-seed-gate`](../../openspec/specs/dev-seed-gate/spec.md) |
| Dichtestufe | `kompakt`, `komfortabel` oder `handschuh`; bestimmt Steuerhöhe und Trefffläche. | `frontend/src/theme/dichte.ts`, Spec [`bedien-dichte`](../../openspec/specs/bedien-dichte/spec.md) |
| Druckwurzel | Das eine Element einer Seite, das gedruckt wird (`data-lfh="druckwurzel"`). | [`frontend/src/druck/AGENTS.md`](../../frontend/src/druck/AGENTS.md) |
| `EinsatzKontext` | Extractor, der Einsatz, Rolle und Org-Floor für jeden einsatzgebundenen Handler prüft. | `src/einsatz/kontext.rs` |
| Funktionsansicht | Was ein gekoppeltes Gerät lesen und schreiben darf (etwa UHS, Abschnitt, Lagemonitor). | Spec [`funktionsansichten`](../../openspec/specs/funktionsansichten/spec.md), [`frontend/src/geraet/AGENTS.md`](../../frontend/src/geraet/AGENTS.md) |
| Gerätekonto | Konto, unter dem ein gekoppeltes Gerät schreibt; keine Person. | `ist_geraetekonto` in `src/geraet/repo.rs`, Spec [`geraete-kopplung`](../../openspec/specs/geraete-kopplung/spec.md), „Gerätekonto ist keine Person“ |
| Hülle (Desktop-Hülle) | Tauri-2-App `src-tauri`, deren Webview die https-Adresse des Servers lädt; ohne Anwendungslogik. | [`src-tauri/AGENTS.md`](../../src-tauri/AGENTS.md), `frontend/src/huelle/faehigkeiten.ts` |
| Kanal `alpha`, `beta`, `main` | Release-Kanäle: jeder Merge auf `alpha` gibt eine Vorabversion `X.Y.Z-alpha.N` frei, `main` die stabile; `beta` ist vorbereitet. | `branches` in `release.config.mjs` |
| Kopplung | Bindung eines ausgegebenen Geräts an genau einen Einsatz, befristet und widerrufbar. | `src/geraet/`, Spec [`geraete-kopplung`](../../openspec/specs/geraete-kopplung/spec.md) |
| Lagebild-Speicher | IndexedDB `lifeline-lagebild` mit dem ohne Netz lesbaren Stand. | `frontend/src/offline/lagebildSpeicher.ts`, [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md) |
| Lagemonitor | Gekoppeltes Gerät, das das Lagebild ohne Bedienung und ohne Personendaten zeigt. | Spec [`lagemonitor`](../../openspec/specs/lagemonitor/spec.md) |
| Live-Kanal (Einsatz-Strom, Org-Strom) | SSE-Strom je Einsatz bzw. je Organisation mit festen Ereignisnamen. | `src/live/mod.rs`, `src/live/org.rs`, [Querschnitt 8.6](08-querschnittliche-konzepte.md) |
| Modul, Modul-Registry | Fachbereich der Einsatzoberfläche mit festem Key; Registry im Frontend, Key-Spiegel im Backend. | `frontend/src/einsatz/modulRegistry.ts`, `MODUL_KEYS` in `src/einsatz/modul.rs` |
| Modulfreigabe, Modul-Override | Vom Server berechnete Sichtbarkeit und Rolle je Modul; ein Override setzt sie für einen Einsatz. | Spec [`modul-freigabe`](../../openspec/specs/modul-freigabe/spec.md), `src/einsatz/modul_override.rs` |
| Nachtbetrieb, Tagbetrieb | Die beiden Farbschemata; Vorgabe ist Nachtbetrieb. | [`frontend/AGENTS.md`](../../frontend/AGENTS.md), Abschnitt „Browserspeicher“; `frontend/src/theme/ThemeModeProvider.tsx` |
| Offline-Queue (vormerken) | Ohne Netz erfasste Schreibaktionen, die später gesendet werden. | `frontend/src/offline/queue.ts`, [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md), Abschnitt „Schreiben ohne Netz“ |
| Org-Floor | Mindestprüfung am Einsatz: der Aufrufer ist Mitglied oder darf fremde Einsätze lesen (System-Admin serverweit, Führungskraft nur in der eigenen Organisation). | `berechtigung::fordere_org_zugehoerigkeit`, `src/einsatz/kontext.rs` |
| Purge-Lauf | Hintergrundlauf, der fällige Einsätze schwärzt und Fristen vollzieht. | `src/einsatz/purge_scheduler.rs` |
| Replay-Ring | Puffer der letzten Live-Nachrichten je Einsatz für die Nachlieferung über `Last-Event-ID`. | `REPLAY_KAPAZITAET` in `src/live/mod.rs` |
| Sammel-Gate | `scripts/check-all.sh`, die eine Prüfung vor dem Merge. | [`scripts/AGENTS.md`](../../scripts/AGENTS.md) |
| Schuldmenge | Liste bekannter Altverstöße in einem Wächter, die nur schrumpfen darf. | etwa Spec [`zeitdarstellung`](../../openspec/specs/zeitdarstellung/spec.md), „Eine Formatstelle“ |
| Schwärzung | Unumkehrbares Entfernen personenbezogener Werte, physisch überschrieben. | `src/einsatz/schwaerzung_*.rs`, `src/db/physisch.rs` |
| Spec | Fähigkeits-Spec unter `openspec/specs/<name>/spec.md` mit SHALL/MUST und Szenarien. | [Wurzel-`AGENTS.md`](../../AGENTS.md), Abschnitt „Planung und Ausführung“ |
| Sprungpalette | Tastaturgesteuerte Suche über Module und Datensätze. | [`frontend/src/command-palette/AGENTS.md`](../../frontend/src/command-palette/AGENTS.md), Spec [`sprungpalette`](../../openspec/specs/sprungpalette/spec.md) |
| Stellenbindung | Bindung einer Kopplung an eine Stelle (UHS, Betreuungsstelle, BR, Abschnitt, Verpflegungsstelle). | `src/geraet/stelle.rs`, [`frontend/src/geraet/AGENTS.md`](../../frontend/src/geraet/AGENTS.md) |
| Typ-Codegen | Erzeugung der Frontend-Typen aus dem OpenAPI-Schema des Backends. | [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Typ-Codegen“ |
| Wächter | Test oder Skript, das eine Regel im Code durchsetzt (`*.guard.test.ts`, `tests/*_guard.rs`, `scripts/check-*.sh`). | [Querschnitt 8.27](08-querschnittliche-konzepte.md) |
| Wire-Enum | Enum, dessen Wire-Werte aus einer Liste `Variante => "wire"` entstehen. | `wire_enum!` in `src/wire_enum.rs`, `tests/enum_wire_kontrakt.rs` |
| Zunder | Aufgabenverwaltung des Projekts; alte Kennungen `LFH-<n>` bleiben gültig. | [Wurzel-`AGENTS.md`](../../AGENTS.md), Abschnitt „Zunder“ |
