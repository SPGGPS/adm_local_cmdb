import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider as OidcAuthProvider } from 'react-oidc-context'
import { WebStorageStateStore } from 'oidc-client-ts'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/ui/index.jsx'
import Layout           from './components/layout/Layout'
import DashboardPage    from './pages/DashboardPage'
import InventoryPage    from './pages/InventoryPage'
import AssetDetailPage  from './pages/AssetDetailPage'
import TagsPage         from './pages/TagsPage'
import AuditPage        from './pages/AuditPage'
import DataSourcesPage  from './pages/DataSourcesPage'
import ExceptionsPage   from './pages/ExceptionsPage'
import ProfilePage      from './pages/ProfilePage'
import ApplicationsPage from './pages/ApplicationsPage'
import CertificatesPage from './pages/CertificatesPage'
import LocationsPage    from './pages/LocationsPage'
import EolPage          from './pages/EolPage'
import ServersPage      from './pages/ServersPage'
import NetworkPage      from './pages/NetworkPage'
import DatabasesPage    from './pages/DatabasesPage'
import WebServersPage   from './pages/WebServersPage'
import KubernetesPage   from './pages/KubernetesPage'
import CallbackPage     from './pages/CallbackPage'
import LoginPage        from './pages/LoginPage'
import './index.css'

const SKIP_AUTH = import.meta.env.VITE_SKIP_AUTH === 'true'
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

function ProtectedRoute({ children, roles }) {
  const { user, loading, hasRole } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-600">Cargando…</div>
  if (!user?.isAuthenticated) return <Navigate to="/login" replace/>
  if (roles && !roles.some(r => hasRole(r))) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <p className="text-red-400 text-lg">403 — Sin permisos</p>
        <p className="text-gray-500 text-sm mt-1">No tienes acceso a esta sección.</p>
      </div>
    </div>
  )
  return children
}

// El provider OIDC debe estar dentro de BrowserRouter para que onSigninCallback pueda usar useNavigate.
function OidcWrapper({ oidcConfig, children }) {
  const navigate = useNavigate()
  if (!oidcConfig) return children
  return (
    <OidcAuthProvider
      authority={oidcConfig.authority}
      client_id={oidcConfig.client_id}
      redirect_uri={oidcConfig.redirect_uri}
      post_logout_redirect_uri={oidcConfig.post_logout_redirect_uri}
      scope={oidcConfig.scope}
      automaticSilentRenew={true}
      userStore={new WebStorageStateStore({ store: sessionStorage })}
      onSigninCallback={() => navigate('/', { replace: true })}
    >
      {children}
    </OidcAuthProvider>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"    element={<LoginPage/>}/>
      <Route path="/callback" element={<CallbackPage/>}/>
      <Route path="/" element={<ProtectedRoute><Layout/></ProtectedRoute>}>
        <Route index                element={<DashboardPage/>}/>
        <Route path="dashboard"     element={<DashboardPage/>}/>
        <Route path="inventario"    element={<InventoryPage/>}/>
        <Route path="inventory"     element={<InventoryPage/>}/>
        <Route path="certificates"  element={<CertificatesPage/>}/>
        <Route path="locations"     element={<ProtectedRoute roles={['admin']}><LocationsPage/></ProtectedRoute>}/>
        <Route path="assets/:id"    element={<AssetDetailPage/>}/>
        <Route path="applications/*" element={<ApplicationsPage/>}/>
        <Route path="tags"          element={<ProtectedRoute roles={['admin']}><TagsPage/></ProtectedRoute>}/>
        <Route path="data-sources"  element={<ProtectedRoute roles={['admin']}><DataSourcesPage/></ProtectedRoute>}/>
        <Route path="exceptions"    element={<ProtectedRoute roles={['admin']}><ExceptionsPage/></ProtectedRoute>}/>
        <Route path="eol"           element={<EolPage/>}/>
        <Route path="cmdb/servers"      element={<ServersPage/>}/>
        <Route path="cmdb/network"      element={<NetworkPage/>}/>
        <Route path="cmdb/databases"    element={<DatabasesPage/>}/>
        <Route path="cmdb/web-servers"  element={<WebServersPage/>}/>
        <Route path="cmdb/kubernetes"   element={<KubernetesPage/>}/>
        <Route path="audit"   element={<ProtectedRoute roles={['admin']}><AuditPage/></ProtectedRoute>}/>
        <Route path="profile" element={<ProfilePage/>}/>
      </Route>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
  )
}

function RootApp({ oidcConfig }) {
  return (
    <StrictMode>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <OidcWrapper oidcConfig={oidcConfig}>
            <AuthProvider>
              <ToastProvider>
                <AppRoutes/>
              </ToastProvider>
            </AuthProvider>
          </OidcWrapper>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  )
}

async function bootstrap() {
  if (SKIP_AUTH) {
    createRoot(document.getElementById('root')).render(<RootApp oidcConfig={null}/>)
    return
  }
  try {
    const res = await fetch('/v1/auth/oidc/config')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const oidcConfig = await res.json()
    createRoot(document.getElementById('root')).render(<RootApp oidcConfig={oidcConfig}/>)
  } catch (e) {
    console.error('Cannot load OIDC config:', e)
    document.getElementById('root').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#f87171">' +
      'Error al conectar con el servidor. Recargue la página.</div>'
  }
}

bootstrap()
