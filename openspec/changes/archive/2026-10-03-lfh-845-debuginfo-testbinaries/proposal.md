# Proposal

## Why

Seit LFH-520 baut jeder Checkout in sein eigenes `<worktree>/target`. Ein voll gebauter
Worktree belegt so bis zu 19 GB (gemessen am 30.09.2026), bei 13 Worktrees und 94 % belegter
Platte. Den größten Anteil haben die Testbinaries mit 8,8 GB. Gemessen besteht ein
Testbinary zu rund 70 % aus Debuginfo, die jedes der über hundert Binaries neu mitlinkt. In
einer Cloud-Sitzung passt der volle Testbau deshalb heute gar nicht auf die Platte.

## What Changes

- `Cargo.toml` bekommt eine Profil-Einstellung, die die Debuginfo im Dev- und Testprofil
  verkleinert. Welche, entscheidet die Messung in `design.md` (D1).
- Die Einstellung trägt im `Cargo.toml` einen Kommentar mit Messwerten und Begründung. Er
  sagt auch, wie man für eine lldb-Sitzung volle Debuginfo zurückholt.
- Unverändert bleiben Release-Profil, Testsemantik und Backtraces: Fehlschlagende Tests nennen
  weiterhin Datei und Zeile.

## Capabilities

### New Capabilities
<!-- keine -->

### Modified Capabilities
<!-- keine: Die Änderung betrifft nur Build-Artefakte, kein Verhalten der Anwendung
     (`skip_specs: true` in `.openspec.yaml`). -->

## Impact

- `Cargo.toml` (`[profile.dev]` bzw. `[profile.dev.package."*"]`). Das Testprofil erbt vom
  Dev-Profil.
- Lokale Worktrees: weniger Plattenplatz je vollem Bau. Der erste Bau nach dem Merge ist kalt,
  weil sich die Profil-Fingerprints ändern.
- CI: `ci.yml` und `coverage.yml` setzen schon `CARGO_PROFILE_DEV_DEBUG=line-tables-only`.
  Eine Einstellung je Paket in `Cargo.toml` wirkt dort zusätzlich. Ihr Einfluss auf den
  rust-cache und die Laufzeit steht in `design.md`.
- Desktop-Hülle (`src-tauri`) und `karten-service` erben das Workspace-Profil mit.
