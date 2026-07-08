import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { certificatesApi } from '../services/api'
import { Modal, Spinner, Empty, TableSkeleton, toast } from '../components/ui/index.jsx'
import { useAuth } from '../context/AuthContext'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

const CA_TYPES = [
  { value:'public_trusted', label:'CA Pública', color:'bg-green-100 text-green-700 border border-green-300' },
  { value:'fnmt',           label:'FNMT 🏛',    color:'bg-blue-100 text-blue-700 border border-blue-300' },
  { value:'internal_ca',    label:'CA Interna', color:'bg-purple-100 text-purple-700 border border-purple-300' },
  { value:'self_signed',    label:'Autofirmado',color:'bg-orange-100 text-orange-700 border border-orange-300' },
  { value:'unknown',        label:'Desconocida',color:'bg-gray-100 text-gray-600' },
]
const KEY_TYPES = ['rsa_2048','rsa_4096','ecdsa_256','ecdsa_384','ed25519','other']
const KEY_LABELS = { rsa_2048:'RSA 2048', rsa_4096:'RSA 4096', ecdsa_256:'ECDSA P-256', ecdsa_384:'ECDSA P-384', ed25519:'Ed25519', other:'Otro' }

function certStatus(cert) {
  if (!cert.expires_at) return 'unknown'
  const days = cert.days_remaining ?? Math.floor((new Date(cert.expires_at) - new Date()) / 86400000)
  if (days < 0)  return 'expired'
  if (days <= 7) return 'critical'
  if (days <= 30) return 'expiring'
  return 'valid'
}
function daysRemaining(cert) {
  if (cert.days_remaining != null) return cert.days_remaining
  if (!cert.expires_at) return null
  return Math.floor((new Date(cert.expires_at) - new Date()) / 86400000)
}

function StatusBadge({ cert }) {
  const s = certStatus(cert)
  const days = daysRemaining(cert)
  if (s === 'valid')    return <span className="badge bg-green-100 text-green-700 border border-green-300">✓ Válido</span>
  if (s === 'expiring') return <span className="badge bg-orange-100 text-orange-700 border border-orange-300">⚠ Caduca pronto</span>
  if (s === 'critical') return <span className="badge bg-red-100 text-red-800 border border-red-500 font-bold animate-pulse">🔴 Crítico</span>
  if (s === 'expired')  return <span className="badge bg-red-200 text-red-900 border border-red-600 font-bold">❌ Expirado</span>
  return <span className="badge bg-gray-100 text-gray-600">—</span>
}

function DaysCell({ cert }) {
  const days = daysRemaining(cert)
  if (days == null) return <span className="text-gray-600">—</span>
  if (days < 0)  return <span className="text-red-700 text-xs font-bold">❌ hace {Math.abs(days)}d</span>
  if (days <= 7) return <span className="text-red-700 text-xs font-bold animate-pulse">🔴 {days}d</span>
  if (days <= 30) return <span className="text-orange-700 text-xs font-semibold">⚠ {days}d</span>
  return <span className="text-green-700 text-xs">{days}d</span>
}

