import AVFoundation
import LifelineKern
import SwiftUI
import VisionKit

/// Onboarding (Spec `ios-huelle`, „Ohne Server zeigt die App nur das Onboarding“): Adresse
/// eingeben, QR-Code scannen oder per Deeplink vorbelegt; gespeichert wird erst ein
/// verträglicher Server. Ohne gespeicherten Server ist es die Seite „kein Server“.
struct OnboardingView: View {
    @Environment(AppModell.self) private var modell
    /// Als Blatt über der Oberfläche (weiterer Server) statt als ganze Seite.
    let alsBlatt: Bool
    /// Eigener Abbrechen-Knopf; im Stapel der Serverliste führt „Zurück“ hinaus.
    var mitAbbrechen = true
    @State private var scannt = false
    @State private var scanHinweis: String?

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(alsBlatt ? "Server hinzufügen" : "Kein Server eingerichtet")
                        .font(.title2.weight(.semibold))
                    Text("Lifeline zeigt die Oberfläche deines Einsatzservers. Gib seine Adresse ein oder scanne einen QR-Code mit der Adresse.")
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
            switch modell.onboarding {
            case .eingabe(let text, let meldung):
                eingabe(text: text, meldung: meldung)
            case .pruefung(let adresse):
                Section {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Prüfe \(adresse.text) …")
                    }
                    Button("Abbrechen") { modell.sendOnboarding(.zurueck) }
                }
            case .abgelehnt(let adresse, let ergebnis):
                abgelehnt(adresse: adresse, ergebnis: ergebnis)
            case .verbunden:
                Section { ProgressView() }
            }
            Section {
                Text(modell.appVersion?.fullVersion ?? "Version unbekannt")
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("version")
            }
        }
        .accessibilityIdentifier("onboarding")
        .navigationTitle(alsBlatt ? "Server hinzufügen" : "Lifeline")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if alsBlatt && mitAbbrechen {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { modell.zeigtOnboarding = false }
                }
            }
        }
        .sheet(isPresented: $scannt) {
            NavigationStack {
                QRScanner { inhalt in
                    scannt = false
                    if let adresse = Deeplink.adresse(ausQRCode: inhalt) {
                        scanHinweis = nil
                        modell.sendOnboarding(.vorbelegen(adresse))
                    } else {
                        scanHinweis = "Der QR-Code enthält keine Adresse eines Einsatzservers."
                    }
                }
                .ignoresSafeArea()
                .navigationTitle("QR-Code scannen")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Abbrechen") { scannt = false }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func eingabe(text: String, meldung: String?) -> some View {
        Section {
            TextField(
                "https://elw.local:8443",
                text: Binding(get: { text }, set: { modell.sendOnboarding(.textChanged($0)) })
            )
            .keyboardType(.URL)
            .textContentType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .onSubmit { modell.sendOnboarding(.verbinden) }
            .accessibilityIdentifier("adresse")
            if let meldung {
                Text(meldung).foregroundStyle(.red).font(.footnote)
            }
        } header: {
            Text("Adresse des Servers")
        }
        Section {
            Button("Verbinden") { modell.sendOnboarding(.verbinden) }
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("verbinden")
            if DataScannerViewController.isSupported {
                Button("QR-Code scannen", systemImage: "qrcode.viewfinder") {
                    Task { await startScan() }
                }
            }
            if let scanHinweis {
                Text(scanHinweis).foregroundStyle(.secondary).font(.footnote)
            }
        }
    }

    @ViewBuilder
    private func abgelehnt(adresse: ServerAdresse, ergebnis: Vertragsergebnis) -> some View {
        if let status = Statusseite(ergebnis, healthVersion: modell.onboardingHealthVersion) {
            let text = status.text(servername: adresse.host, appVersion: modell.appVersion?.fullVersion)
            Section {
                Label(text.titel, systemImage: status.symbol).font(.headline)
                Text(text.text)
                ForEach(Array(text.schritte.enumerated()), id: \.offset) { nummer, schritt in
                    Text("\(nummer + 1). \(schritt)")
                }
                Text("Der Server wurde nicht gespeichert.").foregroundStyle(.secondary)
            }
            Section {
                Button("Erneut prüfen") { modell.sendOnboarding(.verbinden) }
                Button("Adresse ändern") { modell.sendOnboarding(.zurueck) }
            }
        }
    }

    /// Kamera erst nach Zustimmung; `isAvailable` ist falsch, wenn sie verweigert oder
    /// eingeschränkt ist.
    private func startScan() async {
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
        }
        if DataScannerViewController.isAvailable {
            scanHinweis = nil
            scannt = true
        } else {
            scanHinweis = "Die Kamera ist für Lifeline nicht freigegeben (Einstellungen → Lifeline → Kamera)."
        }
    }
}

/// QR-Scan mit VisionKit; meldet den ersten erkannten QR-Code mit Text.
struct QRScanner: UIViewControllerRepresentable {
    let gefunden: @MainActor (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        if !scanner.isScanning { try? scanner.startScanning() }
    }

    static func dismantleUIViewController(
        _ scanner: DataScannerViewController, coordinator: Coordinator
    ) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(gefunden: gefunden) }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let gefunden: @MainActor (String) -> Void
        private var fertig = false

        init(gefunden: @escaping @MainActor (String) -> Void) {
            self.gefunden = gefunden
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard !fertig else { return }
            for item in addedItems {
                if case .barcode(let code) = item, let text = code.payloadStringValue {
                    fertig = true
                    gefunden(text)
                    return
                }
            }
        }
    }
}
