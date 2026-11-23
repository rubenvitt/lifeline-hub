package dev.rubeen.lifeline.android

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.view.HapticFeedbackConstants
import androidx.activity.ComponentActivity
import androidx.core.content.edit
import dev.rubeen.lifeline.android.dienste.Anmelder
import dev.rubeen.lifeline.android.dienste.Anmeldeweg
import dev.rubeen.lifeline.android.dienste.Downloads
import dev.rubeen.lifeline.android.dienste.Systemdienste
import dev.rubeen.lifeline.kern.Brueckenausfuehrung
import dev.rubeen.lifeline.kern.Brueckenbefehl
import dev.rubeen.lifeline.kern.Haptik
import dev.rubeen.lifeline.kern.Meldungsfreigabe
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * Die Systemdienste der Brücke (Entwurf D6): Haptik nach Android-Version, der Schalter
 * „Haptik“, Meldungen im Kanal „Lifeline“ nach der Berechtigung `POST_NOTIFICATIONS`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SystemdiensteTest {
    // Die Dienste melden ein Activity-Ergebnis an: vor dem Start der Activity, wie in `onCreate`.
    private val steuerung = Robolectric.buildActivity(ComponentActivity::class.java).create()
    private val activity: ComponentActivity = steuerung.get()
    private val einstellungen = activity.getSharedPreferences("lifeline", Context.MODE_PRIVATE)
    private val dienste = Systemdienste(
        activity = activity,
        webView = { null },
        anmelder = Anmelder(webView = { null }, aktiverServer = { null }, oeffne = { Anmeldeweg.CUSTOM_TAB }),
        downloads = Downloads(activity, CoroutineScope(Dispatchers.Unconfined), aktiverServer = { null }, cookie = { _, _ -> null }),
        einstellungen = einstellungen,
    )
    private val fenster = shadowOf(activity.window.decorView)

    init {
        steuerung.start().resume().visible()
    }

    private fun haptik(kind: String) = runBlocking { Brueckenausfuehrung.run(Brueckenbefehl.Haptics(kind), dienste) }

    @Test
    fun `jede Rückmeldung hat ihre Konstante je API-Stufe`() {
        val erwartet = mapOf(
            29 to listOf(
                HapticFeedbackConstants.VIRTUAL_KEY,
                HapticFeedbackConstants.LONG_PRESS,
                HapticFeedbackConstants.LONG_PRESS,
                HapticFeedbackConstants.CLOCK_TICK,
                HapticFeedbackConstants.KEYBOARD_TAP,
            ),
            30 to listOf(
                HapticFeedbackConstants.CONFIRM,
                HapticFeedbackConstants.REJECT,
                HapticFeedbackConstants.LONG_PRESS,
                HapticFeedbackConstants.CLOCK_TICK,
                HapticFeedbackConstants.KEYBOARD_TAP,
            ),
            33 to listOf(
                HapticFeedbackConstants.CONFIRM,
                HapticFeedbackConstants.REJECT,
                HapticFeedbackConstants.LONG_PRESS,
                HapticFeedbackConstants.CLOCK_TICK,
                HapticFeedbackConstants.KEYBOARD_TAP,
            ),
            34 to listOf(
                HapticFeedbackConstants.CONFIRM,
                HapticFeedbackConstants.REJECT,
                HapticFeedbackConstants.LONG_PRESS,
                HapticFeedbackConstants.SEGMENT_TICK,
                HapticFeedbackConstants.KEYBOARD_TAP,
            ),
        )
        val folge = listOf(Haptik.Feedback.CONFIRM, Haptik.Feedback.REJECT, Haptik.Feedback.WARNING, Haptik.Feedback.SELECTION, Haptik.Feedback.TAP)
        for ((sdk, konstanten) in erwartet) {
            assertEquals("API $sdk", konstanten, folge.map { Systemdienste.hapticKonstante(it, sdk) })
        }
    }

    @Test
    fun `die Seite spielt Haptik über das Fenster der Activity`() {
        haptik("success")
        assertEquals(HapticFeedbackConstants.CONFIRM, fenster.lastHapticFeedbackPerformed())

        haptik("selection")
        assertEquals(HapticFeedbackConstants.SEGMENT_TICK, fenster.lastHapticFeedbackPerformed())
    }

    @Test
    fun `ohne gespeicherten Schalter ist Haptik an, ausgeschaltet spielt nichts`() {
        assertTrue(dienste.isHaptikEnabled)
        val vorher = fenster.lastHapticFeedbackPerformed()

        einstellungen.edit(commit = true) { putBoolean(Haptik.SCHALTER_SCHLUESSEL, false) }
        haptik("error")

        assertFalse(dienste.isHaptikEnabled)
        assertEquals(vorher, fenster.lastHapticFeedbackPerformed())
    }

    @Test
    fun `nie gefragt ist die Freigabe offen, nach der Frage ohne Erlaubnis verweigert`() {
        assertEquals(Meldungsfreigabe.OFFEN, runBlocking { dienste.loadMeldungsfreigabe() })

        einstellungen.edit(commit = true) { putBoolean(Systemdienste.MELDUNG_GEFRAGT, true) }

        assertEquals(Meldungsfreigabe.VERWEIGERT, runBlocking { dienste.loadMeldungsfreigabe() })
    }

    @Test
    fun `die erste Meldung fragt nach der Berechtigung`() {
        // Die Antwort des Systems kommt hier nicht; es zählt, dass die App fragt.
        CoroutineScope(Dispatchers.Unconfined).launch {
            Brueckenausfuehrung.run(Brueckenbefehl.ShowNotification(1, "Lage", null), dienste)
        }

        assertEquals(Manifest.permission.POST_NOTIFICATIONS, shadowOf(activity).lastRequestedPermission?.requestedPermissions?.single())
        assertTrue(einstellungen.getBoolean(Systemdienste.MELDUNG_GEFRAGT, false))
    }

    @Test
    fun `mit Berechtigung erscheint die Meldung im Kanal Lifeline`() {
        shadowOf(activity.application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)

        val antwort = runBlocking {
            Brueckenausfuehrung.run(Brueckenbefehl.ShowNotification(3, "Neue Lage", "Abschnitt Nord"), dienste)
        }

        assertNull(antwort!!.fehler)
        val verwaltung = activity.getSystemService(NotificationManager::class.java)
        val kanal = verwaltung.getNotificationChannel(Systemdienste.KANAL)
        assertEquals("Lifeline", kanal.name)
        val meldung = shadowOf(verwaltung).allNotifications.single()
        assertEquals(Systemdienste.KANAL, meldung.channelId)
        assertEquals("Neue Lage", meldung.extras.getString("android.title"))
        assertEquals("Abschnitt Nord", meldung.extras.getCharSequence("android.text").toString())
    }
}
