# Gamification Phase 2b — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase 2a gamification data layer into the Home and House tab UIs — streak label, today's points, +10/+15 floating pill on completion, and the monthly momentum section.

**Architecture:** Two independent changesets (home tab + house tab) that can be implemented in parallel. No new components — all UI lives inline in the screen files.

**Tech Stack:** React Native Animated, Expo Router, Supabase client hooks (`useTodayPoints`, `useStreak`, `useHouseMomentum`, `useMonthlyGoal`), existing `Colors`/`Fonts`/`Shadows` from `constants/theme.ts`.

**Spec:** `docs/superpowers/specs/2026-06-30-gamification-v2-encouraging.md`

---

## Checkpoint A — Home Tab: Personal Rhythm

**File:** `app/(app)/index.tsx`

### Task A.1 — Rhythm strip: streak + today's points

Add a horizontal strip below the WeekStrip showing:
- `"{N} days steady"` chip — hidden when `currentStreak === 0`
- `"+{N} today"` chip — hidden when `todayPoints === 0`
- Entire strip hidden when both are zero/null

```tsx
// Imports to add
import { Animated } from 'react-native'
import { useRef } from 'react'
import { useTodayPoints } from '@/hooks/useTodayPoints'
import { useStreak } from '@/hooks/useStreak'

// In component body, after existing hooks:
const { todayPoints } = useTodayPoints(session?.user.id)
const { currentStreak } = useStreak(session?.user.id)

// JSX — insert between WeekStrip and AvatarRow fullBleed blocks:
{(currentStreak > 0 || todayPoints > 0) && (
  <View style={styles.rhythmStrip}>
    {currentStreak > 0 && (
      <View style={styles.rhythmChip}>
        <Text style={styles.rhythmChipText}>{currentStreak} days steady</Text>
      </View>
    )}
    {todayPoints > 0 && (
      <View style={[styles.rhythmChip, styles.rhythmChipPoints]}>
        <Text style={[styles.rhythmChipText, styles.rhythmChipTextPoints]}>+{todayPoints} today</Text>
      </View>
    )}
  </View>
)}

// Styles to add:
rhythmStrip: {
  flexDirection: 'row',
  gap: 8,
  paddingHorizontal: 20,
},
rhythmChip: {
  backgroundColor: Colors.surfaceContainer,
  borderRadius: Radii.pill,
  paddingHorizontal: 14,
  paddingVertical: 6,
  borderWidth: 1,
  borderColor: Colors.outlineVariant,
},
rhythmChipPoints: {
  backgroundColor: Colors.primaryFixed,
  borderColor: Colors.primaryContainer,
},
rhythmChipText: {
  fontSize: 13,
  fontFamily: Fonts.semibold,
  color: Colors.onSurfaceVariant,
},
rhythmChipTextPoints: {
  color: Colors.primary,
},
```

### Task A.2 — Floating +10/+15 pill on chore completion

When `handleToggle` marks a chore done, show a pill that floats up and fades out over 1.2s.

```tsx
// Refs for animation — add after existing state:
const pillOpacity = useRef(new Animated.Value(0)).current
const pillY = useRef(new Animated.Value(0)).current
const [pillText, setPillText] = useState<string | null>(null)

// Helper function inside component:
function showPointPill(text: string) {
  setPillText(text)
  pillOpacity.setValue(1)
  pillY.setValue(0)
  Animated.parallel([
    Animated.timing(pillOpacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
    Animated.timing(pillY, { toValue: -60, duration: 1200, useNativeDriver: true }),
  ]).start(() => setPillText(null))
}

// Update handleToggle to trigger pill on markDone:
async function handleToggle(chore: ChoreWithCompletion) {
  if (!session?.user.id) return
  if (chore.completion !== null) {
    await undoMarkDone(chore.id)
  } else {
    const isOverdue = !!chore.due_date && chore.due_date < today
    showPointPill(isOverdue ? '+15' : '+10')
    await markDone(chore.id, session.user.id)
  }
}

// Pill JSX — place as last child of SafeAreaView, after ScrollView:
{pillText && (
  <Animated.View
    pointerEvents="none"
    style={[
      styles.pointPill,
      { opacity: pillOpacity, transform: [{ translateY: pillY }] },
    ]}
  >
    <Text style={styles.pointPillText}>{pillText}</Text>
  </Animated.View>
)}

// Styles:
pointPill: {
  position: 'absolute',
  bottom: 180,
  alignSelf: 'center',
  backgroundColor: Colors.primary,
  borderRadius: Radii.pill,
  paddingHorizontal: 20,
  paddingVertical: 10,
  ...Shadows.card,
},
pointPillText: {
  fontSize: 22,
  fontFamily: Fonts.bold,
  color: '#fff',
},
```

**Commit:** `feat(gamification): home tab — rhythm strip + floating point pill`

---

## Checkpoint B — House Tab: Monthly Momentum Section

**File:** `app/(app)/house.tsx`

### Task B.1 — Wire hooks

