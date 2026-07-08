# LFH-120 — Orphan-Union → Rust-Enum Mapping (verifiziert)

Ergebnis des read-only Mapping-Workflows (5 Domänen-Agents, gegen `migrations/`-DB-CHECKs
und werteschreibenden Backend-Code verifiziert). **Zentrale Erkenntnis: NULL Drift** — jede
`types.ts`-Union stimmt exakt mit den autoritativen Wire-Werten überein. Die `types.ts`-
Literale sind damit als Quelle verlässlich; Enums exakt danach bauen.

Jedes Enum: reiner **Schema-Anker** (`#[schema(value_type = X)]` auf dem `String`-Feld) —
NICHT in den Struct einbetten, NICHT sqlx-dekodieren. Derive: `Debug, Clone, Copy, PartialEq,
Eq, Serialize, utoipa::ToSchema`. Guard-Zeile in `tests/enum_wire_kontrakt.rs` ergänzen.

## Dedup / Wiederverwendung (WICHTIG — nicht doppelt anlegen)

- **MeldungMeldeweg → bestehendes `MeldeWeg`** (`src/etb/mod.rs`) wiederverwenden. Gleiche
  Werte (funk/telefon/persoenlich/sonstige). Kein neues Enum; Feld-Override `value_type = MeldeWeg`;
  Barrel: `export type MeldungMeldeweg = S['MeldeWeg']`.
- **`Richtung`** (intern/extern) wird von auftrag UND meldung genutzt → EIN geteiltes Enum in
  `src/kommunikation/mod.rs`. Barrel: beide Namen re-exportieren.
- **`AdressatKategorie`** (leitstelle/nachbar_ea/uebergeordnet/andere_bos) wird von
  nachforderung (`adressat_kategorie`) UND auftrag (`extern_kategorie`) genutzt → EIN geteiltes
  Enum in `src/kommunikation/mod.rs`.
- **`Prioritaet`** (sofort/dringend/normal) ist bei Auftrag/Meldung/Nachforderung IDENTISCH →
  EIN geteiltes `Prioritaet`-Enum in `src/kommunikation/mod.rs`; die drei TS-Namen
  (AuftragPrioritaet/MeldungPrioritaet/NachforderungPrioritaet) im Barrel darauf mappen.

## Per-variant rename (rename_all trifft NICHT)

- **`Zeitformat`**: `VierundzwanzigStunden` → `"24h"`, `ZwoelfStunden` → `"12h"` (per-Variante `#[serde(rename)]`).
- **`Betriebsart`**: `Tmo` → `"TMO"`, `Dmo` → `"DMO"` (Großbuchstaben, per-Variante `#[serde(rename)]`).

Alle übrigen: `#[serde(rename_all = "snake_case")]`.

## Enums (Name · Modul · Varianten → wire)

