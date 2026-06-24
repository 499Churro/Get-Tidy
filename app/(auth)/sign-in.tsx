import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { supabase } from '@/lib/supabase'
import { Colors, PrimaryGradient, Radii } from '@/constants/theme'

export default function SignInScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleApple() {
    try {
      // Dynamic import to avoid crash on Android/web (expo-apple-authentication not installed)
      const AppleAuthentication = await import('expo-apple-authentication')
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken!,
      })
      if (error) Alert.alert('Error', error.message)
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') Alert.alert('Error', e.message)
    }
  }

  async function handleGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'tidy://auth/callback' },
    })
    if (error) Alert.alert('Error', error.message)
  }

  async function handleEmail() {
    setLoading(true)
    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) Alert.alert('Error', error.message)
  }

  return (
    <View style={styles.container}>
      <LinearGradient {...PrimaryGradient} style={styles.logoBox}>
        <Text style={styles.star}>✦</Text>
      </LinearGradient>
      <Text style={styles.wordmark}>tidy</Text>
      <Text style={styles.tagline}>Chores, handled.</Text>

      {Platform.OS === 'ios' && (
        <TouchableOpacity style={styles.appleBtn} onPress={handleApple}>
          <Text style={styles.appleBtnText}>Continue with Apple</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.googleBtn} onPress={handleGoogle}>
        <Text style={styles.googleText}>Continue with Google</Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.emailBtn} onPress={handleEmail} disabled={loading}>
        <Text style={styles.emailBtnText}>{isSignUp ? 'Create account' : 'Sign in'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)}>
        <Text style={styles.toggle}>{isSignUp ? 'Already have an account?' : "Don't have an account?"}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logoBox: { width: 56, height: 56, borderRadius: Radii.logo, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  star: { fontSize: 28, color: '#fff' },
  wordmark: { fontSize: 32, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -1, marginBottom: 4 },
  tagline: { fontSize: 14, color: Colors.textSecondary, marginBottom: 40 },
  appleBtn: { width: '100%', height: 48, backgroundColor: '#000', borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  appleBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  googleBtn: { width: '100%', height: 48, borderRadius: Radii.pill, borderWidth: 1.5, borderColor: Colors.mutedSurface, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  googleText: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  divider: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.mutedSurface },
  dividerText: { marginHorizontal: 12, color: Colors.textSecondary, fontSize: 13 },
  input: { width: '100%', height: 48, backgroundColor: Colors.cardBackground, borderRadius: Radii.card, paddingHorizontal: 16, marginBottom: 10, fontSize: 15, borderWidth: 1, borderColor: Colors.mutedSurface },
  emailBtn: { width: '100%', height: 48, backgroundColor: Colors.textPrimary, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emailBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  toggle: { color: Colors.textSecondary, fontSize: 13 },
})
