-- Registrierte Lifeline-Server. Das Geheimnis liegt nur als SHA-256 (hex) vor.
CREATE TABLE server (
    id TEXT PRIMARY KEY,
    geheimnis_hash TEXT NOT NULL,
    kontakt TEXT,
    version TEXT NOT NULL,
    erstellt_at TEXT NOT NULL,
    zuletzt_at TEXT,
    gesperrt_at TEXT
);
