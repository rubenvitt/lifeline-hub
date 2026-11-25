import HelferKern
import SwiftUI

/// Bildschirm 1 „Start“ (Spec „Bildschirme“): QR-Code scannen, darunter Code eingeben.
struct StartSeite: View {
    @Bindable var modell: HelferModell
    @State private var scannt = false
    @State private var eingabe = false

    var body: some View {
        Seite {
            Seitenkopf()
            Spacer(minLength: LifelineAbstand.abstandKomfortabelXl)
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                Augenbraue("Am Einsatz anmelden")
                Text("Scanne den QR-Code der Einsatzleitung.")
                    .schrift(Stil.titel, relativeTo: .largeTitle)
                    .foregroundStyle(Farbe.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(
                    "Danach siehst du Einsatz und Ziel und meldest dich mit deinem Namen an. Deine Position geht nur an diesen Einsatz und nur, solange du angemeldet bist."
                )
                .schrift(Stil.text, relativeTo: .body)
                .foregroundStyle(Farbe.text2)
                .fixedSize(horizontal: false, vertical: true)
            }
            Sucherbild()
                .frame(maxWidth: .infinity)
                .padding(.vertical, LifelineAbstand.abstandKomfortabelMd)
            if let meldung = modell.meldung {
                Hinweis(text: meldung)
            }
            VStack(spacing: LifelineAbstand.abstandKomfortabelSm) {
                Button {
                    modell.meldung = nil
                    scannt = true
                } label: {
                    Label("QR-Code scannen", systemImage: "qrcode.viewfinder")
                }
                .buttonStyle(Hauptknopfstil())
                .accessibilityIdentifier("scannen")
                Button("Code eingeben") {
                    modell.meldung = nil
                    eingabe = true
                }
                .buttonStyle(Nebenknopfstil())
                .accessibilityIdentifier("code-eingeben")
            }
        }
        .fullScreenCover(isPresented: $scannt) {
            ScannerSeite { text in
                scannt = false
                modell.gescannt(text)
            } abbrechen: {
                scannt = false
            }
        }
        .sheet(isPresented: $eingabe) {
            CodeEingabe(modell: modell) { eingabe = false }
                .presentationDetents([.medium, .large])
        }
    }
}

/// Rahmen eines Suchers als ruhiges Bild auf dem Start.
private struct Sucherbild: View {
    @ScaledMetric(relativeTo: .largeTitle) private var groesse: CGFloat = 150

    var body: some View {
        ZStack {
            Ecken().stroke(Farbe.bedien, style: StrokeStyle(lineWidth: 4, lineCap: .square))
            Image(systemName: "qrcode")
                .font(.system(size: groesse * 0.45, weight: .regular))
                .foregroundStyle(Farbe.gedaempft)
        }
        .frame(width: groesse, height: groesse)
        .accessibilityHidden(true)
    }

    /// Vier Ecken eines Suchers.
    struct Ecken: Shape {
        func path(in rect: CGRect) -> Path {
            let laenge = rect.width * 0.22
            var pfad = Path()
            let ecken: [(CGPoint, CGFloat, CGFloat)] = [
                (CGPoint(x: rect.minX, y: rect.minY), 1.0, 1.0),
                (CGPoint(x: rect.maxX, y: rect.minY), -1.0, 1.0),
                (CGPoint(x: rect.minX, y: rect.maxY), 1.0, -1.0),
                (CGPoint(x: rect.maxX, y: rect.maxY), -1.0, -1.0),
            ]
            for (ecke, x, y) in ecken {
                pfad.move(to: CGPoint(x: ecke.x + laenge * x, y: ecke.y))
                pfad.addLine(to: ecke)
                pfad.addLine(to: CGPoint(x: ecke.x, y: ecke.y + laenge * y))
            }
            return pfad
        }
    }
}

/// „Code eingeben“: Server und Code von Hand, falls die Kamera nicht geht.
struct CodeEingabe: View {
    @Bindable var modell: HelferModell
    let fertig: () -> Void
    @State private var server = ""
    @State private var code = ""

    var body: some View {
        NavigationStack {
            Seite {
                VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                    Augenbraue("Code eingeben")
                    Text("Server und Code stehen unter dem QR-Code der Einsatzleitung.")
                        .schrift(Stil.text, relativeTo: .body)
                        .foregroundStyle(Farbe.text2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Eingabefeld(titel: "Server", text: $server, beispiel: "elw.example.org", kennung: "server")
                    .keyboardType(.URL)
                    .submitLabel(.next)
                Eingabefeld(
                    titel: "Code", text: $code, beispiel: "AB12CD34", mono: true, kennung: "code"
                )
                .submitLabel(.go)
                .onSubmit(uebernehmen)
                if let meldung = modell.meldung {
                    Hinweis(text: meldung)
                }
                Button("Weiter", action: uebernehmen)
                    .buttonStyle(Hauptknopfstil())
                    .disabled(server.isEmpty || code.isEmpty)
                    .accessibilityIdentifier("weiter")
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen", action: fertig)
                }
            }
        }
    }

    private func uebernehmen() {
        if modell.eingegeben(server: server, code: code) { fertig() }
    }
}

/// Eingabefeld im Design System: Augenbraue, eckige Fläche, feine Linie.
struct Eingabefeld: View {
    let titel: String
    @Binding var text: String
    var beispiel = ""
    /// Code: gleich breite Ziffern, Großbuchstaben.
    var mono = false
    var kennung: String

    var body: some View {
        VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelXs) {
            Augenbraue(titel)
            TextField(titel, text: $text, prompt: Text(beispiel))
                .schrift(mono ? Stil.wert : Stil.text, relativeTo: .body)
                .foregroundStyle(Farbe.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(mono ? .characters : .never)
                .accessibilityIdentifier(kennung)
                .padding(.horizontal, LifelineAbstand.abstandKomfortabelSm)
                .frame(minHeight: LifelineGroesse.steuerhoeheKomfortabel)
                .background(Farbe.flaeche, in: eckig)
                .overlay(eckig.strokeBorder(Farbe.linieStark, lineWidth: 1))
        }
    }
}
