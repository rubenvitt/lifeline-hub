import HelferKern
import SwiftUI

/// Bildschirm 4 „Angemeldet“ (Spec „Bildschirme“): große Anzeige „Ortung an“ mit Ziel, Alter der
/// letzten Sendung und Verbindungszustand, „Pausieren“/„Fortsetzen“, „Abmelden“. In der Ruhe
/// (`Phase.ruht`) „Angemeldet – Ortung ruht“ mit dem Grund und nur „Abmelden“.
struct AngemeldetSeite: View {
    @Bindable var modell: HelferModell
    @State private var abmeldenFragen = false

    private var pausiert: Bool { modell.phase == .pausiert }

    private var ruhegrund: Ruhegrund? {
        if case .ruht(let grund) = modell.phase { return grund }
        return nil
    }

    var body: some View {
        Seite {
            Seitenkopf(untertitel: modell.servername)
            if let ruhegrund {
                Zustandsbuehne(
                    augenbraue: modell.einsatzname, zustand: Ruhegrund.titel,
                    erklaerung: ruhegrund.text,
                    farbe: Farbe.achtung, flaeche: Farbe.achtungFlaeche, pulsiert: false)
            } else if pausiert {
                Zustandsbuehne(
                    augenbraue: modell.einsatzname, zustand: "Ortung pausiert",
                    erklaerung: "Die Einsatzleitung sieht „pausiert“. Deine Position geht erst nach „Fortsetzen“ wieder raus.",
                    farbe: Farbe.achtung, flaeche: Farbe.achtungFlaeche, pulsiert: false)
            } else {
                Zustandsbuehne(
                    augenbraue: modell.einsatzname, zustand: "Ortung an",
                    erklaerung: "Deine Position geht an die Einsatzleitung, auch bei gesperrtem Bildschirm.",
                    farbe: Farbe.normal, flaeche: Farbe.normalFlaeche,
                    pulsiert: modell.ortungLaeuft)
            }
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                Wertzeile(bezeichnung: "Ziel", wert: modell.zielname, symbol: "scope")
                if let person = modell.zustand?.person {
                    Wertzeile(bezeichnung: "Als Person", wert: person.name, symbol: "person.fill")
                }
                HStack(alignment: .firstTextBaseline) {
                    Label("Letzte Sendung", systemImage: "clock")
                        .schrift(Stil.klein, relativeTo: .subheadline)
                        .foregroundStyle(Farbe.gedaempft)
                    Spacer(minLength: LifelineAbstand.abstandKomfortabelSm)
                    Alter(seit: modell.letzteSendung)
                        .schrift(Stil.wert, relativeTo: .body)
                        .foregroundStyle(Farbe.text)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("letzte-sendung")
                verbindung
                if let ablauf = modell.zustand?.ablauf {
                    Wertzeile(
                        bezeichnung: "Angemeldet bis",
                        wert: ablauf.formatted(date: .omitted, time: .shortened), symbol: "hourglass")
                }
            }
            .karte()
            OrtungsHinweise(modell: modell)
            if let meldung = modell.meldung {
                Hinweis(text: meldung)
            }
            VStack(spacing: LifelineAbstand.abstandKomfortabelSm) {
                if ruhegrund != nil {
                    // In der Ruhe gibt es nichts zu pausieren; die App prüft selbst.
                } else if pausiert {
                    Button {
                        Task { await modell.fortsetzen() }
                    } label: {
                        Label("Fortsetzen", systemImage: "play.fill")
                    }
                    .buttonStyle(Hauptknopfstil(rolle: .normal))
                    .disabled(modell.beschaeftigt)
                    .accessibilityIdentifier("fortsetzen")
                } else {
                    Button {
                        Task { await modell.pausieren() }
                    } label: {
                        Label("Pausieren", systemImage: "pause.fill")
                    }
                    .buttonStyle(Hauptknopfstil(rolle: .neutral))
                    .disabled(modell.beschaeftigt)
                    .accessibilityIdentifier("pausieren")
                }
                Button("Abmelden", role: .destructive) { abmeldenFragen = true }
                    .buttonStyle(Nebenknopfstil(farbe: Farbe.alarmText))
                    .accessibilityIdentifier("abmelden")
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: pausiert)
        .confirmationDialog("Abmelden?", isPresented: $abmeldenFragen, titleVisibility: .visible) {
            Button("Abmelden", role: .destructive) { Task { await modell.abmelden() } }
            Button("Weiter orten", role: .cancel) {}
        } message: {
            Text("Die Ortung endet. Für eine neue Anmeldung brauchst du wieder den QR-Code.")
        }
    }

    @ViewBuilder
    private var verbindung: some View {
        switch modell.verbindungsstand {
        case .unbekannt:
            Wertzeile(bezeichnung: "Verbindung", wert: "wird geprüft", symbol: "antenna.radiowaves.left.and.right")
        case .verbunden:
            Wertzeile(bezeichnung: "Verbindung", wert: "verbunden", symbol: "antenna.radiowaves.left.and.right")
        case .wiederholt(let naechster):
            HStack(alignment: .firstTextBaseline) {
                Label("Verbindung", systemImage: "wifi.slash")
                    .schrift(Stil.klein, relativeTo: .subheadline)
                    .foregroundStyle(Farbe.achtungText)
                Spacer(minLength: LifelineAbstand.abstandKomfortabelSm)
                Text("ohne Netz, neuer Versuch \(naechster, style: .relative)")
                    .schrift(Stil.klein, relativeTo: .subheadline)
                    .foregroundStyle(Farbe.achtungText)
                    .multilineTextAlignment(.trailing)
            }
            .accessibilityElement(children: .combine)
        }
    }
}
