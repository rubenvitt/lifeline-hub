-- LLH-1497: Direktkopplung vor Ort (Change t10a7luh-elw-lan-direktkopplung, design.md D1, D3).
--
-- `art` beschreibt die Kopplung, nicht die Instanz: `standard` (bisher, etwa ELW→Hub) oder
-- `vor_ort` (zwei Instanzen im selben LAN; nur Spiegel und Anträge, kein Führungswechsel, keine
-- Verwahrung, keine Stammdaten). Der Admin wählt sie beim Ausstellen des Codes.
ALTER TABLE instanz_kopplung ADD COLUMN art TEXT NOT NULL DEFAULT 'standard'
    CHECK (art IN ('standard', 'vor_ort'));
ALTER TABLE instanz_kopplungscode ADD COLUMN art TEXT NOT NULL DEFAULT 'standard'
    CHECK (art IN ('standard', 'vor_ort'));

-- Meldende Seite einer Direktkopplung: SHA-256 (hex) des TLS-Endzertifikats der erreichten
-- Seite, durch eine von ihr signierte Aussage beglaubigt (design.md D3). Nutzdaten gehen nur über
-- eine Verbindung mit genau diesem Zertifikat.
ALTER TABLE instanz_kopplung ADD COLUMN tls_zertifikat TEXT;

-- Erreichte Seite: der Fingerabdruck, den die meldende Seite zuletzt als gespeichert genannt hat
-- (Anzeige „Zertifikat bestätigt“ oder „kennt ein älteres Zertifikat“).
ALTER TABLE instanz_kopplung ADD COLUMN tls_zertifikat_gemeldet TEXT;

-- Fingerabdruck des eigenen TLS-Zertifikats, beim Start gesetzt (NULL ohne `--tls`). In der DB
-- statt im Prozess, weil Tests mehrere Instanzen in einem Prozess betreiben.
ALTER TABLE instanz_identitaet ADD COLUMN tls_zertifikat TEXT;

-- Ob die LAN-Entdeckung an dieser Instanz läuft (`--lan-entdeckung` mit `--tls`, ohne
-- Loopback-Bind; design.md D6). Beim Start gesetzt, wie `fuehrung_an`.
ALTER TABLE instanz_identitaet ADD COLUMN lan_entdeckung_an INTEGER NOT NULL DEFAULT 0;
