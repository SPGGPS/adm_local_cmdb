import { useState } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Avatar from '../ui/Avatar'
import { authApi, systemApi } from '../../services/api'
import { useQuery } from '@tanstack/react-query'

/* global __FRT_VERSION__ */

const NAV = [
  { to:'/dashboard',    label:'Dashboard',         icon:ShieldIcon,    roles:null },
  { to:'/inventario',   label:'Inventario',        icon:ServerIcon,    roles:null,
    children:[
      { to:'/certificates',     label:'Certificados',      icon:CertificateIcon },
      { to:'/cmdb/servers',     label:'Servidores',        icon:ServerIcon },
      { to:'/cmdb/network',     label:'Red',               icon:NetworkIcon },
      { to:'/cmdb/databases',   label:'Bases de Datos',    icon:DatabaseIcon },
      { to:'/cmdb/web-servers', label:'Servidores Web',    icon:GlobeIcon },
      { to:'/cmdb/kubernetes',  label:'Contenedores',      icon:ContainerIcon },
    ]
  },
  { to:'/applications', label:'Servicios',         icon:CubeIcon,      roles:null },
  { to:'/tags',         label:'Etiquetas',         icon:TagIcon,       roles:['admin'] },
  { to:'/locations',    label:'Localizaciones',    icon:DatabaseIcon,  roles:['admin'] },
  { to:'/eol',          label:'End of Life',       icon:ShieldIcon,    roles:['viewer','editor','admin'] },
  { to:'/data-sources', label:'Fuentes de Datos',  icon:DatabaseIcon,  roles:['admin'] },
  { to:'/exceptions',   label:'Excepciones',       icon:ShieldExcIcon, roles:['admin'] },
  { to:'/audit',        label:'Auditoría',         icon:ShieldIcon,    roles:['admin'] },
]

const ROLE_LABELS = { admin:'Administrador', editor:'Editor', viewer:'Visor' }
const ROLE_COLORS = {
  admin:  { bg:'rgba(251,191,36,0.2)',  text:'#fbbf24' },
  editor: { bg:'rgba(52,211,153,0.2)',  text:'#34d399' },
  viewer: { bg:'rgba(255,255,255,0.15)', text:'rgba(255,255,255,0.6)' },
}

