import { useRef, useState, useMemo } from 'react'
import { View, ScrollView, StyleSheet, SafeAreaView } from 'react-native'
import BottomSheet from '@gorhom/bottom-sheet'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useChores } from '@/hooks/useChores'
import { TidyLogo } from '@/components/ui/TidyLogo'
import { PillBadge } from '@/components/ui/PillBadge'
import { WeekStrip } from '@/components/chores/WeekStrip'
import { AvatarRow } from '@/components/chores/AvatarRow'
import { HeroCard } from '@/components/chores/HeroCard'
import { ChoreList } from '@/components/chores/ChoreList'
import { AddChoreSheet } from '@/components/chores/AddChoreSheet'
import { Colors } from '@/constants/theme'
import { getChoresForDay, getProgressDotColor, getMondayOfWeek } from '@/lib/chores'
import { ChoreWithCompletion } from '@/types/database'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function ChoresScreen() {
  const { session, profile } = useAuth()
  const { house, members } = useHouse(session?.user.id)
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const sheetRef = useRef<BottomSheet>(null)

  const { chores, completions, getChoresForSelectedDay, markDone, addChore } = useChores(
    house?.id,
    selectedDate
  )

  // Compute progress dot colors for the whole week
  const dotColors = useMemo(() => {
    const monday = getMondayOfWeek(selectedDate)
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setUTCDate(d.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
    const result: Record<string, 'red' | 'orange' | 'yellow' | 'green' | null> = {}
    days.forEach(day => {
      const dayChores = getChoresForDay(chores, day).filter(c => c.assigned_to !== null)
      result[day] = getProgressDotColor(dayChores, completions, day)
    })
    return result
  }, [chores, completions, selectedDate])

  // Get filtered chore list for current view
  const filteredChores: ChoreWithCompletion[] = getChoresForSelectedDay(
    selectedUserId ?? undefined
  )
  const incompleteChores = filteredChores.filter(c => c.completion === null)
  const heroChore = incompleteChores[0] ?? null
  const allDone = filteredChores.length > 0 && incompleteChores.length === 0

  // Viewing profile for hero card
  const viewingProfile = selectedUserId
    ? members.find(m => m.user_id === selectedUserId)?.profile ?? null
    : null
  const isSelf = selectedUserId === null || selectedUserId === session?.user.id

  // Count helper for avatar row
  function getCountForMember(userId: string) {
    const memberChores = getChoresForSelectedDay(userId)
    return {
      done: memberChores.filter(c => c.completion !== null).length,
      total: memberChores.length,
    }
  }

  async function handleToggle(chore: ChoreWithCompletion) {
    if (!session?.user.id) return
    if (!chore.completion) {
      await markDone(chore.id, session.user.id)
    }
  }

  const emptyMsg = selectedUserId
    ? `${viewingProfile?.display_name?.split(' ')[0] ?? 'They'} has nothing today.`
    : 'Nothing on the list. Enjoy it while it lasts. ✦'

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TidyLogo />
          {house && <PillBadge label={house.name} />}
        </View>

        {/* Week Strip */}
        <WeekStrip
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          dotColors={dotColors}
        />

        {/* Avatar Row */}
        {members.length > 0 && (
          <View style={styles.avatarRowWrapper}>
            <AvatarRow
              members={members}
              selectedUserId={selectedUserId}
              currentUserId={session?.user.id ?? ''}
              getCountForMember={getCountForMember}
              onSelect={setSelectedUserId}
            />
          </View>
        )}

        {/* Hero Card */}
        <HeroCard
          chore={heroChore}
          allDone={allDone}
          viewingProfile={viewingProfile}
          isSelf={isSelf}
          onMarkDone={() => heroChore && handleToggle(heroChore)}
        />

        {/* Chore List */}
        <ChoreList
          chores={filteredChores}
          currentUserId={session?.user.id ?? ''}
          onToggle={handleToggle}
          onAdd={() => sheetRef.current?.expand()}
          emptyMessage={emptyMsg}
        />
      </ScrollView>

      {/* Add Chore Sheet */}
      {house && profile && (
        <AddChoreSheet
          ref={sheetRef}
          members={members}
          currentUserId={session?.user.id ?? ''}
          houseId={house.id}
          onAdd={addChore}
          onClose={() => sheetRef.current?.close()}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 120 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  avatarRowWrapper: { backgroundColor: Colors.cardBackground, borderRadius: 16, padding: 10 },
})
