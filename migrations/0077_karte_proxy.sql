-- LFH-182: Server-Proxy für Style/Tile. Rein additiv (ADD COLUMN + CREATE TABLE) → kein
-- CHECK-Rebuild, no-transaction-Caveat irrelevant.
--
-- proxy = die Quelle wird serverseitig geproxyt (key-basierte Anbieter): /api/karte/config
-- gibt für sie nur relative /api/karte/proxy/...-URLs aus, die Upstream-url (inkl. Key) bleibt
-- server-seitig. Schlüssellose Quellen bleiben proxy=0 (direkt).
ALTER TABLE karte_online_quelle ADD COLUMN proxy INTEGER NOT NULL DEFAULT 0 CHECK (proxy IN (0, 1));

-- Persistente Zuordnung opaker Slot-IDs → Upstream-URLs (inkl. Key; NUR server-seitig, kein
-- Endpunkt gibt upstream_url aus). Beim Style-/TileJSON-Rewrite je referenziertem Asset geupsertet.
-- art bindet einen Slot an seinen Abruf-Endpunkt (Defense-in-Depth gegen art-Verwechslung).
-- ON DELETE CASCADE räumt Slots beim Löschen der Quelle (zusätzlich expliziter Purge im Handler,
-- da SQLite-FK-Enforcement PRAGMA-abhängig ist und bei URL-Änderung ohnehin gepurgt werden muss).
CREATE TABLE karte_proxy_asset (
    id           INTEGER PRIMARY KEY,
    quelle_id    INTEGER NOT NULL REFERENCES karte_online_quelle(id) ON DELETE CASCADE,
    upstream_url TEXT    NOT NULL,
    art          TEXT    NOT NULL CHECK (art IN ('static', 'template', 'tilejson', 'sprite', 'glyphs')),
    erstellt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    -- art ist Teil der Identität: dieselbe Upstream-URL kann (selten) in zwei Rollen auftreten;
    -- jede Art bekommt ihren eigenen Slot, sonst macht ON CONFLICT DO UPDATE SET art eine Art
    -- unauflösbar (slot_aufloesen filtert auf art → 404).
    UNIQUE (quelle_id, upstream_url, art)
);
