# Offline-Karten: alle Bundesländer + Nachbarländer + Welt, gemeinsam angezeigt — Impl-Plan

**Stand:** 2026-07-06 · baut auf LFH-188 (Konzept „mehrere Regionen", Ansatz A) + LFH-199
(Hybrid-Katalog) + LFH-201/203/204 (karten-service Build/Trigger).

## Zielbild

Offline-Karte = **Vereinigung aller fertigen (`bereit`) Regionen**, gemeinsam gezeichnet.
Welt-Übersicht ist die immer-präsente unterste Region; Bundesländer/Nachbarländer legen sich
mit Straßendetail darüber; Voll-Planet ist eine optionale schwere Region. Eine Mechanik
(Multi-Region-Anzeige) trägt alle drei Wünsche.

Nutzer-Entscheidungen (2026-07-06): Welt-Übersicht **automatisch** aufs Gerät (ohne explizite
Auswahl) + Voll-Detail als **wählbare** Option; alle geladenen Regionen **automatisch
gemeinsam** (kein manueller Sichtbar-Schalter); beides jetzt zusammen; LFH-197 vorab committet
(erledigt: 3c069e5).

## Stufe 1 — Rückgrat + Katalog (kein Planet-Abhängigkeit)

### 1a Katalog-Erweiterung (karten-service + compiled-in Baseline)
- `karten-service/src/regions.rs`: +12 Bundesländer (BE,BB,HB,HH,HE,MV,RP,SL,SN,ST,SH,TH),
  +7 Nachbarländer (DK,NL,BE,LU,FR,CZ,PL). Alle einzelne Geofabrik-Bare-Names.
- `karten-service/src/build/validate.rs`: je Nachbarland eine `erwartete_box` (PFLICHT —
  fehlende Box ⇒ harter Build-Abbruch, `build/mod.rs`). Geofabrik-Länderextrakte sind
  **metropolitan-only** (Färöer/DOM-TOM/Karibik sind EIGENE Geofabrik-Regionen) ⇒ alle Boxen
  kompakt an den realen `.poly`-Bounds (echter Falschregion-Schutz). Nur WORLD ist degeneriert-
  global (±180/±85). Bundesländer via bestehendem `DE-*`-Fallback.
- `src/config.rs::default_offline_katalog()`: dieselben Einträge als Platzhalter (Offline-
  Erststart-Baseline; live kommt der Katalog übers Manifest).
- **Schema-Gate (Ops, Nutzer):** Luxemburg (kleinstes Land) zuerst real bauen ⇒ bestätigt
  `AREA`-Bare-Name-Auflösung + LU-Box, bevor `build --all` über den ganzen Satz läuft.

### 1b Multi-Region-Backend — **Ansatz Y (minimal-invasiv)**
Statt „aktiv_basemap = sichtbar + Index droppen" (LFH-188-Skizze): **Rendering = alle
`status='bereit'`-Regionen**. `aktiv_basemap` bleibt unverändert als reiner Legacy-/Kompat-Marker
(alte Single-Route + Exklusiv-`aktivieren`). ⇒ **keine Migration**, kein Umbau an Download-FSM,
Hot-Swap, `ersetze_aktive_offline_karte`, `aktiviere_wenn_keine_aktive` — deutlich kleinerer,
risikoärmerer Schnitt, erfüllt „alle automatisch gemeinsam" vollständig. Ein späteres
„einzeln abschaltbar" führt dann ein eigenes `versteckt`-Flag ein.
- `src/karte/registry/repo.rs`: NEU `sichtbare_offline_karten()` (alle bereiten, sortier,id) +
  `offline_karte_pfad_und_format(id)` (region-adressierte Tile-Auslieferung). Bestand unberührt.
- `src/routes/karte.rs`: Config-Handler liefert additive Liste
  `offline_regionen:[{karte_id,name,tiles_url,attribution,format}]`; `offline_tiles_url`/
  `offline_verfuegbar` als Kompat aus der ersten sichtbaren Region. Neuer Tile-Endpoint
  `/api/karte/offline/{karte_id}/tiles/{z}/{x}/{y}` (region-adressiert; `reader_fuer` ist
  pfad-gekeyt ⇒ trägt N Reader). Serving-Logik in einen Helfer extrahiert (alt + neu teilen ihn).

### 1c Multi-Region-Frontend
- `basemapStil.ts::offlineStyle()` von einer `tilesUrl` auf **N Regionen** (Source
  `basemap-{id}` + Layer-Set mit eindeutigen IDs je Region); Attribution dedupliziert.
- `api/karte.ts::KarteServerConfig` auf die Regionen-Liste; `basemapAuswahl` auf „Menge".
- `OfflineKartenVerwaltung.tsx`: „Aktivieren"-Radio raus — geladene Regionen werden alle
  gezeichnet (auto). Tabelle zeigt Status/Löschen.

## Stufe 2 — Welt

- **Übersicht** = Region `gruppe:"Welt"`, Low-Zoom (z2–6), Flag `basis:true` ⇒ Client lädt sie
  automatisch beim ersten Online-Kontakt (analog `aktiviere_wenn_keine_aktive`) + zeichnet sie
  immer mit.
- **Welt-Build-Spike (offen):** Das versatiles-planetiler-Image (archiviert 2026-06-20)
  exponiert nur `--area`, KEINEN Maxzoom/Bbox. Empfehlung: z2–6 aus einem fertigen
  versatiles-Planet-Download extrahieren (`DELETE FROM tiles WHERE zoom_level>6` + re-checksum)
  statt 300 GB selbst zu prozessieren; Alternative = rohes Planetiler `--maxzoom 6`.
- **Voll-Detail-Planet** = `regions.rs`-Zeile (`geofabrik_area:"planet"`) + degenerierte
  Validate-Box, im Katalog als „sehr groß" markiert. Bauen = Ops (300 GB / ~70–80 GB Download).

## Gates
- Rust: `cargo test -p <crate>` (Repo ist NICHT rustfmt-clean, clippy -D warnings vorbestehend
  rot ⇒ Gate ist `cargo test`, von Hand im Bestandsstil editieren).
- Frontend: `pnpm typecheck` + `pnpm lint --max-warnings 0` + `pnpm test --no-file-parallelism`.
- Migration: gegen `lifeline.db`-Kopie verifizieren (keine applied Migration editieren).
