import * as Notifications from 'expo-notifications'
import { Chore } from '@/types/database'

export async function cancelChoreNotifications(choreId: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync()
  const toCancel = scheduled.filter(n => n.identifier.startsWith(`chore-${choreId}`))
  await Promise.all(toCancel.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)))
}

export async function scheduleChoreNotifications(chore: Chore) {
  await cancelChoreNotifications(chore.id)
  if (!chore.reminder_time) return

  const [h, m] = chore.reminder_time.split(':').map(Number)
  const content = {
    title: 'Chore reminder 🧹',
    body: `Time to: ${chore.name}`,
    data: { choreId: chore.id },
  }

  if (chore.due_date) {
    // One-time chore — fire once at the specific date + time
    const triggerDate = new Date(`${chore.due_date}T${chore.reminder_time}:00`)
    if (triggerDate > new Date()) {
      await Notifications.scheduleNotificationAsync({
        identifier: `chore-${chore.id}`,
        content,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
      })
    }
  } else if (chore.days_of_week?.length) {
    // Repeating chore — one weekly trigger per day-of-week
    for (const day of chore.days_of_week) {
      await Notifications.scheduleNotificationAsync({
        identifier: `chore-${chore.id}-day-${day}`,
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: day + 1, // expo: 1=Sun … 7=Sat
          hour: h,
          minute: m,
        },
      })
    }
  }
}

// Call on app start to re-sync all chore notifications
export async function syncAllChoreNotifications(chores: Chore[]) {
  await Promise.all(chores.map(scheduleChoreNotifications))
}