| Rust-Enum | Modul | Varianten (wire) | rename |
|---|---|---|---|
| SystemRolle | src/auth/mod.rs | admin, keiner | snake_case |
| OrgRolle | src/auth/mod.rs | fuehrungskraft, keine | snake_case |
| EinsatzStatus | src/einsatz/mod.rs | aktiv, abgeschlossen | snake_case |
| Einsatzart | src/einsatz/mod.rs | realeinsatz, uebung, sanitaetsdienst, bereitstellung | snake_case |
| BasemapModus | src/einsatz/einstellungen.rs | online, offline, blind | snake_case |
| Zeitformat | src/einsatz/einstellungen.rs | 24h, 12h | **per-variant** |
| EinheitenSystem | src/einsatz/einstellungen.rs | metrisch, imperial | snake_case |
| Koordinatenformat | src/einsatz/einstellungen.rs | wgs84, dms, utm, mgrs, gk | snake_case |
| Betriebsart | src/katalog.rs | TMO, DMO | **per-variant** |
| StatusKategorie | src/katalog.rs | verfuegbar, gebunden, nicht_verfuegbar | snake_case |
| Dienststatus | src/katalog.rs | in_dienst, ausser_dienst | snake_case |
| VerbleibStatus | src/person/mod.rs | angemeldet, abtransportiert | snake_case |
| AbgleichStatus | src/person/mod.rs | verdacht, bestaetigt, verworfen | snake_case |
| Gefahrentyp | src/gefahr/mod.rs | atemgifte, angstreaktion, ausbreitung, atomare_strahlung, chemische_stoffe, erkrankung_verletzung, explosion, elektrizitaet, einsturz, absturz, brand, durchbruch, ertrinken | snake_case |
| Schutzobjekt | src/gefahr/mod.rs | menschen, tiere, umwelt, sachwerte, einsatzkraefte | snake_case |
| Warnstufe | src/gefahr/mod.rs | keine, niedrig, mittel, hoch, akut | snake_case |
| LageZoneTyp (TS: ZoneTyp) | src/lage_zone/mod.rs | gefahrengebiet, absperrbereich, absperrgrenze, sperrgebiet, freie_skizze | snake_case |
| LageberichtVorlage (TS: LageberichtVorlageKey) | src/lagebericht/mod.rs | lagebericht, lagebeurteilung, freitext | snake_case |
| LageberichtStatus | src/lagebericht/mod.rs | entwurf, freigegeben | snake_case |
| BefehlVorlage (TS: BefehlVorlageKey) | src/befehl/mod.rs | befehl_lad, befehl_ladef, befehl_schnee, befehl_ea_zmw | snake_case |
| BefehlStatus | src/befehl/mod.rs | entwurf, freigegeben | snake_case |
| AuftragBearbeitungsstatus | src/auftrag/mod.rs | offen, in_arbeit, vollzogen, abgenommen | snake_case |
| EmpfaengerTyp | src/auftrag/mod.rs | abschnitt, einheit, funktion, person, fahrzeug, extern | snake_case |
| MeldungStatus | src/meldung/mod.rs | neu, gesichtet, in_bearbeitung, erledigt | snake_case |
| Meldungsart | src/meldung/mod.rs | lagemeldung, sofortmeldung, rueckmeldung, vollzugsmeldung, anfrage, sonstige | snake_case |
| NachforderungStatus | src/nachforderung/mod.rs | angefordert, zugesagt, unterwegs, eingetroffen, abgelehnt | snake_case |
| **Prioritaet** (geteilt; TS: AuftragPrioritaet/MeldungPrioritaet/NachforderungPrioritaet) | src/kommunikation/mod.rs | sofort, dringend, normal | snake_case |
| **Richtung** (geteilt; auftrag+meldung) | src/kommunikation/mod.rs | intern, extern | snake_case |
| **AdressatKategorie** (geteilt; nachforderung+auftrag extern_kategorie) | src/kommunikation/mod.rs | leitstelle, nachbar_ea, uebergeordnet, andere_bos | snake_case |
| MeldungMeldeweg → **reuse MeldeWeg** (src/etb/mod.rs) | — | funk, telefon, persoenlich, sonstige | (bestehend) |

**Netto neue Enums:** ~27 (33 Unions − MeldeWeg-Reuse − 2 Prioritaet-Duplikate zusammengelegt − Richtung/AdressatKategorie-Sharing).

**Feld↔Enum-Overrides** (für Task 2, `#[schema(value_type = …)]`): siehe `backend_fields`
je Union im Workflow-Result — u.a. BenutzerAnzeige.system_rolle/org_rolle, EinsatzAnzeige.status/einsatzart,
Einstellungen*.basemap_modus/zeitformat/einheiten/koordinatenformat, SprechgruppeAnzeige.betriebsart,
EinsatzPersonalAnzeige/EinsatzFahrzeugAnzeige.status_kategorie, Personal/Fahrzeug/MaterialAnzeige.dienststatus,
VerbleibAnzeige.status, AbgleichAnzeige.status, GefahrBewertungAnzeige.gefahrentyp/schutzobjekt/warnstufe,
GefahrengebietAnzeige.hoechste_warnstufe, LageZoneAnzeige.typ, Lagebericht/BefehlAnzeige.vorlage/status,
AuftragAnzeige.prioritaet/richtung/bearbeitungsstatus, AuftragEmpfaengerAnzeige.empfaenger_typ/extern_kategorie,
MeldungAnzeige.prioritaet/richtung/meldungsart/meldeweg/status, NachforderungAnzeige.prioritaet/status/adressat_kategorie.
