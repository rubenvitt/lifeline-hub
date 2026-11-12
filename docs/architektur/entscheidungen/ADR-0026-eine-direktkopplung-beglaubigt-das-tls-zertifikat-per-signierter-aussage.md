---
id: ADR-0026
titel: Eine Direktkopplung vor Ort beglaubigt das TLS-Zertifikat per signierter Aussage
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - src/instanz/zertifikat.rs
  - src/instanz/melden.rs
  - src/instanz/entdeckung.rs
herleitung:
  - openspec/changes/archive/2026-11-12-t10a7luh-elw-lan-direktkopplung/design.md
  - docs/architektur/entscheidungen/ADR-0014-maschinen-weisen-sich-mit-schluesselpaar-und-signierten-anfragen-aus.md
  - LLH-1497 (Lösungsweg mit Ruben am 12.11.2026 abgestimmt)
---

# ADR-0026: Eine Direktkopplung vor Ort beglaubigt das TLS-Zertifikat per signierter Aussage

## Regeln

- MUST: Über eine Kopplung der Art `vor_ort` geht eine Anfrage mit Nutzdaten nur über einen
  Client, dessen Verifier den beglaubigten Fingerabdruck verlangt (`zertifikat::client`).
- MUST: Zeigt die Gegenstelle ein anderes Zertifikat, holt die meldende Seite zuerst über
  `POST /api/instanz/zertifikat` eine signierte Aussage ohne Nutzdaten ein; nur wenn sie das
  gesehene Zertifikat nennt, gilt es als neuer Pin.
- MUST: Der Verifier prüft die Handshake-Signaturen mit dem Crypto-Provider; weglassen darf er
  nur die Prüfung von Kette und Hostname.
- MUST NOT: kein `danger_accept_invalid_certs` und kein Client ohne Pin für Nutzdaten.
- MUST NOT: Eine Ankündigung im LAN begründet kein Vertrauen; eine dort gefundene Adresse gilt
  erst nach der signierten Aussage der Gegenstelle.
- MUST: Was eine Kopplung trägt, entscheidet ihre Art über `InstanzKopplungArt::traegt` (in SQL
  `k.art = 'standard'`); jede Prüfstelle steht im Wächter
  `instanz::art_tests::jeder_fluss_hat_seine_pruefstellen`.

## Prüfung

```sh
verlange 'fn verify_tls13_signature' src/instanz/zertifikat.rs
verlange 'Some\(_\) => Err\(rustls::Error::General\(PASST_NICHT' src/instanz/zertifikat.rs
verlange 'super::zertifikat::client\(pin\)' src/instanz/melden.rs
verlange 'match bestaetige_zertifikat\(identitaet, &k\)' src/instanz/melden.rs
verlange 'pub const ZERTIFIKAT_PFAD' src/instanz/melden.rs
verbiete 'danger_accept_invalid_certs' 'src/**/*.rs'
verlange 'pub fn traegt\(self, fluss: Fluss\)' src/instanz/mod.rs
verlange 'fn jeder_fluss_hat_seine_pruefstellen' src/instanz/mod.rs
```

## Kontext

Zwei ELW am Schadensort sollen sich ohne Internet koppeln (Konzept, Entscheidung 13). Ihre
Zertifikate sind selbstsigniert oder von mkcert, kein Betriebssystem vertraut ihnen, und nach
einem IP-Wechsel entsteht ein neues. Die Nachrichten sind nach ADR-0014 ohnehin signiert, aber
ohne vertrautes Zertifikat läse ein Angreifer im WLAN Art.-9-Daten mit.

## Konsequenzen

Eine Direktkopplung braucht `--tls` an der ausstellenden Seite; hinter einem Reverse-Proxy geht
sie nicht. Ein Angreifer in der Mitte fällt beim Koppeln und bei jedem Zertifikatswechsel auf,
weil er die signierte Aussage über sein eigenes Zertifikat nicht liefern kann. Standardkopplungen
vertrauen weiter dem Betriebssystem.
