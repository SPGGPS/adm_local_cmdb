import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth as useOidcAuth } from 'react-oidc-context'
import { authApi } from '../services/api'
import { session } from '../auth/session'

const AuthContext = createContext(null)
const SKIP_AUTH = import.meta.env.VITE_SKIP_AUTH === 'true'
const CLIENT_ID = 'inventory'

// Extrae los roles del objeto de usuario OIDC.
// Primero intenta las claims del ID-token, si no parsea el access token.
function extractRoles(oidcUser) {
  if (!oidcUser) return []
  const fromProfile = oidcUser.profile?.resource_access?.[CLIENT_ID]?.roles ?? []
  const realmFromProfile = oidcUser.profile?.realm_access?.roles ?? []
  if (fromProfile.length || realmFromProfile.length) {
    return [...new Set([...fromProfile, ...realmFromProfile])]
  }
  try {
    const payload = JSON.parse(
      atob(oidcUser.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    )
    return [...new Set([
      ...(payload?.resource_access?.[CLIENT_ID]?.roles ?? []),
      ...(payload?.realm_access?.roles ?? []),
    ])]
  } catch {
    return []
  }
}

// Inner component: safe to call useOidcAuth() because OidcAuthProvider is always a parent.
function OidcBridge({ children }) {
  const oidc = useOidcAuth()
  const [extraProfile, setExtraProfile] = useState(null)

  // Set synchronously during render so children's first API calls have the token.
  // Parent renders before children, so this runs before DashboardPage's useQuery fires.
  session.setToken(oidc.user?.access_token ?? null)

  // El efecto captura las renovaciones silenciosas del token.
  useEffect(() => {
    session.setToken(oidc.user?.access_token ?? null)
  }, [oidc.user])

  // Cargar datos adicionales del perfil desde el backend
  useEffect(() => {
    if (oidc.isAuthenticated) {
      authApi.me().then(setExtraProfile).catch(() => {})
    } else {
      setExtraProfile(null)
    }
  }, [oidc.isAuthenticated])

  const roles = extractRoles(oidc.user)
  const hasRole = (...r) => r.some(role => roles.includes(role))

  const user = oidc.isAuthenticated ? {
    profile: {
      sub:                  oidc.user?.profile?.sub,
      preferred_username:   oidc.user?.profile?.preferred_username,
      email:                oidc.user?.profile?.email,
      avatar_url:           extraProfile?.avatar_url ?? null,
      last_login_at:        extraProfile?.last_login_at ?? null,
      last_login_ip:        extraProfile?.last_login_ip ?? null,
      last_failed_login_at: extraProfile?.last_failed_login_at ?? null,
      last_failed_login_ip: extraProfile?.last_failed_login_ip ?? null,
    },
    roles,
    isAuthenticated: true,
  } : null

  const value = {
    user,
    loading: oidc.isLoading,
    hasRole,
    isAdmin:   () => hasRole('admin'),
    isEditor:  () => hasRole('admin', 'editor'),
    login:     () => oidc.signinRedirect(),
    logout:    () => oidc.signoutRedirect(),
    refreshMe: () => authApi.me().then(setExtraProfile).catch(() => {}),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

const DEV_CONTEXT = {
  user: {
    profile: {
      sub: 'dev', preferred_username: 'devuser', email: 'dev@tfg.local',
      avatar_url: null,
      last_login_at: new Date(Date.now() - 3600000).toISOString(), last_login_ip: '127.0.0.1',
      last_failed_login_at: new Date(Date.now() - 86400000).toISOString(), last_failed_login_ip: '10.0.0.1',
    },
    roles: ['admin'], isAuthenticated: true,
  },
  loading: false,
  hasRole: () => true,
  isAdmin: () => true,
  isEditor: () => true,
  login: () => {},
  logout: () => {},
  refreshMe: () => Promise.resolve(),
}

export function AuthProvider({ children }) {
  if (SKIP_AUTH) {
    return <AuthContext.Provider value={DEV_CONTEXT}>{children}</AuthContext.Provider>
  }
  return <OidcBridge>{children}</OidcBridge>
}

export const useAuth = () => useContext(AuthContext)
