// swift-tools-version: 6.1
//
// Testbare Logik der Helfer-App ohne UIKit, CoreLocation und SwiftUI (ADR-0098, Spec
// `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Logik im Kern“): Deutung
// von QR-Code und Deeplink, Zustandsautomat der Anmeldung, Antwortentscheidung je Status, Takt,
// Puffer der letzten Position, Texte der Gründe und die erzeugten Design-Tokens. Läuft auch unter
// Linux (`swift test`, Schritt 18 von scripts/check-all.sh); die App (`ios/Helfer`) bindet das
// Paket ein. Adressprüfung kommt aus `LifelineKern`. Die gemeinsamen Fälle liest die Suite aus
// `src-tauri/faelle/helfer.json` (Tests/HelferKernTests/GemeinsameFaelle.swift).
//
// Die Swift-Version ist hier gepinnt: Werkzeugversion 6.1 und Sprachmodus 6.
import PackageDescription

let package = Package(
    name: "HelferKern",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [
        .library(name: "HelferKern", targets: ["HelferKern"])
    ],
    dependencies: [
        .package(path: "../LifelineKern")
    ],
    targets: [
        .target(
            name: "HelferKern",
            dependencies: [.product(name: "LifelineKern", package: "LifelineKern")]),
        .testTarget(name: "HelferKernTests", dependencies: ["HelferKern"]),
    ],
    swiftLanguageModes: [.v6]
)
