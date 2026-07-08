import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/*
   LoginPage — Página de autenticación SSO
   Estilo alineado con el Portal Intranet de la organización:
   hero con gradiente corporativo + card flotante blanca
*/
export default function LoginPage() {
  const { login, user } = useAuth()

  if (user?.isAuthenticated) return <Navigate to="/" replace />

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f3f2' }}>

      {/* Hero corporativo */}
      <div style={{
        background: 'linear-gradient(135deg, #76001d 0%, #a1002b 100%)',
        padding: '32px 24px 64px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Patrón decorativo SVG (igual que el portal) */}
        <svg
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.05, pointerEvents: 'none' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0v40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Logo corporativo en pastilla blanca */}
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 20 }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 14,
            padding: '10px 20px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
          }}>
            <img
              src="/logo.svg"
              alt="Administración Pública Local Administración Pública Local"
              style={{ height: 64, objectFit: 'contain', display: 'block' }}
              onError={e => {
                e.target.style.display = 'none'
                e.target.parentElement.innerHTML =
                  '<span style="font-size:13px;font-weight:700;color:#76001d;font-family:Inter,sans-serif;white-space:nowrap">Administración Pública Local<br/>Administración Pública Local</span>'
              }}
            />
          </div>
        </div>

        <p style={{
          marginTop: 12,
          fontSize: 15,
          color: 'rgba(255,255,255,0.85)',
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '0.02em',
        }}>
          Sistema de Inventario Centralizado
        </p>
      </div>

      {/* Card flotante */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginTop: -40,
        flex: 1,
        padding: '0 24px 40px',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{
          background: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,.13)',
          padding: '40px 48px',
          width: '100%',
          maxWidth: 420,
          textAlign: 'center',
          border: '1.5px solid #e4e2e2',
        }}>

          {/* Sección tipo/subtítulo */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 14px',
            background: '#f5e8ea',
            color: '#76001d',
            borderRadius: 9999,
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 24,
          }}>
            <LockIcon style={{ width: 12, height: 12 }} />
            Acceso restringido
          </div>

          <p style={{
            fontSize: 15,
            color: '#1b1c1c',
            fontWeight: 600,
            marginBottom: 6,
            fontFamily: '"Public Sans", sans-serif',
          }}>
            Identifícate con tu cuenta corporativa
          </p>
          <p style={{
            fontSize: 13,
            color: '#6b6e70',
            marginBottom: 32,
            lineHeight: 1.5,
          }}>
            Usa tu usuario de la organización para acceder de forma segura mediante SSO.
          </p>

          {/* Botón SSO */}
          <button
            onClick={login}
            style={{
              width: '100%',
              padding: '14px 24px',
              background: 'linear-gradient(135deg, #76001d 0%, #a1002b 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              fontFamily: '"Public Sans", Inter, sans-serif',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              boxShadow: '0 4px 16px rgba(118,0,29,0.30)',
              transition: 'all .2s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = '0 6px 24px rgba(118,0,29,0.45)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(118,0,29,0.30)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <KeyIcon style={{ width: 18, height: 18 }} />
            Iniciar sesión con SSO
          </button>

          {/* Separador */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: '#e4e2e2' }} />
            <span style={{ fontSize: 11, color: '#6b6e70' }}>Single Sign-On</span>
            <div style={{ flex: 1, height: 1, background: '#e4e2e2' }} />
          </div>

          {/* Info adicional */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 16px',
            background: '#f5f3f2',
            borderRadius: 10,
            textAlign: 'left',
          }}>
            <ShieldIcon style={{ width: 16, height: 16, color: '#76001d', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: '#6b6e70', margin: 0, lineHeight: 1.5 }}>
              Acceso exclusivo para personal autorizado del Servicio de Sistemas y Administración Electrónica.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '16px 24px',
        fontSize: 12,
        color: '#6b6e70',
        borderTop: '1px solid #e4e2e2',
        backgroundColor: '#ffffff',
      }}>
        Administración Pública Local Administración Pública Local
        &nbsp;·&nbsp;
        Servicio de Sistemas y Administración Electrónica
      </footer>
    </div>
  )
}

/* Iconos inline */
function LockIcon({ style }) {
  return (
    <svg style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}
function KeyIcon({ style }) {
  return (
    <svg style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  )
}
function ShieldIcon({ style }) {
  return (
    <svg style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  )
}
