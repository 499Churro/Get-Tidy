import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { getCalendars } from 'expo-localization'
import { supabase } from '@/lib/supabase'
import { AvatarGradients, Colors, Radii } from '@/constants/theme'
import { LinearGradient } from 'expo-linear-gradient'

export default function OnboardingScreen() {
  const [displayName, setDisplayName] = useState('')
  const [avatarUri, setAvatarUri] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (!result.canceled) setAvatarUri(result.assets[0].uri)
  }

  async function handleSave() {
    if (!displayName.trim()) {
      Alert.alert('Name required', 'Please enter a display name.')
      return
    }
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const colorIndex = user.id.charCodeAt(0) % AvatarGradients.length
    const timezone =
      (getCalendars()[0]?.timeZone) ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'UTC'

    let avatar_url: string | null = null
    if (avatarUri) {
      const ext = avatarUri.split('.').pop() ?? 'jpg'
      const path = `${user.id}/avatar.${ext}`
      const response = await fetch(avatarUri)
      const blob = await response.blob()
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true })
      if (!uploadError) {
        const { data } = supabase.storage.from('avatars').getPublicUrl(path)
        avatar_url = data.publicUrl
      }
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      display_name: displayName.trim(),
      avatar_url,
      avatar_color_index: colorIndex,
      timezone,
    })

    setLoading(false)
    if (error) Alert.alert('Error', error.message)
    // Root layout redirects to app once profile exists
  }

  const initials = displayName.trim().split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Set up your profile</Text>
      <TouchableOpacity onPress={pickPhoto} style={styles.avatarWrapper}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
        ) : (
          <LinearGradient colors={['#f0ebe7', '#e5dfd9']} style={styles.avatarPlaceholder}>
            <Text style={styles.avatarPlaceholderText}>{displayName ? initials : '📷'}</Text>
          </LinearGradient>
        )}
      </TouchableOpacity>
      <Text style={styles.photoHint}>Add photo <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="Your name"
        value={displayName}
        onChangeText={setDisplayName}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={handleSave}
      />
      <TouchableOpacity style={styles.btn} onPress={handleSave} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Saving...' : 'Continue'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, marginBottom: 32 },
  avatarWrapper: { marginBottom: 8 },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholderText: { fontSize: 24, color: Colors.textSecondary, fontWeight: '600' },
  photoHint: { fontSize: 12, color: Colors.textSecondary, marginBottom: 24 },
  optional: { color: Colors.mutedSurface },
  input: { width: '100%', height: 48, backgroundColor: Colors.cardBackground, borderRadius: Radii.card, paddingHorizontal: 16, fontSize: 16, borderWidth: 1, borderColor: Colors.mutedSurface, marginBottom: 16 },
  btn: { width: '100%', height: 48, backgroundColor: Colors.textPrimary, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
