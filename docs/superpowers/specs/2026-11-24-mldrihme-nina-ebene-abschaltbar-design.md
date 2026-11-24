# NINA-Fachebene je Instanz abschaltbar (LLH-2104) — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/mldrihmesop4hlx1vdi243mr

## Anlass

Die Lizenzprüfung LLH-1203 hat ergeben: MoWaS-Meldungen (Fachebene `nina`, Quelle
warnung.bund.de) dürfen nur „inhaltlich unverändert und nicht zu gewerblichen Zwecken“
verwendet werden. Hilfsorganisationen, Behörden und BOS sind davon nicht betroffen. Ein
gewerblicher Betreiber, etwa ein privater Sanitätsdienst, muss die Ebene aber abschalten
können, und zwar so, dass die Instanz dann gar nichts mehr bei warnung.bund.de abruft.

## Abgestimmter Weg (Checkpoint 24.11.2026)

| Frage | Entscheidung |
| --- | --- |
| Mechanismus | Server-Flag `--nina` / `LIFELINE_NINA`, Vorgabe **an** |
| Darstellung | abgeschaltete Ebene erscheint in der Lagekarte **gar nicht** |
| Route | `GET /api/map/overlays/nina` antwortet **404**, ohne Abruf und ohne Cache-Zugriff |

### Verworfene Alternativen

- **Schalter in der Verwaltung** (Vorgabe aus dem Flag, Umschalten ohne Neustart wie bei der
  automatischen Kartenaktualisierung): Die Lizenzfrage hängt am Betreiber der Installation,
  nicht an einem Org-Admin; ein Flag entspricht `LIFELINE_KRITIS_EXTRAKT`. Ein Schalter bräuchte
  Speicher, Admin-Route und Oberfläche für eine Entscheidung, die einmal fällt.
- **Ebene als „abgeschaltet“ zeigen** mit neuem `FachebeneStatus::Abgeschaltet`: Eine ausgegraute
  Ebene, die niemand einschalten kann, hilft in der Lage niemandem und bräuchte einen Wire-Wert
  samt Codegen.

## Entwurf

### Backend

1. **Flag** in `src/config.rs`: `pub nina: bool`, `#[arg(long, env = "LIFELINE_NINA",
   default_value_t = true, action = clap::ArgAction::Set)]`. Der Doc-Kommentar (Hilfetext)
   nennt die Auflage: MoWaS-Meldungen nur unverändert und nicht zu gewerblichen Zwecken;
   gewerbliche Betreiber schalten mit `--nina false` ab. Das ist der Hinweis „neben der
   Einstellung“.
2. **Zustand** in `FachebenenState` (`src/karte/mod.rs`): Menge der abgeschalteten Ebenen
   (`abgeschaltet: Arc<[&'static str]>`, leer in `neu()`), gesetzt über
   `mit_abgeschaltet(&[…])` und abgefragt über `ist_abgeschaltet(quelle)`. Allgemein gehalten,
   weil Autobahn und Luftqualität einen ähnlichen Lizenzvorbehalt tragen; ein eigenes Flag
   bekommen sie hier nicht. `main.rs` setzt `["nina"]`, wenn `config.nina == false`, und loggt
   beim Start einmal `info`, dass die NINA-Ebene abgeschaltet ist.
3. **Route** `fachebenen` (`src/routes/karte.rs`): vor dem `match` prüft
   `state.fachebenen.ist_abgeschaltet(&quelle)` und antwortet `AppError::NotFound("Fachebene
   abgeschaltet")`. Damit gibt es keinen Abruf, keinen Hintergrund-Refresh, keinen Cache-Zugriff.
4. **Config** `GET /api/map/config`: neues Feld `fachebenen_abgeschaltet: Vec<String>` in
   `KarteConfigAntwort` (deutscher Bestandstyp, das neue Feld folgt dessen Sprache), Inhalt aus
   `FachebenenState`. Typ-Codegen (`scripts/check-typ-codegen.sh`) mitziehen.
5. **Testbarkeit des Abrufs:** Die NINA-URLs sind heute Konstanten. `FachebenenState` bekommt
   wie bei Pegel und Wetter eine `nina_basis_url` (Vorgabe `https://warnung.bund.de/api31`) mit
   `mit_nina_basis_url(…)`; `erneuere_nina` baut `mapData.json` und `warnings/{id}.geojson`
   daraus.

### Frontend

- Die Lagekarte liest `fachebenen_abgeschaltet` aus der schon geladenen Karten-Config.
- Eine abgeschaltete Ebene fehlt im Ebenenbaum (Gruppe und Zähler), in Legende und Attribution,
  und ihre Sichtbarkeit gilt als `false`, auch wenn eine gespeicherte Ansicht oder die
  Einsatz-Einstellung `fachebenen_sichtbar` sie als `true` führt. Damit bleibt die Abfrage in
  `useFachebenen` (`enabled: fachebenenSichtbar.nina`) aus. Gespeicherte Werte werden nicht
  umgeschrieben: schaltet der Betreiber die Ebene wieder ein, gilt die alte Wahl.
- Solange die Config noch lädt, gilt die Ebene als nicht abgeschaltet. Das kostet nichts: die
  Vorgabe der Sichtbarkeit ist `nina: false` (`fachebenenAuswahl.ts`), und wer sie eingeschaltet
  gespeichert hat, löst höchstens eine Anfrage aus, die mit 404 ohne Abruf endet.

### Doku

- `docs/fachebenen-quellen.md`, Zeile NINA und Abschnitt zur Lizenz: Vorgabe an, Abschalten mit
  `--nina false`, Wirkung (404, Ebene fehlt in der Lagekarte, kein Abruf).
- `CHANGELOG.md`. (`docs/betrieb/env-registry.md` führt nur sicherheitsrelevante Schalter, wie bei `LIFELINE_KRITIS_EXTRAKT` gehört NINA nicht hinein.)
- arc42-Mitänderungsregel (`docs/architektur/AGENTS.md`) beim Plan prüfen; eine ADR braucht es
  nicht, es entsteht keine übergreifende Regel.

## Tests

- **Kein Request an warnung.bund.de** (Akzeptanzkriterium): Integrationstest mit einem lokalen
  Stub als `nina_basis_url`, der Anfragen zählt. Abgeschaltet → `GET /api/map/overlays/nina` ist
  404 und der Stub zählt 0. Gegenprobe eingeschaltet → 200 und der Stub zählt ≥ 1 (belegt, dass
  der Test den Abruf überhaupt sehen kann).
- Config listet `["nina"]` bei abgeschalteter, `[]` bei eingeschalteter Ebene.
- Flag-Parsing: Vorgabe `true`, `--nina false` ergibt `false`.
- Frontend (vitest): Ebenenbaum ohne NINA-Zeile bei `fachebenen_abgeschaltet: ['nina']`;
  `useFachebenen` fragt NINA nicht ab, obwohl die gespeicherte Sichtbarkeit `true` ist.

## Nicht im Umfang

- Kein Flag für Autobahn oder Luftqualität (nur die allgemeine Menge, die es später trägt).
- Keine Oberfläche in der Verwaltung.
- Kein Bereinigen alter NINA-Cache-Einträge in der Cache-DB; sie werden nicht mehr gelesen.
