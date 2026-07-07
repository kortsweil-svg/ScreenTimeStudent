package com.screentimestudent2

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.*
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import java.util.*
import java.util.concurrent.TimeUnit

// מודול שמאפשר ל-JS לתזמן סנכרון (אותה חתימה כלפי JS - אין צורך לשנות index.js/App.tsx)
class SyncSchedulerModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "SyncScheduler"

    @ReactMethod
    fun scheduleDailySyncs(promise: Promise) {
        try {
            SyncWorkScheduler.scheduleNext(reactContext, 12, 0, SyncWorkScheduler.NOON_WORK_NAME)
            SyncWorkScheduler.scheduleNext(reactContext, 20, 0, SyncWorkScheduler.EVENING_WORK_NAME)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun cancelDailySyncs(promise: Promise) {
        try {
            WorkManager.getInstance(reactContext).cancelUniqueWork(SyncWorkScheduler.NOON_WORK_NAME)
            WorkManager.getInstance(reactContext).cancelUniqueWork(SyncWorkScheduler.EVENING_WORK_NAME)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    // אבחון זמני - קורא מ-SharedPreferences (לא AsyncStorage) כדי לוודא שה-Worker רץ בפועל,
    // בלי תלות בגשר JS/פוש. להסיר יחד עם שאר כלי האבחון לפני העלאה לגוגל.
    @ReactMethod
    fun getWorkStatus(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                SyncWorkScheduler.DIAG_PREFS_NAME, Context.MODE_PRIVATE
            )
            val map = Arguments.createMap()
            map.putString("lastRunNoon", prefs.getString(SyncWorkScheduler.KEY_LAST_RUN_PREFIX + SyncWorkScheduler.NOON_WORK_NAME, "—"))
            map.putString("lastRunEvening", prefs.getString(SyncWorkScheduler.KEY_LAST_RUN_PREFIX + SyncWorkScheduler.EVENING_WORK_NAME, "—"))
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }
}

// לוגיקת התזמון בפועל - נגיש גם ל-Worker לצורך תזמון-מחדש בסוף כל ריצה
object SyncWorkScheduler {
    const val NOON_WORK_NAME = "daily_sync_noon"
    const val EVENING_WORK_NAME = "daily_sync_evening"

    const val KEY_HOUR = "hour"
    const val KEY_MINUTE = "minute"
    const val KEY_WORK_NAME = "work_name"

    // אבחון זמני - להסיר לפני העלאה לגוגל (יחד עם getWorkStatus ב-SyncSchedulerModule)
    const val DIAG_PREFS_NAME = "sync_diagnostics"
    const val KEY_LAST_RUN_PREFIX = "last_run_"

    fun scheduleNext(context: Context, hour: Int, minute: Int, uniqueWorkName: String) {
        val delay = calculateInitialDelay(hour, minute)

        val inputData = workDataOf(
            KEY_HOUR to hour,
            KEY_MINUTE to minute,
            KEY_WORK_NAME to uniqueWorkName
        )

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setInputData(inputData)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.LINEAR, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
            .build()

        // REPLACE - אם כבר יש עבודה מתוזמנת בשם הזה (למשל בעקבות קריאה חוזרת מה-JS), מחליפים אותה
        WorkManager.getInstance(context).enqueueUniqueWork(
            uniqueWorkName,
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    private fun calculateInitialDelay(targetHour: Int, targetMinute: Int): Long {
        val now = Calendar.getInstance()
        val target = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, targetHour)
            set(Calendar.MINUTE, targetMinute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (target.timeInMillis <= now.timeInMillis) {
            target.add(Calendar.DAY_OF_YEAR, 1)
        }
        return target.timeInMillis - now.timeInMillis
    }
}

// ה-Worker בפועל: מריץ את משימת ה-JS הקיימת (BackgroundSync) ואז מתזמן את הריצה הבאה למחר
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        return try {
            // אבחון זמני - נכתב מיד כשה-Worker מתעורר, לפני שקוראים ל-JS בכלל
            val workName = inputData.getString(SyncWorkScheduler.KEY_WORK_NAME)
            if (workName != null) {
                val prefs = applicationContext.getSharedPreferences(
                    SyncWorkScheduler.DIAG_PREFS_NAME, Context.MODE_PRIVATE
                )
                val timestamp = java.text.SimpleDateFormat("dd/MM HH:mm:ss", Locale("iw", "IL")).format(Date())
                prefs.edit().putString(SyncWorkScheduler.KEY_LAST_RUN_PREFIX + workName, timestamp).apply()
            }

            // מפעיל את אותו HeadlessJsTaskService הקיים - אין שינוי בלוגיקת הסנכרון עצמה.
            // startForegroundService (לא startService רגיל) - כי קריאה מתוך Worker ללא UI
            // גלוי נחסמת על ידי אנדרואיד ("Background start not allowed") אם משתמשים ב-startService.
            val serviceIntent = Intent(applicationContext, SyncTaskService::class.java)
            ContextCompat.startForegroundService(applicationContext, serviceIntent)
            HeadlessJsTaskService.acquireWakeLockNow(applicationContext)

            // תזמון מחדש למחר, באותה שעה
            val hour = inputData.getInt(SyncWorkScheduler.KEY_HOUR, -1)
            val minute = inputData.getInt(SyncWorkScheduler.KEY_MINUTE, 0)

            if (hour >= 0 && workName != null) {
                SyncWorkScheduler.scheduleNext(applicationContext, hour, minute, workName)
            }

            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}

// שירות שמריץ את משימת ה-JS - עכשיו כשירות חזית (foreground), עם התראה מינימלית ושקטה,
// כי startForegroundService מחייב לקרוא ל-startForeground תוך זמן קצר מרגע ההפעלה
class SyncTaskService : HeadlessJsTaskService() {
    companion object {
        private const val CHANNEL_ID = "sync_service_channel"
        private const val NOTIFICATION_ID = 9001
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "סנכרון זמן מסך",
                NotificationManager.IMPORTANCE_MIN
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("מסנכרן נתוני זמן מסך")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        return HeadlessJsTaskConfig(
            "BackgroundSync",
            Arguments.createMap(),
            30000, // timeout 30 שניות
            true // allowed in foreground
        )
    }
}