function CertForm({ initial, onSubmit, loading }) {
  const empty = { common_name:'', san_domains:'', issuer:'', issuer_common_name:'', issued_at:'', expires_at:'', serial_number:'', key_type:'rsa_2048', wildcard:false, auto_renew:false, managed_by:'', ca_type:'unknown', environment:'production', notes:'' }
  const [f, setF] = useState(initial ? {
    ...initial,
    san_domains: (initial.san_domains||[]).join(', '),
    issued_at: initial.issued_at || '',
    expires_at: initial.expires_at || '',
  } : empty)
  const set = (k,v) => setF(p=>({...p,[k]:v}))

  const handleSubmit = () => {
    const payload = {
      ...f,
      san_domains: f.san_domains ? f.san_domains.split(',').map(s=>s.trim()).filter(Boolean) : [],
    }
    onSubmit(payload)
  }

  const expiresDate = f.expires_at ? new Date(f.expires_at) : null
  const daysLeft = expiresDate ? Math.floor((expiresDate - new Date()) / 86400000) : null
  const expWarn = daysLeft != null && daysLeft <= 30

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Common Name *</label>
          <input className="input" placeholder="sede.sistemas.local" value={f.common_name} onChange={e=>set('common_name',e.target.value)}/></div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">SANs (separados por coma)</label>
          <input className="input" placeholder="sede.sistemas.local, api.sistemas.local" value={f.san_domains} onChange={e=>set('san_domains',e.target.value)}/></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Emisor</label>
          <input className="input" placeholder="Let's Encrypt, FNMT, DigiCert" value={f.issuer||''} onChange={e=>set('issuer',e.target.value)}/></div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Organización emisora</label>
          <input className="input" placeholder="Let's Encrypt Authority X3" value={f.issuer_common_name||''} onChange={e=>set('issuer_common_name',e.target.value)}/></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Emitido el</label>
          <input type="date" className="input" value={f.issued_at} onChange={e=>set('issued_at',e.target.value)}/></div>
        <div>
          <label className={`text-xs block mb-1 ${expWarn?'text-orange-400 font-semibold':'text-gray-600'}`}>
            Caduca el * {expWarn && `(⚠ ${daysLeft} días)`}
          </label>
          <input type="date" className={`input ${expWarn?'border-orange-500':''}`} value={f.expires_at} onChange={e=>set('expires_at',e.target.value)}/>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Tipo de CA</label>
          <select className="input" value={f.ca_type||'unknown'} onChange={e=>set('ca_type',e.target.value)}>
            {CA_TYPES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Tipo de clave</label>
          <select className="input" value={f.key_type||'rsa_2048'} onChange={e=>set('key_type',e.target.value)}>
            {KEY_TYPES.map(k=><option key={k} value={k}>{KEY_LABELS[k]}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Gestionado por</label>
          <input className="input" placeholder="cert-manager, manual, FNMT" value={f.managed_by||''} onChange={e=>set('managed_by',e.target.value)}/></div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Entorno</label>
          <select className="input" value={f.environment||'production'} onChange={e=>set('environment',e.target.value)}>
            <option value="production">Producción</option><option value="staging">Staging</option>
            <option value="development">Desarrollo</option><option value="dr">DR</option>
          </select>
        </div>
      </div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Número de serie</label>
        <input className="input font-mono" placeholder="03:A1:4F:…" value={f.serial_number||''} onChange={e=>set('serial_number',e.target.value)}/></div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={!!f.wildcard} onChange={e=>set('wildcard',e.target.checked)}/> Wildcard (*.dominio)</label>
        <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={!!f.auto_renew} onChange={e=>set('auto_renew',e.target.checked)}/> Renovación automática</label>
      </div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Notas</label>
        <textarea className="input h-16 resize-none" value={f.notes||''} onChange={e=>set('notes',e.target.value)}/></div>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={!f.common_name||!f.expires_at||loading} onClick={handleSubmit}>
          {loading ? <Spinner size="sm"/> : (initial ? 'Guardar cambios' : 'Crear certificado')}
        </button>
      </div>
    </div>
  )
}

export default function CertificatesPage() {
  const location = useLocation()
  const qc = useQueryClient()
  const { isEditor } = useAuth()
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editCert, setEditCert] = useState(null)
  const [detailCert, setDetailCert] = useState(null)

  const { data:certs, isLoading } = useQuery({
    queryKey: ['certificates', statusFilter, search],
    queryFn: () => certificatesApi.list({ status: statusFilter||undefined, search: search||undefined }),
    placeholderData: (prev) => prev,
  })
  const { data:summary } = useQuery({ queryKey:['cert-summary'], queryFn:()=>certificatesApi.summary() })

  const createMut = useMutation({
    mutationFn: certificatesApi.create,
    onSuccess: () => { qc.invalidateQueries({queryKey:['certificates']}); qc.invalidateQueries({queryKey:['cert-summary']}); setShowCreate(false); toast('Certificado creado') },
    onError: e => toast(e.message,'error'),
  })
  const updateMut = useMutation({
    mutationFn: ({id,...d}) => certificatesApi.update(id,d),
    onSuccess: () => { qc.invalidateQueries({queryKey:['certificates']}); qc.invalidateQueries({queryKey:['cert-summary']}); setEditCert(null); toast('Certificado actualizado') },
    onError: e => toast(e.message,'error'),
  })
  const deleteMut = useMutation({
    mutationFn: certificatesApi.delete,
    onSuccess: () => { qc.invalidateQueries({queryKey:['certificates']}); qc.invalidateQueries({queryKey:['cert-summary']}); toast('Certificado eliminado') },
    onError: e => toast(e.message,'error'),
  })

  const list = Array.isArray(certs) ? certs : (certs?.data || [])
  const hasCritical = (summary?.critical || 0) > 0 || (summary?.expired || 0) > 0

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Certificados TLS/SSL</h1>
          <p className="text-xs text-gray-600 mt-0.5">{summary?.total || 0} certificados gestionados</p>
        </div>
        {isEditor() && <button className="btn-primary" onClick={()=>setShowCreate(true)}>+ Nuevo certificado</button>}
      </div>

      {/* Alert banner */}
      {hasCritical && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-50 border border-red-300 text-sm">
          <span className="text-red-600 text-lg">🔴</span>
          <span className="text-red-800 font-medium">
            {summary?.critical > 0 && `${summary.critical} certificado${summary.critical>1?'s':''} crítico${summary.critical>1?'s':''} (caducan en menos de 7 días)`}
            {summary?.critical > 0 && summary?.expired > 0 && ' · '}
            {summary?.expired > 0 && `${summary.expired} certificado${summary.expired>1?'s':''} expirado${summary.expired>1?'s':''}`}
          </span>
        </div>
      )}

      {/* Summary bar */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          {[
            {key:'',label:`${summary.total} total`,cls:'bg-gray-50 text-gray-700'},
            {key:'valid',label:`${summary.valid} válidos ✓`,cls:'bg-green-100 text-green-700 border border-green-300'},
            {key:'expiring',label:`${summary.expiring_soon} próximos ⚠`,cls:'bg-orange-100 text-orange-700 border border-orange-300'},
            {key:'critical',label:`${summary.critical} críticos 🔴`,cls:'bg-red-100 text-red-800 border border-red-400 font-bold'},
            {key:'expired',label:`${summary.expired} expirados ❌`,cls:'bg-red-200 text-red-900 border border-red-500 font-bold'},
          ].map(b=>(
            <button key={b.key} onClick={()=>setStatusFilter(s=>s===b.key?'':b.key)}
              className={`badge border cursor-pointer transition-all hover:scale-105 ${b.cls} ${statusFilter===b.key?'ring-2 ring-white':''}`}>
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="card p-3">
        <input className="input w-72" placeholder="Buscar por CN, emisor, SAN…"
          value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton rows={6} cols={7}/> : list.length === 0 ? <Empty message="No hay certificados"/> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-600 uppercase" style={{backgroundColor:"#F3F4F6",borderBottom:"2px solid #E5E7EB"}}>
                  <th className="px-4 py-3 text-left">Common Name</th>
                  <th className="px-4 py-3 text-left">Emisor</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Días</th>
                  <th className="px-4 py-3 text-left">Caduca</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Gestión</th>
                  {isEditor() && <th className="px-4 py-3 text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map(cert => {
                  const s = certStatus(cert)
                  const rowCls = s==='critical'?'bg-red-50':s==='expired'?'bg-red-100/60':''
                  return (
                    <tr key={cert.id} className={`hover:bg-red-50/50 transition-colors ${rowCls}`}>
                      <td className="px-4 py-3">
                        <button className="font-medium text-blue-400 hover:underline text-left" onClick={()=>setDetailCert(cert)}>
                          {cert.wildcard && <span className="text-gray-500 text-xs mr-1">*.</span>}
                          {cert.common_name}
                        </button>
                        {(cert.san_domains||[]).length > 1 && (
                          <p className="text-xs text-gray-600 truncate max-w-xs">{cert.san_domains.slice(0,3).join(', ')}{cert.san_domains.length>3?'…':''}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{cert.issuer_common_name||cert.issuer||'—'}</td>
                      <td className="px-4 py-3"><StatusBadge cert={cert}/></td>
                      <td className="px-4 py-3"><DaysCell cert={cert}/></td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {cert.expires_at ? format(new Date(cert.expires_at),'dd/MM/yyyy',{locale:es}) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {cert.key_type ? <span className="badge bg-gray-100 text-gray-700">{KEY_LABELS[cert.key_type]||cert.key_type}</span> : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          {cert.auto_renew && <span className="badge bg-green-900/40 text-green-400">🔄 Auto</span>}
                          {cert.managed_by && <span className="text-gray-700">{cert.managed_by}</span>}
                        </div>
                      </td>
                      {isEditor() && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button className="btn-secondary text-xs" onClick={()=>setEditCert(cert)}>Editar</button>
                            <button className="text-red-400 hover:text-red-300 text-xs" onClick={()=>{ if(confirm('¿Eliminar certificado?')) deleteMut.mutate(cert.id) }}>✕</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {detailCert && (
        <div className="card p-5 space-y-4 border-amber-700/30">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-base font-bold text-gray-900">{detailCert.common_name}</h2>
                <StatusBadge cert={detailCert}/>
              </div>
              {(detailCert.san_domains||[]).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {detailCert.san_domains.map(d=><span key={d} className="badge bg-gray-50 text-gray-700">{d}</span>)}
                </div>
              )}
            </div>
            <button className="text-gray-500 hover:text-gray-700 text-xl" onClick={()=>setDetailCert(null)}>✕</button>
          </div>

          {/* Progress bar */}
          {detailCert.expires_at && detailCert.issued_at && (() => {
            const total = new Date(detailCert.expires_at) - new Date(detailCert.issued_at)
            const remaining = new Date(detailCert.expires_at) - new Date()
            const pct = Math.max(0,Math.min(100,(remaining/total)*100))
            const days = daysRemaining(detailCert)
            const barColor = days<=7?'bg-red-500':days<=30?'bg-orange-400':'bg-green-500'
  return (
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>{format(new Date(detailCert.issued_at),'dd/MM/yyyy',{locale:es})}</span>
                  <span className={days<=7?'text-red-600':days<=30?'text-orange-600':'text-green-400'}>{days} días restantes</span>
                  <span>{format(new Date(detailCert.expires_at),'dd/MM/yyyy',{locale:es})}</span>
                </div>
                <div className="w-full bg-gray-50 rounded-full h-2">
                  <div className={`h-2 rounded-full transition-all ${barColor}`} style={{width:`${pct}%`}}/>
                </div>
              </div>
            )
          })()}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-600 uppercase">Entidad Certificadora</h3>
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-gray-700">Emisor</span><span className="text-gray-700">{detailCert.issuer_common_name||detailCert.issuer||'—'}</span></div>
                {detailCert.issuer_organization && <div className="flex justify-between"><span className="text-gray-700">Organización</span><span className="text-gray-700">{detailCert.issuer_organization}</span></div>}
                {detailCert.ca_type && <div className="flex justify-between"><span className="text-gray-700">Tipo CA</span><span className={`badge ${CA_TYPES.find(c=>c.value===detailCert.ca_type)?.color||'bg-gray-100 text-gray-600'}`}>{CA_TYPES.find(c=>c.value===detailCert.ca_type)?.label||detailCert.ca_type}</span></div>}
                {detailCert.chain_valid != null && <div className="flex justify-between"><span className="text-gray-700">Cadena</span><span className={detailCert.chain_valid?'text-green-400':'text-red-600'}>{detailCert.chain_valid?'✓ Válida':'⚠ Inválida'}</span></div>}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-600 uppercase">Criptografía</h3>
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-gray-700">Tipo clave</span><span className="text-gray-700">{KEY_LABELS[detailCert.key_type]||detailCert.key_type||'—'}</span></div>
                {detailCert.signature_algorithm && <div className="flex justify-between"><span className="text-gray-700">Algoritmo</span><span className="text-gray-700 text-xs">{detailCert.signature_algorithm}</span></div>}
                <div className="flex justify-between"><span className="text-gray-700">Wildcard</span><span className={detailCert.wildcard?'text-green-400':'text-gray-600'}>{detailCert.wildcard?'✓ Sí':'No'}</span></div>
                <div className="flex justify-between"><span className="text-gray-700">Auto-renew</span><span className={detailCert.auto_renew?'text-green-400':'text-gray-600'}>{detailCert.auto_renew?'✓ Activo':'No'}</span></div>
              </div>
            </div>
          </div>

          {detailCert.serial_number && (
            <div><span className="text-xs text-gray-700">Serie: </span><span className="font-mono text-xs text-gray-600">{detailCert.serial_number}</span></div>
          )}
          {detailCert.notes && <p className="text-xs text-gray-600 italic">{detailCert.notes}</p>}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={()=>setShowCreate(false)} title="Nuevo certificado">
        <CertForm onSubmit={d=>createMut.mutate(d)} loading={createMut.isPending}/>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editCert} onClose={()=>setEditCert(null)} title="Editar certificado">
        {editCert && <CertForm initial={editCert} onSubmit={d=>updateMut.mutate({id:editCert.id,...d})} loading={updateMut.isPending}/>}
      </Modal>
    </div>
  )
}
