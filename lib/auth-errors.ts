/** Maps Firebase Auth error codes to human-readable messages (login + signup). */
export function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  // A plain Error with no Firebase .code (e.g. the invite-code checks in AuthProvider) already
  // carries a human-readable message — surface it directly instead of falling through to the
  // generic "unknown error" case below.
  if (!code && err instanceof Error && err.message) return err.message
  switch (code) {
    // Sign-in
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Invalid email or password.'
    case 'auth/user-not-found':
      return 'No account found with that email.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.'
    // Sign-up
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.'
    // Google popup / config
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in popup was closed.'
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups for this site.'
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized. Add localhost to Firebase → Authentication → Settings → Authorized domains.'
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled. Enable it in Firebase → Authentication → Sign-in method.'
    case 'auth/network-request-failed':
      return 'Network error. Check your internet connection.'
    default:
      return `Sign-in failed (${code || 'unknown error'}). Check the browser console for details.`
  }
}
