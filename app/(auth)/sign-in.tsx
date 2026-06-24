import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Dimensions,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts, Radii } from '@/constants/theme'

const { height } = Dimensions.get('window')

export default function SignInScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showEmail, setShowEmail] = useState(false)

  async function handleApple() {
    try {
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
    <View style={styles.root}>
      {/* Gradient hero — top 45% of screen */}
      <LinearGradient
        colors={['#ff7c5c', '#ffb347']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        {/* Decorative circles */}
        <View style={styles.circle1} />
        <View style={styles.circle2} />

        <SafeAreaView edges={['top']} style={styles.heroContent}>
          {/* Logo mark */}
          <View style={styles.logoBox}>
            <Text style={styles.star}>✦</Text>
          </View>
          <Text style={styles.wordmark}>tidy</Text>
          <Text style={styles.tagline}>Chores, handled.</Text>
        </SafeAreaView>
      </LinearGradient>

      {/* Auth card — bottom sheet style */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.cardWrapper}
      >
        <View style={styles.card}>
          <View style={styles.handle} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.cardContent}
          >
            <Text style={styles.cardTitle}>
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </Text>
            <Text style={styles.cardSub}>
              {isSignUp ? 'Join your roommates on Tidy.' : 'Sign in to your house.'}
            </Text>

            {/* Apple */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity style={styles.appleBtn} onPress={handleApple} activeOpacity={0.85}>
                <Text style={styles.appleBtnIcon}></Text>
                <Text style={styles.appleBtnText}>Continue with Apple</Text>
              </TouchableOpacity>
            )}

            {/* Google */}
            <TouchableOpacity style={styles.googleBtn} onPress={handleGoogle} activeOpacity={0.85}>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleText}>Continue with Google</Text>
            </TouchableOpacity>

            {/* Email toggle */}
            {!showEmail ? (
              <TouchableOpacity onPress={() => setShowEmail(true)} style={styles.emailToggle}>
                <Text style={styles.emailToggleText}>Sign in with email</Text>
              </TouchableOpacity>
            ) : (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or email</Text>
                  <View style={styles.dividerLine} />
                </View>

                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor={Colors.textSecondary}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={Colors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                <TouchableOpacity
                  style={[styles.emailBtn, loading && styles.emailBtnDisabled]}
                  onPress={handleEmail}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={['#ff7c5c', '#ffb347']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.emailBtnGradient}
                  >
                    <Text style={styles.emailBtnText}>
                      {loading ? '…' : isSignUp ? 'Create account' : 'Sign in'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}

            {/* Toggle sign up / sign in */}
            <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)} style={styles.toggleRow}>
              <Text style={styles.toggleText}>
                {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
                <Text style={styles.toggleLink}>{isSignUp ? 'Sign in' : 'Sign up'}</Text>
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },

  // Hero
  hero: { height: height * 0.42, justifyContent: 'flex-end', overflow: 'hidden' },
  circle1: {
    position: 'absolute', width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(255,255,255,0.1)', top: -80, right: -60,
  },
  circle2: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.08)', bottom: 20, left: -40,
  },
  heroContent: { paddingHorizontal: 28, paddingBottom: 36 },
  logoBox: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  star: { fontSize: 26, color: '#fff' },
  wordmark: { fontSize: 36, fontFamily: Fonts.extrabold, color: '#fff', letterSpacing: -1, marginBottom: 4 },
  tagline: { fontSize: 15, fontFamily: Fonts.medium, color: 'rgba(255,255,255,0.8)' },

  // Card
  cardWrapper: { flex: 1, marginTop: -24 },
  card: {
    flex: 1, backgroundColor: '#fff',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.mutedSurface,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  cardContent: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40 },
  cardTitle: { fontSize: 22, fontFamily: Fonts.extrabold, color: Colors.textPrimary, marginBottom: 4 },
  cardSub: { fontSize: 14, fontFamily: Fonts.regular, color: Colors.textSecondary, marginBottom: 28 },

  // Apple
  appleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, backgroundColor: '#000', borderRadius: Radii.pill,
    marginBottom: 12, gap: 8,
  },
  appleBtnIcon: { fontSize: 18, color: '#fff' },
  appleBtnText: { fontSize: 15, fontFamily: Fonts.semibold, color: '#fff' },

  // Google
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: Radii.pill,
    borderWidth: 1.5, borderColor: Colors.mutedSurface,
    marginBottom: 16, gap: 8,
  },
  googleIcon: { fontSize: 16, fontFamily: Fonts.bold, color: '#4285F4' },
  googleText: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.textPrimary },

  // Email toggle
  emailToggle: { alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
  emailToggleText: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.textSecondary },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.mutedSurface },
  dividerText: { marginHorizontal: 12, color: Colors.textSecondary, fontSize: 12, fontFamily: Fonts.semibold },

  // Inputs
  input: {
    height: 50, backgroundColor: Colors.background,
    borderRadius: Radii.card, paddingHorizontal: 16,
    marginBottom: 10, fontSize: 15,
    borderWidth: 1, borderColor: Colors.mutedSurface,
    color: Colors.textPrimary,
    fontFamily: Fonts.regular,
  },

  // Email CTA
  emailBtn: { borderRadius: Radii.pill, overflow: 'hidden', marginTop: 4, marginBottom: 4 },
  emailBtnDisabled: { opacity: 0.6 },
  emailBtnGradient: { height: 52, alignItems: 'center', justifyContent: 'center' },
  emailBtnText: { color: '#fff', fontSize: 15, fontFamily: Fonts.extrabold },

  // Toggle
  toggleRow: { alignItems: 'center', marginTop: 20 },
  toggleText: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.textSecondary },
  toggleLink: { color: Colors.gradientStart, fontFamily: Fonts.bold },
})
