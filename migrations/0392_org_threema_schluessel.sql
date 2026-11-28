-- LLH-2096: gemerkte öffentliche Schlüssel der Threema-IDs je Org (Ausgang per Threema Gateway,
-- Spec docs/superpowers/specs/2026-11-28-gq6qs7tg-ausgang-threema-design.md, Abschnitt 5).
--
-- Beim ersten Versand an eine Threema-ID fragt der Zusteller ihren öffentlichen Schlüssel beim
-- Gateway ab; der Lauf merkt ihn hier in derselben Transaktion wie das Ergebnis des Versuchs.
-- Jeder spätere Versand vergleicht: weicht der Schlüssel ab, scheitert er dauerhaft
-- (`verschluesselung`), und der gemerkte Schlüssel wird nie überschrieben
-- (`ausgang::repo::save_threema_schluessel_tx`, ON CONFLICT DO NOTHING). Eine Threema-ID behält
-- ihr Schlüsselpaar dauerhaft; ein Zurücksetzen gibt es nicht. Ein Eintrag bleibt, auch wenn die
-- Adresse an der Stelle entfällt. Kein Personenbezug über die ID hinaus, die an der Stelle
-- steht; nicht gespiegelt (Org-Betriebsangabe des Ausgangs).

CREATE TABLE org_threema_schluessel (
    org_id      INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    threema_id  TEXT NOT NULL,
    public_key  TEXT NOT NULL CHECK (length(public_key) = 64),
    gemerkt_at  TEXT NOT NULL,
    PRIMARY KEY (org_id, threema_id)
);
