package dev.rubeen.lifeline.android.update

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dev.rubeen.lifeline.android.LifelineApp
import dev.rubeen.lifeline.kern.Installzeitpunkt
import dev.rubeen.lifeline.kern.Updateentscheidung
import java.util.concurrent.TimeUnit

/**
 * Hintergrundarbeit des Updaters über WorkManager (Entwurf D9): eine Prüfung alle vier Stunden,
 * nur mit Netz, und eine Installation, wenn die App [Updateentscheidung.HINTERGRUND_MS] im
 * Hintergrund liegt. Die Rückkehr in den Vordergrund bricht die Installation ab; ob sie dann
 * wirklich installiert, entscheidet `Installzeitpunkt` im [Installationsarbeit].
 * Fehler von WorkManager stören die App nie.
 */
object UpdatePruefung {
    const val PRUEFUNG = "update-pruefung"
    const val HINTERGRUND = "update-hintergrund"
    const val IM_HINTERGRUND_SEIT = "im_hintergrund_seit"

    /** Regelmäßige Prüfung; eine schon geplante bleibt (kein Neustart der Frist bei jedem Start). */
    fun planen(context: Context) = sicher {
        val anfrage = PeriodicWorkRequestBuilder<Pruefarbeit>(Updateentscheidung.PRUEF_ABSTAND_MS, TimeUnit.MILLISECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PRUEFUNG, ExistingPeriodicWorkPolicy.KEEP, anfrage)
    }

    /** `ON_STOP`: die Installation im Hintergrund nach [Updateentscheidung.HINTERGRUND_MS]. */
    fun verlassen(context: Context, jetzt: Long) = sicher {
        val anfrage = OneTimeWorkRequestBuilder<Installationsarbeit>()
            .setInitialDelay(Updateentscheidung.HINTERGRUND_MS, TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(IM_HINTERGRUND_SEIT to jetzt))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(HINTERGRUND, ExistingWorkPolicy.REPLACE, anfrage)
    }

    /** `ON_START`: zurück im Vordergrund, keine Installation unter der Hand. */
    fun rueckkehr(context: Context) = sicher {
        WorkManager.getInstance(context).cancelUniqueWork(HINTERGRUND)
    }

    private fun sicher(arbeit: () -> Unit) {
        try {
            arbeit()
        } catch (e: IllegalStateException) {
            Log.w("Lifeline", "WorkManager nicht bereit", e)
        }
    }
}

/** Die regelmäßige Prüfung; `Updateentscheidung.isFaellig` gilt auch hier. */
class Pruefarbeit(context: Context, parameter: WorkerParameters) : CoroutineWorker(context, parameter) {
    override suspend fun doWork(): Result {
        (applicationContext as LifelineApp).updater.pruefen()
        return Result.success()
    }
}

/**
 * Installation nach längerer Zeit im Hintergrund, nur ohne Rückfrage des Systems. Steht die
 * Oberfläche inzwischen vorn (die Rückkehr kam der Absage zuvor), ist die Lage `VORDERGRUND`:
 * dann bleibt es beim Hinweis (Review K1).
 */
class Installationsarbeit(context: Context, parameter: WorkerParameters) : CoroutineWorker(context, parameter) {
    override suspend fun doWork(): Result {
        val seit = inputData.getLong(UpdatePruefung.IM_HINTERGRUND_SEIT, -1).takeIf { it >= 0 }
        val app = applicationContext as LifelineApp
        val lage = if (app.imVordergrund) Installzeitpunkt.Lage.VORDERGRUND else Installzeitpunkt.Lage.HINTERGRUND
        app.updater.installieren(lage, seit)
        return Result.success()
    }
}
