-- no-transaction
-- LFH-932: Herkunft und Verwaisung eines Proxy-Slots, damit Slots, die das aktuelle
-- Upstream-Dokument nicht mehr nennt, abgebaut werden können.
--
-- herkunft_id NULL = der Slot stammt aus dem Style-Dokument der Quelle; sonst die id des
-- TileJSON-Slots, dessen Dokument ihn nennt. Ein Abruf verwaist nur Slots seiner Herkunft.
-- verwaist_seit (Unix-Sekunden) markiert einen Slot, den sein Dokument nicht mehr nennt; erst
-- nach der Karenz (`proxy::WAISEN_KARENZ_SEK`) wird er gelöscht, damit offene Karten mit dem
-- alten Dokument weiterlaufen. Nennt ein Dokument ihn wieder, fällt die Markierung weg und das
-- nennende Dokument übernimmt ihn. Bevor ein TileJSON-Slot gelöscht wird, gibt
-- `repo::waisen_pflegen` seine Kachel-Slots verwaist an den Style zurück: ein anderes Dokument,
-- das sie noch nennt, holt sie so zurück. ON DELETE SET NULL ist nur das Netz dahinter.
-- Bestandszeilen haben NULL: der erste Style-Abruf markiert Kachel-Slots seiner TileJSONs als
-- verwaist, der folgende TileJSON-Abruf übernimmt sie und hebt die Markierung auf.
--
-- Rebuild statt ADD COLUMN, weil die id AUTOINCREMENT braucht: Slots werden jetzt regelmäßig
-- gelöscht, und ohne AUTOINCREMENT vergäbe SQLite die höchste gelöschte id neu. Eine Karte,
-- die den alten Slot noch hält, bekäme dann still die Kacheln einer anderen URL derselben Art.
-- Die ids bleiben erhalten; die Sequenz beginnt über der höchsten. karte_proxy_asset ist Leaf
-- (keine andere Tabelle verweist darauf, grep über migrations/) → kein
-- PRAGMA-foreign_keys-Toggle, das DROP löst keine Kaskade aus (Muster 0112/0141).
-- Schema = 0077 1:1 plus die zwei Spalten. Abgesichert von db::tests::migration_0154_*.

CREATE TABLE karte_proxy_asset_neu (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    quelle_id     INTEGER NOT NULL REFERENCES karte_online_quelle(id) ON DELETE CASCADE,
    upstream_url  TEXT    NOT NULL,
    art           TEXT    NOT NULL CHECK (art IN ('static', 'template', 'tilejson', 'sprite', 'glyphs')),
    erstellt_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    herkunft_id   INTEGER REFERENCES karte_proxy_asset(id) ON DELETE SET NULL,
    verwaist_seit INTEGER,
    -- art ist Teil der Identität: dieselbe Upstream-URL kann (selten) in zwei Rollen auftreten;
    -- jede Art bekommt ihren eigenen Slot, sonst macht ON CONFLICT DO UPDATE SET art eine Art
    -- unauflösbar (slot_aufloesen filtert auf art → 404).
    UNIQUE (quelle_id, upstream_url, art)
);

INSERT INTO karte_proxy_asset_neu (id, quelle_id, upstream_url, art, erstellt_at)
    SELECT id, quelle_id, upstream_url, art, erstellt_at FROM karte_proxy_asset;

DROP TABLE karte_proxy_asset;

ALTER TABLE karte_proxy_asset_neu RENAME TO karte_proxy_asset;

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'karte_proxy_asset' WHERE name = 'karte_proxy_asset_neu';

CREATE INDEX idx_karte_proxy_asset_herkunft ON karte_proxy_asset (herkunft_id);
