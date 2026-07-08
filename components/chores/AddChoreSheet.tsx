import { forwardRef, useState, useCallback, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Modal, Switch } from 'react-native'
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet'
import DateTimePicker from '@react-native-community/datetimepicker'
import { LinearGradient } from 'expo-linear-gradient'
import { Colors, Fonts, Radii } from '@/constants/theme'
import { Chore, Frequency, HouseMember } from '@/types/database'
import { useUserAccent } from '@/context/UserAccentContext'

function localDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
const DAYS = [
  { value: 0, label: 'S' },
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
]

type RepeatMode = 'once' | Frequency

const REPEAT_OPTIONS: { value: RepeatMode; label: string }[] = [
  { value: 'once', label: 'One time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
]

interface ChoreParams {
  name: string
  assignedTo: string | null
  dueDate: string | null
  notes: string | null
  frequency: Frequency
  daysOfWeek: number[] | null
  reminderTime: string | null
  rotationEnabled: boolean
  houseId: string
  createdBy: string
  pointValue: number
}

interface AddChoreSheetProps {
  members: HouseMember[]
  currentUserId: string
  houseId: string
  editingChore?: Chore | null
  onAdd: (params: ChoreParams) => Promise<{ error: string | null }>
  onUpdate?: (choreId: string, updates: Partial<Omit<ChoreParams, 'houseId' | 'createdBy'>>) => Promise<{ error: string | null }>
  onClose: () => void
}

export const AddChoreSheet = forwardRef<BottomSheet, AddChoreSheetProps>(
  function AddChoreSheet({ members, currentUserId, houseId, editingChore, onAdd, onUpdate, onClose }, ref) {
    const [name, setName] = useState('')
    const [assignedTo, setAssignedTo] = useState<string | null>(currentUserId)
    const [rotationEnabled, setRotationEnabled] = useState(false)
    const [reminderEnabled, setReminderEnabled] = useState(false)
    const [reminderTime, setReminderTime] = useState<Date>(() => {
      const d = new Date(); d.setHours(8, 0, 0, 0); return d
    })
    const [showReminderPicker, setShowReminderPicker] = useState(false)
    const [notes, setNotes] = useState('')
    const [repeatMode, setRepeatMode] = useState<RepeatMode>('weekly')
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1])
    const [oneTimeDate, setOneTimeDate] = useState<Date>(new Date())
    const [showDatePicker, setShowDatePicker] = useState(false)
    const [pointValue, setPointValue] = useState(editingChore?.point_value ?? 10)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    const resetForm = useCallback(() => {
      setName('')
      setNotes('')
      setRepeatMode('weekly')
      setDaysOfWeek([1])
      setOneTimeDate(new Date())
      setShowDatePicker(false)
      setAssignedTo(currentUserId)
      setRotationEnabled(false)
      setReminderEnabled(false)
      const d = new Date(); d.setHours(8, 0, 0, 0)
      setReminderTime(d)
      setShowReminderPicker(false)
      setPointValue(10)
    }, [currentUserId])

    useEffect(() => {
      if (editingChore) {
        setName(editingChore.name)
        setAssignedTo(editingChore.assigned_to)
        setNotes(editingChore.notes ?? '')
        if (editingChore.due_date) {
          setRepeatMode('once')
          setOneTimeDate(new Date(editingChore.due_date + 'T00:00:00'))
        } else {
          const freq: RepeatMode = editingChore.frequency === 'daily' ? 'weekly' : editingChore.frequency
          setRepeatMode(freq)
          setDaysOfWeek(
            editingChore.days_of_week?.length
              ? editingChore.days_of_week
              : editingChore.frequency === 'daily'
                ? [0, 1, 2, 3, 4, 5, 6]
                : [1]
          )
        }
        setPointValue(editingChore?.point_value ?? 10)
        setRotationEnabled(editingChore.rotation_enabled ?? false)
        if (editingChore.reminder_time) {
          setReminderEnabled(true)
          const [h, m] = editingChore.reminder_time.split(':').map(Number)
          const d = new Date(); d.setHours(h, m, 0, 0)
          setReminderTime(d)
        } else {
          setReminderEnabled(false)
        }
      } else {
        resetForm()
      }
    }, [editingChore, resetForm])

    function toggleDay(day: number) {
      setDaysOfWeek(prev =>
        prev.includes(day)
          ? prev.length > 1 ? prev.filter(d => d !== day) : prev // keep at least 1
          : [...prev, day].sort((a, b) => a - b)
      )
    }

    async function handleSave() {
      if (!name.trim()) return
      setSaving(true)
      setSaveError(null)

      const isOnce = repeatMode === 'once'
      const dueDateStr = isOnce ? localDateStr(oneTimeDate) : null
      const frequency: Frequency = isOnce ? 'weekly' : (repeatMode as Frequency)
      const days = isOnce ? null : daysOfWeek
      const reminderStr = reminderEnabled
        ? `${String(reminderTime.getHours()).padStart(2, '0')}:${String(reminderTime.getMinutes()).padStart(2, '0')}`
        : null

      let error: string | null = null
      try {
        if (editingChore && onUpdate) {
          const result = await onUpdate(editingChore.id, {
            name: name.trim(), assignedTo, dueDate: dueDateStr,
            notes: notes.trim() || null, frequency, daysOfWeek: days,
            reminderTime: reminderStr, rotationEnabled, pointValue,
          })
          error = result.error
        } else {
          const result = await onAdd({
            name: name.trim(), assignedTo, dueDate: dueDateStr,
            notes: notes.trim() || null, frequency, daysOfWeek: days,
            reminderTime: reminderStr, rotationEnabled, houseId, createdBy: currentUserId,
            pointValue,
          })
          error = result.error
        }
      } catch (e: unknown) {
        error = e instanceof Error ? e.message : 'An unexpected error occurred.'
      } finally {
        setSaving(false)
      }

      if (error) {
        setSaveError(error)
      } else {
        resetForm()
        onClose()
      }
    }

    const assigneeOptions = [
      { user_id: null as string | null, label: 'Anyone' },
      ...members.map(m => ({
        user_id: m.user_id,
        label: m.user_id === currentUserId ? 'You' : m.profile?.display_name?.split(' ')[0] ?? '?',
      })),
    ]

    const isEdit = !!editingChore
    const { accentColor, accentGradient } = useUserAccent()

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={['90%']}
        enablePanDownToClose
        onClose={onClose}
        bottomInset={96}
        backgroundStyle={{ backgroundColor: Colors.surface }}
        handleIndicatorStyle={{ backgroundColor: Colors.outlineVariant }}
      >
        <BottomSheetView style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{isEdit ? 'Edit chore' : 'New chore'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
            <TextInput
              style={styles.nameInput}
              placeholder="Chore name"
              placeholderTextColor={Colors.onSurfaceVariant}
              value={name}
              onChangeText={setName}
              autoFocus={!isEdit}
              returnKeyType="next"
            />

            {/* Assign to */}
            <Text style={styles.fieldLabel}>Assign to</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
              {assigneeOptions.map(opt => {
                const isActive = assignedTo === opt.user_id
                return (
                  <TouchableOpacity
                    key={String(opt.user_id)}
                    onPress={() => setAssignedTo(opt.user_id)}
                    style={[styles.pill, isActive && { backgroundColor: accentColor }]}
                  >
                    <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            {/* How often — One time / Weekly / Every 2 wks / Monthly */}
            <Text style={styles.fieldLabel}>How often</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
              {REPEAT_OPTIONS.map(opt => {
                const isActive = repeatMode === opt.value
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => setRepeatMode(opt.value)}
                    style={[styles.pill, isActive && { backgroundColor: accentColor }]}
                  >
                    <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            {/* One-time: date picker */}
            {repeatMode === 'once' ? (
              <>
                <Text style={styles.fieldLabel}>Date</Text>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Text style={styles.dateBtnText}>
                    {oneTimeDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </TouchableOpacity>
                <Modal
                  visible={showDatePicker}
                  transparent
                  animationType="fade"
                  onRequestClose={() => setShowDatePicker(false)}
                >
                  <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDatePicker(false)}>
                    <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
                      <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Pick a date</Text>
                        <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                          <Text style={[styles.modalDone, { color: accentColor }]}>Done</Text>
                        </TouchableOpacity>
                      </View>
                      <DateTimePicker
                        value={oneTimeDate}
                        mode="date"
                        display="inline"
                        onChange={(_, selected) => { if (selected) setOneTimeDate(selected) }}
                        style={{ width: '100%' }}
                        themeVariant="light"
                      />
                    </TouchableOpacity>
                  </TouchableOpacity>
                </Modal>
              </>
            ) : (
              /* Repeating: day-of-week picker */
              <>
                <Text style={styles.fieldLabel}>Repeats on</Text>
                <View style={styles.dayRow}>
                  {DAYS.map(day => {
                    const isActive = daysOfWeek.includes(day.value)
                    return (
                      <TouchableOpacity
                        key={day.value}
                        onPress={() => toggleDay(day.value)}
                        style={[styles.dayBtn, isActive && { backgroundColor: accentColor, borderColor: accentColor }]}
                      >
                        <Text style={[styles.dayBtnText, isActive && styles.dayBtnTextActive]}>
                          {day.label}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            )}

            {/* Reminder */}
            <View style={styles.reminderRow}>
              <View style={styles.reminderLeft}>
                <Text style={styles.fieldLabel}>Remind me</Text>
                {reminderEnabled && (
                  <TouchableOpacity onPress={() => setShowReminderPicker(true)} style={styles.reminderTimeBtn}>
                    <Text style={[styles.reminderTimeText, { color: accentColor }]}>
                      {reminderTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <Switch
                value={reminderEnabled}
                onValueChange={setReminderEnabled}
                trackColor={{ false: Colors.surfaceContainerHigh, true: accentColor }}
                thumbColor="#fff"
              />
            </View>
            <Modal
              visible={showReminderPicker}
              transparent
              animationType="fade"
              onRequestClose={() => setShowReminderPicker(false)}
            >
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowReminderPicker(false)}>
                <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Reminder time</Text>
                    <TouchableOpacity onPress={() => setShowReminderPicker(false)}>
                      <Text style={[styles.modalDone, { color: accentColor }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={reminderTime}
                    mode="time"
                    display="spinner"
                    onChange={(_, selected) => { if (selected) setReminderTime(selected) }}
                    style={{ width: '100%' }}
                    themeVariant="light"
                  />
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>

            {/* Notes */}
            <Text style={styles.fieldLabel}>Notes <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Any details..."
              placeholderTextColor={Colors.onSurfaceVariant}
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            {/* Points */}
            <Text style={styles.fieldLabel}>Points</Text>
            <TextInput
              style={styles.input}
              value={String(pointValue)}
              onChangeText={v => setPointValue(Math.max(1, parseInt(v.replace(/[^0-9]/g, '')) || 1))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="10"
              placeholderTextColor={Colors.onSurfaceVariant}
            />

            {/* Rotation */}
            <View style={styles.reminderRow}>
              <View style={styles.reminderLeft}>
                <Text style={styles.fieldLabel}>Rotate between roommates</Text>
                <Text style={styles.rotateHint}>After each completion, reassign to the next person</Text>
              </View>
              <Switch
                value={rotationEnabled}
                onValueChange={setRotationEnabled}
                trackColor={{ false: Colors.surfaceContainerHigh, true: accentColor }}
                thumbColor="#fff"
              />
            </View>
          </ScrollView>

          {saveError && (
            <Text style={styles.errorText}>{saveError}</Text>
          )}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || !name.trim()}
            style={[styles.saveWrapper, (!name.trim() || saving) && styles.saveWrapperDisabled]}
          >
            <LinearGradient colors={accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveBtn}>
              <Text style={styles.saveBtnText}>
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add chore ✶'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </BottomSheetView>
      </BottomSheet>
    )
  }
)

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingBottom: 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.onSurface },
  cancel: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  nameInput: {
    fontSize: 18, fontFamily: Fonts.bold, color: Colors.onSurface,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant, marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 11, fontFamily: Fonts.bold, color: Colors.onSurfaceVariant,
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10,
  },
  optional: { textTransform: 'none', fontSize: 11, fontFamily: Fonts.regular, color: Colors.outline, letterSpacing: 0 },
  pillRow: { flexDirection: 'row', gap: 8, paddingBottom: 20 },
  pill: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radii.pill, paddingHorizontal: 16, paddingVertical: 8 },
  pillActive: { backgroundColor: Colors.primary },
  pillText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
  pillTextActive: { color: '#fff' },

  // Day-of-week selector
  dayRow: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  dayBtn: {
    flex: 1, aspectRatio: 1, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerHigh,
    borderWidth: 1.5, borderColor: Colors.outlineVariant,
  },
  dayBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayBtnText: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.onSurfaceVariant },
  dayBtnTextActive: { color: '#fff' },

  dateBtn: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radii.card,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.outlineVariant, marginBottom: 20,
  },
  dateBtnText: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurface },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 20, width: '100%', overflow: 'hidden', padding: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 15, fontFamily: Fonts.bold, color: Colors.onSurface },
  modalDone: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.primary },
  input: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radii.card,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: Fonts.regular,
    borderWidth: 1, borderColor: Colors.outlineVariant, marginBottom: 20, color: Colors.onSurface,
  },
  notesInput: { height: 72, textAlignVertical: 'top' },
  reminderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  reminderLeft: { flex: 1, gap: 4 },
  rotateHint: { fontSize: 11, fontFamily: Fonts.regular, color: Colors.onSurfaceVariant },
  reminderTimeBtn: { alignSelf: 'flex-start' },
  reminderTimeText: { fontSize: 15, fontFamily: Fonts.semibold },
  errorText: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.error, textAlign: 'center', marginBottom: 8 },
  saveWrapper: { marginTop: 8, marginBottom: 20 },
  saveWrapperDisabled: { opacity: 0.5 },
  saveBtn: { borderRadius: Radii.pill, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontFamily: Fonts.bold, color: '#fff' },
})
