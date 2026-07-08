import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { authApi } from '../services/api'
import Avatar from '../components/ui/Avatar'
import { Spinner, toast } from '../components/ui/index.jsx'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

const ROLE_COLORS = { admin:'bg-red-900 text-red-300', editor:'bg-blue-900 text-blue-300', viewer:'bg-gray-50 text-gray-400' }

export default function ProfilePage() {
  const { user, refreshMe }   = useAuth()
  const qc                    = useQueryClient()
  const [preview, setPreview] = useState(null)
  const [uploading, setUpl]   = useState(false)
  const [error, setError]     = useState(null)
  const fileRef               = useRef()

  // Cargar perfil completo desde la API
  const { data: profile } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    initialData: user?.profile,
  })

  // Load avatar
  const { data: avatarUrl } = useQuery({
    queryKey: ['avatar', profile?.sub],
    queryFn: () => profile?.avatar_url ? authApi.avatarUrl() : null,
    enabled: !!profile?.avatar_url,
  })

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2*1024*1024) { setError('Máximo 2MB'); return }
    if (!['image/jpeg','image/png'].includes(file.type)) { setError('Solo JPEG o PNG'); return }
    setError(null)
    const reader = new FileReader()
    reader.onload = (ev) => setPreview({ url: ev.target.result, file })
    reader.readAsDataURL(file)
  }

  const handleUpload = async () => {
    if (!preview) return
    setUpl(true); setError(null)
    try {
      await authApi.uploadAvatar(preview.file)
      setPreview(null)
      await refreshMe()
      qc.invalidateQueries({queryKey:['avatar']})
      qc.invalidateQueries({queryKey:['me']})
      toast('Avatar actualizado correctamente')
    } catch (e) {
      setError(e.message)
    } finally {
      setUpl(false)
    }
  }

  const username = profile?.username || profile?.preferred_username || '?'
  const roles    = user?.roles || []

  function LoginInfo({ label, at, ip, color='text-gray-700' }) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-gray-100">
        <span className="text-xs text-gray-700">{label}</span>
        <div className="text-right">
          {at
            ? <><p className={`text-sm font-medium ${color}`}>{format(new Date(at),'dd/MM/yyyy HH:mm:ss',{locale:es})}</p>
                {ip && <p className="text-xs text-gray-700">desde {ip}</p>}</>
            : <p className="text-sm text-gray-600">Ninguno registrado</p>
          }
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-lg space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Mi perfil</h1>

      {/* Avatar + name */}
      <div className="card p-6 space-y-6">
        <div className="flex items-center gap-5">
          <div className="relative">
            <Avatar username={username} src={preview?.url || avatarUrl || undefined} size="lg"/>
            <button onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary flex items-center justify-center hover:bg-primary-dark transition-colors shadow-lg">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a4 4 0 01-1.414.94l-3.536.708.708-3.536a4 4 0 01.94-1.414z"/></svg>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleFile}/>
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{username}</p>
            <p className="text-sm text-gray-600">{profile?.email || '—'}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {roles.map(r=><span key={r} className={`badge ${ROLE_COLORS[r]||'bg-gray-50 text-gray-700'}`}>{r}</span>)}
            </div>
          </div>
        </div>

        {/* Avatar preview */}
        {preview && (
          <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600">Vista previa:</p>
            <img src={preview.url} alt="preview" className="w-20 h-20 rounded-full object-cover ring-2 ring-primary/30"/>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={handleUpload} disabled={uploading}>
                {uploading ? <Spinner size="sm"/> : 'Confirmar subida'}
              </button>
              <button className="btn-secondary" onClick={() => { setPreview(null); fileRef.current.value='' }}>Cancelar</button>
            </div>
          </div>
        )}
        {error && <p className="text-red-400 text-xs">✗ {error}</p>}

        {/* User info */}
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Información de cuenta</p>
          {[['User ID', profile?.sub],['Username', username],['Email', profile?.email]].map(([l,v])=>(
            <div key={l} className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-xs text-gray-700">{l}</span>
              <span className="text-sm text-gray-700 font-mono">{v||'—'}</span>
            </div>
          ))}
        </div>

        {/* Login security */}
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Seguridad de acceso</p>
          <LoginInfo label="Último acceso exitoso" at={profile?.last_login_at} ip={profile?.last_login_ip} color="text-green-400"/>
          <LoginInfo label="Último intento fallido" at={profile?.last_failed_login_at} ip={profile?.last_failed_login_ip} color="text-red-700"/>
        </div>
      </div>
    </div>
  )
}
