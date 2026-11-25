import HelferKern
import SwiftUI

/// Bildschirm 5 „Beendet“ (Spec „Bildschirme“): Grund und „Neu anmelden“. Die Ortung ist aus.
struct BeendetSeite: View {
    @Bindable var modell: HelferModell
    let grund: Grund

    var body: some View {
        Seite {
            Seitenkopf()
            Zustandsbuehne(
                augenbraue: "Ortung aus", zustand: grund.titel, erklaerung: grund.text,
                farbe: Farbe.gedaempft, flaeche: Farbe.flaeche, pulsiert: false)
            if let einsatz = modell.zustand?.incident.name {
                Wertzeile(bezeichnung: "Einsatz", wert: einsatz, symbol: "flag")
                    .karte()
            }
            Button {
                modell.neuAnmelden()
            } label: {
                Label("Neu anmelden", systemImage: "qrcode.viewfinder")
            }
            .buttonStyle(Hauptknopfstil())
            .accessibilityIdentifier("neu-anmelden")
        }
        .sensoryFeedback(.warning, trigger: grund)
    }
}
