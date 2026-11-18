import Foundation
import XCTest

/// Liest die gemeinsamen Fälle beider Hüllen (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“).
///
/// Eine Quelle, keine Kopie und kein Symlink: die Suite liest die Dateien über `#filePath` aus
/// dem Repo. Ein Symlink unter `Tests/` hinge an Git unter Windows und an der Art, wie SwiftPM
/// und Xcode Ressourcen kopieren; eine Kopie bräuchte eine eigene Gleichheitsprüfung, die
/// vergessen werden kann. `#filePath` gilt unter Linux (`swift test`, Schritt 18 von
/// `scripts/check-all.sh`) und im iOS-Simulator, der das Dateisystem des Macs liest
/// (`ios-pruefung.yml`); auf einem echten Gerät laufen diese Tests nicht.
enum GemeinsameFaelle {
    /// Pfad der Fälle relativ zur Repo-Wurzel; `scripts/bereiche.test.sh` sucht dieses Literal.
    static let verzeichnis = "src-tauri/faelle"

    static var wurzel: URL {
        // …/ios/LifelineKern/Tests/LifelineKernTests/GemeinsameFaelle.swift → Repo-Wurzel
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url
    }

    static func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
        let datei = wurzel.appendingPathComponent(verzeichnis).appendingPathComponent(name)
        let daten = try Data(contentsOf: datei)
        return try JSONDecoder().decode(T.self, from: daten)
    }
}