```tsx
// Add imports
import { useHouseMomentum } from '@/hooks/useHouseMomentum'
import { useMonthlyGoal } from '@/hooks/useMonthlyGoal'

// Add state for goal input drafting
const [goalDraft, setGoalDraft] = useState('')
const [goalEditing, setGoalEditing] = useState(false)

// Add hooks in component body after existing hooks
const { momentum, loading: momentumLoading } = useHouseMomentum(house?.id)
const { goal, setGoal: saveGoal } = useMonthlyGoal(house?.id)
```

### Task B.2 — Inline recap copy helper

```tsx
function getRecapCopy(m: { momentum_pct: number; target_pct: number; reward_text: string | null }): string {
  if (m.momentum_pct >= m.target_pct) {
    return m.reward_text ? `${m.reward_text} is still on track. Keep it up.` : 'On track. Keep it up.'
  }
  if (m.momentum_pct >= 70) {
    return `Your house completed ${m.momentum_pct}% of chores on time this month.`
  }
  return m.reward_text
    ? `${m.reward_text} is still in reach — a strong finish gets you there.`
    : 'A strong finish can still turn things around.'
}
```

### Task B.3 — "This Month" section JSX

Insert a new `<View style={styles.section}>` **before** the "Roommates" section:

```tsx
{/* Monthly Momentum */}
<View style={styles.section}>
  <Text style={styles.sectionTitle}>This Month</Text>
  {!goal ? (
    // Empty state
    <View style={styles.card}>
      <Text style={styles.goalEmptyTitle}>Set a house goal</Text>
      <Text style={styles.goalEmptyBody}>
        Add a shared reward to track your month together — like "Movie night" or "Dinner out."
      </Text>
      <TextInput
        style={[styles.modalInput, { marginTop: 14 }]}
        value={goalDraft}
        onChangeText={setGoalDraft}
        placeholder="e.g. Movie night"
        placeholderTextColor={Colors.onSurfaceVariant}
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={() => {
          if (goalDraft.trim()) { saveGoal(goalDraft.trim(), 90); setGoalDraft('') }
        }}
      />
      <TouchableOpacity
        style={[styles.shareBtn, { marginTop: 12, opacity: goalDraft.trim() ? 1 : 0.4 }]}
        disabled={!goalDraft.trim()}
        onPress={() => { saveGoal(goalDraft.trim(), 90); setGoalDraft('') }}
        activeOpacity={0.8}
      >
        <Text style={styles.shareBtnText}>Set goal</Text>
      </TouchableOpacity>
    </View>
  ) : (
    // Goal set — show meter
    <View style={styles.card}>
      {momentumLoading ? (
        <ActivityIndicator color={Colors.primary} />
      ) : momentum ? (
        <>
          {/* Meter */}
          <View style={styles.meterTrack}>
            <View style={[styles.meterFill, { width: `${Math.min(100, momentum.momentum_pct)}%` }]} />
          </View>
          {/* Label */}
          {goalEditing ? (
            <TextInput
              style={[styles.modalInput, { marginTop: 12 }]}
              value={goalDraft}
              onChangeText={setGoalDraft}
              placeholder="Reward text"
              placeholderTextColor={Colors.onSurfaceVariant}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                if (goalDraft.trim()) { saveGoal(goalDraft.trim(), goal.target_pct); }
                setGoalEditing(false); setGoalDraft('')
              }}
              onBlur={() => { setGoalEditing(false); setGoalDraft('') }}
            />
          ) : (
            <TouchableOpacity onPress={() => { setGoalDraft(goal.reward_text); setGoalEditing(true) }}>
              <Text style={styles.meterLabel}>
                {momentum.momentum_pct}% toward {goal.reward_text}
              </Text>
            </TouchableOpacity>
          )}
          {/* Recap copy */}
          <Text style={styles.recapCopy}>{getRecapCopy(momentum)}</Text>
        </>
      ) : null}
    </View>
  )}
</View>
```

### Task B.4 — Styles

```ts
goalEmptyTitle: { fontSize: 17, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 4 },
goalEmptyBody: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, lineHeight: 18 },
meterTrack: {
  height: 8,
  backgroundColor: Colors.surfaceContainerHigh,
  borderRadius: Radii.pill,
  overflow: 'hidden',
  marginBottom: 12,
},
meterFill: {
  height: 8,
  backgroundColor: Colors.primary,
  borderRadius: Radii.pill,
},
meterLabel: { fontSize: 16, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 8 },
recapCopy: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, lineHeight: 18, marginTop: 4 },
```

**Commit:** `feat(gamification): house tab — monthly momentum meter + goal setting`

---

## Done Criteria

- [ ] Home tab shows "N days steady" chip when streak > 0
- [ ] Home tab shows "+N today" chip when points > 0  
- [ ] Marking a chore done shows floating +10 or +15 pill that fades out
- [ ] House tab shows "Set a house goal" prompt with input when no goal exists
- [ ] Setting a goal saves it and immediately shows the meter
- [ ] Meter shows correct percentage toward goal reward text
- [ ] Inline recap copy changes based on momentum percentage
- [ ] Tapping reward text enters edit mode
- [ ] `npx tsc --noEmit` passes
