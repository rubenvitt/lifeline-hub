// swift-tools-version: 6.1
//
// Testbare Logik der iOS-Hülle ohne UIKit und WebKit (LLH-1978, design.md D1): Adressprüfung,
// Deeplink, Linkregeln, Serverliste, Vertragsprüfung, Onboarding und Haptik-Abbildung. Läuft
// auch unter Linux (`swift test`, Schritt `ios` von scripts/check-all.sh); die App
// (`ios/App`) bindet das Paket ein. Die Fälle, die die Desktop-Hülle teilt, liest die Suite aus
// `src-tauri/faelle/` (Tests/LifelineKernTests/GemeinsameFaelle.swift).
//
// Die Swift-Version ist hier gepinnt: Werkzeugversion 6.1 und Sprachmodus 6.
import PackageDescription

let package = Package(
    name: "LifelineKern",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [
        .library(name: "LifelineKern", targets: ["LifelineKern"])
    ],
    targets: [
        .target(name: "LifelineKern"),
        .testTarget(name: "LifelineKernTests", dependencies: ["LifelineKern"]),
    ],
    swiftLanguageModes: [.v6]
)
