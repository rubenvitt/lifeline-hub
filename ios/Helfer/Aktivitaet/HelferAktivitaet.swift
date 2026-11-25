import ActivityKit
import AppIntents
import HelferKern
import SwiftUI
import WidgetKit

/// Widget-Erweiterung der Helfer-App: nur die Live-Aktivität der Ortung (ADR-0101: die Ortung ist
/// sichtbar). Kein Netz, keine Ablage; „Pausieren“ führt die App aus (`PausierenIntent`).
@main
struct HelferAktivitaetBundle: WidgetBundle {
    var body: some Widget {
        OrtungAktivitaet()
    }
}

struct OrtungAktivitaet: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OrtungAttribute.self) { kontext in
            Sperrbildschirm(
                attribute: kontext.attributes, zustand: kontext.state, veraltet: kontext.isStale
            )
            .activityBackgroundTint(Farbe.flaeche)
            .activitySystemActionForegroundColor(Farbe.text)
        } dynamicIsland: { kontext in
            let zustand = kontext.state
            let anzeige = Anzeige(zustand: zustand, veraltet: kontext.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(anzeige.titel).font(.headline)
                    } icon: {
                        Image(systemName: anzeige.symbol)
                    }
                    .foregroundStyle(anzeige.farbe)
                    .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Sendezeit(zustand: zustand).font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(kontext.attributes.einsatz).font(.subheadline.weight(.semibold))
                            Text(kontext.attributes.ziel).font(.caption).foregroundStyle(.secondary)
                        }
                        .lineLimit(1)
                        Spacer(minLength: 8)
                        if !zustand.pausiert {
                            PausierenKnopf()
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: anzeige.symbol).foregroundStyle(anzeige.farbe)
            } compactTrailing: {
                Sendezeit(zustand: zustand).font(.caption.monospacedDigit())
                    .frame(maxWidth: 56)
            } minimal: {
                Image(systemName: anzeige.symbol).foregroundStyle(anzeige.farbe)
            }
            .keylineTint(anzeige.farbe)
        }
    }
}

/// Titel, Symbol und Farbe je Zustand.
struct Anzeige {
    let titel: String
    let symbol: String
    let farbe: Color

    init(zustand: OrtungAttribute.ContentState, veraltet: Bool) {
        if zustand.pausiert {
            titel = "Pausiert"
            symbol = "pause.fill"
            farbe = Farbe.achtung
        } else if veraltet {
            // Keine Änderung seit zwei Lebenszeichen: die App läuft womöglich nicht mehr.
            titel = "Ortung unterbrochen"
            symbol = "location.slash.fill"
            farbe = Farbe.alarm
        } else if zustand.wartet {
            titel = "Wartet auf Bestätigung"
            symbol = "hourglass"
            farbe = Farbe.achtung
        } else {
            titel = "Ortung an"
            symbol = "location.fill"
            farbe = Farbe.normal
        }
    }
}

/// Alter der letzten Sendung, vom System fortgeschrieben.
struct Sendezeit: View {
    let zustand: OrtungAttribute.ContentState

    var body: some View {
        if let letzte = zustand.letzteSendung {
            Text(letzte, style: .relative).multilineTextAlignment(.trailing)
        } else {
            Text("–")
        }
    }
}

struct PausierenKnopf: View {
    var body: some View {
        Button(intent: PausierenIntent()) {
            Label("Pausieren", systemImage: "pause.fill")
                .font(.subheadline.weight(.semibold))
        }
        .tint(Farbe.bedien)
        .accessibilityIdentifier("aktivitaet-pausieren")
    }
}

/// Sperrbildschirm und Banner: Marke, Zustand, Einsatz und Ziel, letzte Sendung, „Pausieren“.
struct Sperrbildschirm: View {
    let attribute: OrtungAttribute
    let zustand: OrtungAttribute.ContentState
    let veraltet: Bool

    var body: some View {
        let anzeige = Anzeige(zustand: zustand, veraltet: veraltet)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: "cross.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(Farbe.marke)
                Label {
                    Text(anzeige.titel)
                        .schrift(Stil.kartentitel, relativeTo: .headline)
                } icon: {
                    Image(systemName: anzeige.symbol)
                }
                .foregroundStyle(anzeige.farbe)
                Spacer(minLength: 8)
                if let letzte = zustand.letzteSendung {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("Letzte Sendung")
                            .font(.caption2)
                            .foregroundStyle(Farbe.gedaempft)
                        Text(letzte, style: .relative)
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(Farbe.text)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(attribute.einsatz)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Farbe.text)
                    Text(attribute.ziel)
                        .font(.caption)
                        .foregroundStyle(Farbe.gedaempft)
                }
                .lineLimit(1)
                Spacer(minLength: 8)
                if !zustand.pausiert {
                    PausierenKnopf()
                } else {
                    Text("Fortsetzen in der App")
                        .font(.caption)
                        .foregroundStyle(Farbe.gedaempft)
                }
            }
        }
        .padding(16)
    }
}
