@preconcurrency import AVFoundation
import HelferKern
import SwiftUI
import VisionKit

/// Scanner über den ganzen Bildschirm (Spec „Ortung im Hintergrund“, „Scanner“):
/// `DataScannerViewController` (VisionKit), Rückfall `AVCaptureMetadataOutput`. Meldet den ersten
/// QR-Code mit Text; ob er eine Helfer-Einladung ist, entscheidet `deuteHelferLink` im Modell.
struct ScannerSeite: View {
    let gefunden: @MainActor (String) -> Void
    let abbrechen: @MainActor () -> Void

    @State private var kamera: Kamerastand = .pruefen

    enum Kamerastand { case pruefen, visionKit, avFoundation, verweigert }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch kamera {
            case .pruefen:
                ProgressView().tint(.white)
            case .visionKit:
                VisionScanner(gefunden: gefunden).ignoresSafeArea()
            case .avFoundation:
                KameraScanner(gefunden: gefunden).ignoresSafeArea()
            case .verweigert:
                VStack(spacing: LifelineAbstand.abstandKomfortabelMd) {
                    Image(systemName: "camera.fill")
                        .font(.largeTitle)
                        .foregroundStyle(Farbe.gedaempft)
                    Text("Die Kamera ist für Lifeline Helfer nicht freigegeben.")
                        .schrift(Stil.kartentitel, relativeTo: .headline)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                    Text("Einstellungen → Lifeline Helfer → Kamera. Oder „Code eingeben“ auf dem Start.")
                        .schrift(Stil.klein, relativeTo: .subheadline)
                        .foregroundStyle(Farbe.gedaempft)
                        .multilineTextAlignment(.center)
                }
                .padding(LifelineAbstand.seitenrinneBreit)
            }
            VStack {
                HStack {
                    Spacer()
                    Button {
                        abbrechen()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.title2.weight(.semibold))
                            .frame(width: 48, height: 48)
                    }
                    .foregroundStyle(.white)
                    .modifier(Schliessknopf())
                    .accessibilityLabel("Schließen")
                    .accessibilityIdentifier("scanner-schliessen")
                }
                Spacer()
                if kamera == .visionKit || kamera == .avFoundation {
                    Text("QR-Code der Einsatzleitung in den Rahmen halten")
                        .schrift(Stil.text, relativeTo: .body)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(LifelineAbstand.abstandKomfortabelSm)
                        .background(.black.opacity(0.55), in: eckig)
                }
            }
            .padding(LifelineAbstand.seitenrinneBreit)
        }
        .task { kamera = await Self.pruefeKamera() }
    }

    /// Kamera erst nach Zustimmung; VisionKit, wo es geht, sonst AVFoundation.
    private static func pruefeKamera() async -> Kamerastand {
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
        }
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            return .verweigert
        }
        if DataScannerViewController.isSupported, DataScannerViewController.isAvailable {
            return .visionKit
        }
        return AVCaptureDevice.default(for: .video) == nil ? .verweigert : .avFoundation
    }
}

/// Schließknopf: ab iOS 26 Glas, davor eine dunkle Fläche.
private struct Schliessknopf: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular.interactive(), in: Circle())
        } else {
            content.background(.black.opacity(0.55), in: Circle())
        }
    }
}

/// QR-Scan mit VisionKit.
private struct VisionScanner: UIViewControllerRepresentable {
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

/// Rückfall ohne VisionKit: `AVCaptureSession` mit `AVCaptureMetadataOutput` für QR.
private struct KameraScanner: UIViewControllerRepresentable {
    let gefunden: @MainActor (String) -> Void

    func makeUIViewController(context: Context) -> KameraController {
        KameraController(gefunden: gefunden)
    }

    func updateUIViewController(_ controller: KameraController, context: Context) {}

    static func dismantleUIViewController(_ controller: KameraController, coordinator: ()) {
        controller.stoppe()
    }
}

/// Die Aufnahmesitzung läuft auf einer eigenen Warteschlange (Apple: `startRunning` blockiert).
private final class Aufnahme: @unchecked Sendable {
    let sitzung = AVCaptureSession()
    let warteschlange = DispatchQueue(label: "dev.rubeen.lifeline.helfer.kamera")

    func starte() { warteschlange.async { self.sitzung.startRunning() } }
    func stoppe() { warteschlange.async { self.sitzung.stopRunning() } }
}

private final class KameraController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let gefunden: @MainActor (String) -> Void
    private let aufnahme = Aufnahme()
    private var vorschau: AVCaptureVideoPreviewLayer?
    private var fertig = false

    init(gefunden: @escaping @MainActor (String) -> Void) {
        self.gefunden = gefunden
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) wird nicht verwendet") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let sitzung = aufnahme.sitzung
        guard let geraet = AVCaptureDevice.default(for: .video),
            let eingang = try? AVCaptureDeviceInput(device: geraet),
            sitzung.canAddInput(eingang)
        else { return }
        sitzung.addInput(eingang)
        let ausgang = AVCaptureMetadataOutput()
        guard sitzung.canAddOutput(ausgang) else { return }
        sitzung.addOutput(ausgang)
        ausgang.setMetadataObjectsDelegate(self, queue: .main)
        ausgang.metadataObjectTypes = [.qr]
        let ebene = AVCaptureVideoPreviewLayer(session: sitzung)
        ebene.videoGravity = .resizeAspectFill
        view.layer.addSublayer(ebene)
        vorschau = ebene
        aufnahme.starte()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        vorschau?.frame = view.bounds
    }

    func stoppe() { aufnahme.stoppe() }

    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        let text = metadataObjects.lazy
            .compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
            .first
        guard let text else { return }
        // Die Warteschlange des Delegates ist `.main`.
        MainActor.assumeIsolated {
            guard !fertig else { return }
            fertig = true
            aufnahme.stoppe()
            gefunden(text)
        }
    }
}
