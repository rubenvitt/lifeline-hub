-- LLH-1151: Anmelde- und Admin-Spur je Organisation. Bisher las ein System-Admin der Org A in
-- beiden Spuren Namen, Ereignisse und Adressen der Org B. Gelesen wird jetzt
-- `org_id = <eigene Org> OR org_id IS NULL` (`auth::audit::liste`, `auth::admin_audit::liste`).
-- Herleitung: /mnt/project-files/llh-1151/design.md.
--
-- Schnappschuss beim Schreiben statt Join beim Lesen: `benutzer_id`, `akteur_id` und
-- `ziel_benutzer_id` fallen mit dem Konto auf NULL (ON DELETE SET NULL), und ein Fehlversuch mit
-- falschem Passwort trägt nur den versuchten Namen. Ein Join machte solche Zeilen serverweit.
-- Ohne FK: eine gelöschte Org darf ihre Zeilen ebenso wenig serverweit machen.
--
-- NULL = serverweit: ein Anmeldeversuch mit einem Namen, zu dem es kein Konto gibt. Jede künftige
-- Rebuild-Migration dieser Tabellen (Muster 0170) muss die Spalte mitnehmen.
ALTER TABLE auth_audit ADD COLUMN org_id INTEGER;
ALTER TABLE admin_audit ADD COLUMN org_id INTEGER;

-- Bestand nach denselben Regeln wie `schreibe`, über die heutigen Konten. Ein gespeicherter Name
-- über 64 Zeichen ist gekürzt und trifft kein Konto mehr; er bleibt serverweit.
UPDATE auth_audit SET org_id = COALESCE(
    (SELECT b.org_id FROM benutzer b WHERE b.id = auth_audit.benutzer_id),
    (SELECT b.org_id FROM benutzer b WHERE b.benutzername = auth_audit.benutzername COLLATE NOCASE)
);
UPDATE admin_audit SET org_id = COALESCE(
    (SELECT b.org_id FROM benutzer b WHERE b.id = admin_audit.akteur_id),
    (SELECT b.org_id FROM benutzer b WHERE b.id = admin_audit.ziel_benutzer_id)
);

-- Die Liste liest neueste zuerst je Org.
CREATE INDEX idx_auth_audit_org ON auth_audit (org_id, id);
CREATE INDEX idx_admin_audit_org ON admin_audit (org_id, id);
