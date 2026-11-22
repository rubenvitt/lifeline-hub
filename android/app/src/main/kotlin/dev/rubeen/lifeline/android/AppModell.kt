package dev.rubeen.lifeline.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.Onboarding
import dev.rubeen.lifeline.kern.Serverliste
import dev.rubeen.lifeline.kern.Testzustand
import dev.rubeen.lifeline.kern.Updatestand

/**
 * Zustand der App als Compose-State (wie `ios/App/AppModell.swift`). Entscheidungen fallen im
 * Kern (`Ablauf`, `Onboarding`); das Modell hält ihr Ergebnis und führt die Wirkungen aus. In
 * einem [testzustand] fragt es kein Netz und speichert nichts.
 */
class AppModell(val testzustand: Testzustand?) {
    var seite: Ablauf.Seite by mutableStateOf(Ablauf.Seite.Onboarding)
        private set
    var onboarding: Onboarding.State by mutableStateOf(Onboarding.State.START)
        private set
    var liste: Serverliste by mutableStateOf(Serverliste())
        private set
    var updatestand: Updatestand by mutableStateOf(Updatestand.KEINS)
        private set

    /** Schritt des Onboardings; die Wirkungen (Prüfen, Speichern) kommen mit dem Vertragsabruf. */
    fun send(event: Onboarding.Event) {
        onboarding = Onboarding.next(onboarding, event).state
    }

    /** Schritt des Ablaufs; die Wirkungen (WebView, Prüfen, Zeitgeber) kommen mit dem WebView. */
    fun send(event: Ablauf.Event) {
        seite = Ablauf.next(seite, event).seite
    }
}