export default function Layout() {
  const { pathname } = useLocation()
  const { user, hasRole, logout } = useAuth()
  const sub      = user?.profile?.sub ?? user?.sub
  const username = user?.profile?.preferred_username ?? user?.preferred_username ?? 'devuser'
  const role     = user?.roles?.[0] ?? 'viewer'

  const { data: avatarSrc } = useQuery({
    queryKey: ['avatar', sub],
    queryFn: () => authApi.avatarUrl(),
    enabled: !!(user?.profile?.avatar_url ?? user?.avatar_url),
  })

  const { data: bckVersion } = useQuery({
    queryKey: ['bck-version'],
    queryFn: () => systemApi.version(),
    staleTime: Infinity,
  })

  const visibleNav = NAV.filter(n => !n.roles || n.roles.some(r => hasRole(r)))

  const [openMenus, setOpenMenus] = useState(() => {
    const init = {}
    NAV.forEach(n => {
      if (n.children?.some(c => pathname === c.to || pathname.startsWith(c.to))) {
        init[n.to] = true
      }
    })
    return init
  })

  const toggleMenu = (to) => setOpenMenus(prev => ({ ...prev, [to]: !prev[to] }))
  const rc = ROLE_COLORS[role] ?? ROLE_COLORS.viewer

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col" style={{ backgroundColor: '#76001d' }}>

        {/* Cabecera corporativa */}
        <div className="px-3 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
          {/* Logo en pastilla blanca sobre el rojo */}
          <div style={{ background: 'rgba(255,255,255,0.96)', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              src="/logo.svg"
              alt="Administración Pública Local Administración Pública Local"
              style={{ height: 38, objectFit: 'contain', display: 'block' }}
              onError={e => { e.target.style.display = 'none' }}
            />
          </div>
          <p className="mt-2 font-semibold text-center" style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontFamily: '"Public Sans", sans-serif' }}>
            Inventario Centralizado
          </p>
        </div>

        {/* Navegación */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {visibleNav.map(({ to, label, icon: Icon, children }) => {
            const childActive = children?.some(c => pathname === c.to || pathname.startsWith(c.to))
            const active = pathname === to || (to !== '/' && pathname.startsWith(to)) || childActive
            const isOpen = !!(openMenus[to] || childActive)
            return (
              <div key={to}>
                <Link
                  to={to}
                  className={`sidebar-item ${active && !childActive ? 'sidebar-active' : ''}`}
                  onClick={children ? () => { toggleMenu(to) } : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                  {children && (
                    <span className="ml-auto" style={{ fontSize: 10, opacity: 0.55 }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                  )}
                </Link>
                {children && isOpen && (
                  <div className="ml-4 mt-0.5 space-y-0.5">
                    {children.map(({ to: cto, label: cl, icon: CIcon }) => {
                      const cActive = pathname === cto || pathname.startsWith(cto)
                      return (
                        <Link
                          key={cto}
                          to={cto}
                          className={`sidebar-item py-1 ${cActive ? 'sidebar-active' : 'opacity-80'}`}
                          style={{ fontSize: 11 }}
                        >
                          <CIcon className="w-3.5 h-3.5 shrink-0" />
                          {cl}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Pie del sidebar — versiones */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}>
          <p className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
            frt v{__FRT_VERSION__} · bck v{bckVersion?.version ?? '…'}
          </p>
        </div>
      </aside>

      {/* Área principal */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header blanco, estilo portal */}
        <header
          className="shrink-0 flex items-center justify-between gap-4"
          style={{
            height: 52,
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e4e2e2',
            boxShadow: '0 1px 4px rgba(0,0,0,.04)',
          }}
        >
          {/* Izquierda: sección activa */}
          <div className="flex items-center h-full">
            <div className="flex items-center gap-2 px-4">
              <div className="w-1 h-4 rounded-full" style={{ backgroundColor: '#76001d' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1b1c1c', fontFamily: '"Public Sans", sans-serif' }}>
                {visibleNav.flatMap(n => n.children ? [n, ...n.children] : [n])
                  .find(n => pathname === n.to || (n.to !== '/' && pathname.startsWith(n.to)))
                  ?.label ?? 'Dashboard'}
              </span>
            </div>
          </div>

          {/* Derecha: usuario + logout */}
          <div className="flex items-center gap-3">
            <Link to="/profile" className="flex items-center gap-2.5 group rounded-lg px-2 py-1 transition-colors"
              style={{ ':hover': { background: '#f5f3f2' } }}>
              <Avatar username={username} src={avatarSrc || undefined} size="sm" />
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold leading-tight transition-colors group-hover:text-primary-hover"
                   style={{ color: '#1b1c1c' }}>
                  {username}
                </p>
                <span
                  className="inline-block px-1.5 py-px rounded text-center leading-none"
                  style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', background: rc.bg, color: rc.text }}
                >
                  {ROLE_LABELS[role] ?? role}
                </span>
              </div>
            </Link>

            <div className="w-px h-5" style={{ backgroundColor: '#e4e2e2' }} />

            <button
              onClick={logout}
              title="Cerrar sesión"
              className="rounded-lg p-1.5 transition-colors"
              style={{ color: '#6b6e70' }}
              onMouseEnter={e => e.currentTarget.style.color = '#76001d'}
              onMouseLeave={e => e.currentTarget.style.color = '#6b6e70'}
            >
              <LogoutIcon className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/* SVG Icon helpers */
function ServerIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 6a2 2 0 012-2h10a2 2 0 012 2v2a2 2 0 01-2 2H7a2 2 0 01-2-2V6zM5 14a2 2 0 012-2h10a2 2 0 012 2v2a2 2 0 01-2 2H7a2 2 0 01-2-2v-2z"/>
  </svg>
}
function TagIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"/>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z"/>
  </svg>
}
function DatabaseIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 6c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"/>
  </svg>
}
function ShieldIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
  </svg>
}
function ShieldExcIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.75h-.152c-3.196 0-6.1-1.248-8.25-3.286zm0 13.036h.008v.008H12v-.008z"/>
  </svg>
}
function LogoutIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/>
  </svg>
}
function CubeIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/>
  </svg>
}
function CertificateIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
  </svg>
}
function NetworkIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
  </svg>
}
function GlobeIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253"/>
  </svg>
}
function ContainerIcon(p) {
  return <svg {...p} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/>
  </svg>
}
