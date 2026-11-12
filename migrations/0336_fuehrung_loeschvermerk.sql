-- LLH-1699 (Change `h7shm5au-loeschsignal-spiegellose-akten`, design.md D4): Löschvermerk je
-- Einsatzkennung.
--
-- Eine Führungsakte ohne lokalen Einsatz erfährt das Ende ihres Einsatzes nur, wenn das
-- Gegenüber es belegen kann. Das Löschprotokoll trägt die lokale Einsatz-ID, nicht die Kennung,
-- und kennt keine Akte, die ohne Einsatz gelöscht wird. Der Vermerk hält deshalb je Kennung fest,
-- dass ihr Einsatz über diese Instanz nicht mehr zu haben ist: endgültig gelöscht, abgeräumt, auf
-- ein Löschsignal oder beim Widerruf der Zuordnung als Akte entfernt.
--
-- Die Kennung (`<Instanzkennung>/<ID>-<Zufall>`) trägt keinen Inhalt des Einsatzes. Vermerke
-- bleiben wie das Löschprotokoll stehen; eine neu gelieferte Akte mit derselben Kennung macht
-- ihren Vermerk wirkungslos (`instanz::fuehrung::loeschvermerk::belegte`).
CREATE TABLE fuehrung_loeschvermerk (
    kennung     TEXT    PRIMARY KEY,
    -- Lokale Org des Einsatzes bzw. der Akte: gemeldet wird nur an Kopplungen dieser Org.
    org_id      INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    vermerkt_at TEXT    NOT NULL
);
CREATE INDEX idx_fuehrung_loeschvermerk_org ON fuehrung_loeschvermerk(org_id);
