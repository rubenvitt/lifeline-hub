-- LLH-1816 (docs/superpowers/specs/2026-11-19-q4svbkq9-vorlage-oberstes-feld-design.md, D2):
-- Die Start-Stichworte bestehender Organisationen bekommen ihre Einsatz-Vorlage, wie neue
-- Organisationen sie ab Werk bekommen (src/auth/bootstrap.rs, STICHWORT_STARTLISTE).
-- Gekoppelt wird nur, wo nichts entschieden ist:
--   * genau der Starttext und noch keine Vorlage (eine Handkopplung bleibt),
--   * eine Vorlage mit genau dem Startnamen in derselben Organisation (umbenannt oder gelöscht:
--     der Vorschlag bleibt ohne Vorlage),
--   * kein vom Hub verteilter Vorschlag (den koppelt die verteilende Instanz; der Schutz-Trigger
--     aus 0312 bräche sonst mit stammdaten_vom_hub ab).
-- Netz: db::tests::migration_0357_koppelt_start_stichworte_behutsam.

WITH zuordnung (text, bezeichnung) AS (
    VALUES ('B2', 'Kleinlage'),
           ('B2Y', 'Kleinlage'),
           ('B3', 'Kleinlage'),
           ('B3Y', 'Kleinlage'),
           ('B4', 'Evakuierung und Betreuung'),
           ('B4Y', 'Evakuierung und Betreuung'),
           ('MANV', 'MANV'),
           ('MANV7', 'MANV'),
           ('MANV15', 'MANV'),
           ('MANV50', 'MANV')
)
UPDATE einsatz_stichwort_vorschlag
SET vorlage_id = (
    SELECT v.id
    FROM zuordnung z
    JOIN einsatz_vorlage v
      ON v.bezeichnung = z.bezeichnung AND v.org_id = einsatz_stichwort_vorschlag.org_id
    WHERE z.text = einsatz_stichwort_vorschlag.text
)
WHERE vorlage_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM zuordnung z
    JOIN einsatz_vorlage v
      ON v.bezeichnung = z.bezeichnung AND v.org_id = einsatz_stichwort_vorschlag.org_id
    WHERE z.text = einsatz_stichwort_vorschlag.text
  )
  AND NOT EXISTS (
    SELECT 1
    FROM stammdaten_herkunft h
    WHERE h.art = 'stichwort_vorschlag'
      AND h.org_id = einsatz_stichwort_vorschlag.org_id
      AND h.lokaler_schluessel = CAST(einsatz_stichwort_vorschlag.id AS TEXT)
  );
