-- LFH-1092: Sitzungen sichtbar und einzeln beendbar. Die Sitzungsliste braucht je Sitzung eine
-- öffentliche Kennung, den Zeitpunkt der letzten Nutzung und eine grobe Gerätebezeichnung.
--
-- kennung: 128 Bit Zufall als Hex. Nicht rowid (über VACUUM nicht stabil, fortlaufend) und nicht
--   token_hash (der Suchschlüssel der Authentifizierung gehört in keine Antwort). Nullable, weil
--   ADD COLUMN kein NOT NULL ohne konstanten Default erlaubt; `auth::session` setzt sie immer.
-- zuletzt_gesehen_at: gedrosselt geschrieben (`session::ZULETZT_GESEHEN_TAKT_MINUTEN`).
-- geraet: grobe Bezeichnung wie 'Firefox · Windows' (`auth::geraet_bezeichnung`), nie der volle
--   User-Agent. NULL = unbekannt.
-- Abgesichert von db::tests::migration_0168_* (include_str!).

ALTER TABLE session ADD COLUMN kennung TEXT;
ALTER TABLE session ADD COLUMN zuletzt_gesehen_at TEXT;
ALTER TABLE session ADD COLUMN geraet TEXT;

UPDATE session
   SET kennung = lower(hex(randomblob(16))),
       zuletzt_gesehen_at = erstellt_at;

CREATE UNIQUE INDEX idx_session_kennung ON session (kennung);
