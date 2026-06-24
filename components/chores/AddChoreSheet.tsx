import { forwardRef, useState, useCallback } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet'
import { LinearGradient } from 'expo-linear-gradient'
import { Colors, Radii, PrimaryGradient } from '@/constants/theme'
import { HouseMember } from '@/types/database'

interface AddChoreParams {
  name: string
  assignedTo: string | null
  dueDate: string | null
  notes: string | null
  frequency: 'daily' | 'weekly'
  houseId: string
  createdBy: string
}

interface AddChoreSheetProps {
  members: HouseMember[]
  currentUserId: string
  houseId: string
  onAdd: (params: AddChoreParams) => Promise<{ error: string | null }>
  onClose: () => void
}

export const AddChoreSheet = forwardRef<BottomSheet, AddChoreSheetProps>(
  function AddChoreSheet({ members, currentUserId, houseId, onAdd, onClose }, ref) {
    const [name, setName] = useState('')
    const [assignedTo, setAssignedTo] = useState<string | null>(currentUserId)
    const [dueDate, setDueDate] = useState('')
    const [notes, setNotes] = useState('')
    const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily')
    const [saving, setSaving] = useState(false)

    const resetForm = useCallback(() => {
      setName('')
      setNotes('')
      setDueDate('')
      setAssignedTo(currentUserId)
      setFrequency('daily')
    }, [currentUserId])

    async function handleSave() {
      if (!name.trim()) return
      setSaving(true)
      const { error } = await onAdd({
        name: name.trim(),
        assignedTo,
        dueDate: dueDate.trim() || null,
        notes: notes.trim() || null,
        frequency,
        houseId,
        createdBy: currentUserId,
      })
      setSaving(false)
      if (!error) {
        resetForm()
        onClose()
      }
    }

    const assigneeOptions = [
      { user_id: null as string | null, label: 'Unassigned' },
      ...members.map(m => ({
        user_id: m.user_id,
        label: m.user_id === currentUserId ? 'You' : m.profile?.display_name?.split(' ')[0] ?? '?',
      })),
    ]

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={['75%']}
        enablePanDownToClose
        onClose={onClose}
        backgroundStyle={{ backgroundColor: Colors.background }}
        handleIndicatorStyle={{ backgroundColor: Colors.mutedSurface }}
      >
        <BottomSheetView style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>New chore</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <TextInput
              style={styles.nameInput}
              placeholder="Chore name"
              placeholderTextColor={Colors.textSecondary}
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="next"
            />

            <Text style={styles.fieldLabel}>Assign to</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
            >
              {assigneeOptions.map(opt => {
                const isActive = assignedTo === opt.user_id
                return (
                  <TouchableOpacity
                    key={String(opt.user_id)}
                    onPress={() => setAssignedTo(opt.user_id)}
                    style={[styles.pill, isActive && styles.pillActive]}
                  >
                    <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            <Text style={styles.fieldLabel}>Frequency</Text>
            <View style={styles.toggleRow}>
              {(['daily', 'weekly'] as const).map(f => (
                <TouchableOpacity
                  key={f}
                  style={[styles.toggleBtn, frequency === f && styles.toggleBtnActive]}
                  onPress={() => setFrequency(f)}
                >
                  <Text style={[styles.toggleText, frequency === f && styles.toggleTextActive]}>
                    {f === 'daily' ? 'Daily' : 'Weekly'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Due date (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textSecondary}
              value={dueDate}
              onChangeText={setDueDate}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Any details..."
              placeholderTextColor={Colors.textSecondary}
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || !name.trim()}
              style={[styles.saveWrapper, (!name.trim() || saving) && styles.saveWrapperDisabled]}
            >
              <LinearGradient {...PrimaryGradient} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{saving ? 'Adding...' : 'Add chore ✶'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        </BottomSheetView>
      </BottomSheet>
    )
  }
)

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  cancel: { fontSize: 14, color: Colors.textSecondary },
  nameInput: { fontSize: 18, fontWeight: '600', color: Colors.textPrimary, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.mutedSurface, marginBottom: 20 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 },
  pillRow: { flexDirection: 'row', gap: 8, paddingBottom: 20 },
  pill: { backgroundColor: Colors.mutedSurface, borderRadius: Radii.pill, paddingHorizontal: 14, paddingVertical: 6 },
  pillActive: { backgroundColor: Colors.gradientStart },
  pillText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  pillTextActive: { color: '#fff' },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: Radii.pill, backgroundColor: Colors.mutedSurface, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: Colors.textPrimary },
  toggleText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  toggleTextActive: { color: '#fff' },
  input: { backgroundColor: Colors.cardBackground, borderRadius: Radii.card, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: Colors.mutedSurface, marginBottom: 20, color: Colors.textPrimary },
  notesInput: { height: 72, textAlignVertical: 'top' },
  saveWrapper: { marginTop: 8, marginBottom: 32 },
  saveWrapperDisabled: { opacity: 0.5 },
  saveBtn: { borderRadius: Radii.pill, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
})
