import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cmdbApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { TableSkeleton, Empty, Modal } from '../components/ui/index.jsx'
import { BackupCell } from '../components/ui/ComplianceBadge'
import { format } from 'date-fns'

const TYPE_TABS = [
  { key: '',         label: 'Todos',     icon: '🖥' },
  { key: 'vcenter',  label: 'vCenter',   icon: '☁' },
  { key: 'physical', label: 'Físicos',   icon: '🔧' },
  { key: 'virtual',  label: 'Virtuales', icon: '💻' },
]

const OS_BADGE = {
  ubuntu:  'bg-orange-100 text-orange-800 border border-orange-300',
  rhel:    'bg-red-100 text-red-800 border border-red-300',
  debian:  'bg-purple-100 text-purple-800 border border-purple-300',
  windows: 'bg-blue-100 text-blue-800 border border-blue-300',
  esxi:    'bg-green-100 text-green-800 border border-green-300',
  photon:  'bg-teal-100 text-teal-800 border border-teal-300',
}
function osFamily(os) {
  if (!os) return null
  const l = os.toLowerCase()
  if (l.includes('ubuntu'))           return 'ubuntu'
  if (l.includes('rhel') || l.includes('red hat')) return 'rhel'
  if (l.includes('debian'))           return 'debian'
  if (l.includes('windows'))          return 'windows'
  if (l.includes('esxi'))             return 'esxi'
  if (l.includes('photon'))           return 'photon'
  return null
}
function osBadgeCls(os) {
  const f = osFamily(os)
  return f ? OS_BADGE[f] : 'bg-gray-100 text-gray-600'
}

function PowerBadge({ state, onClick }) {
  if (!state) return null
  const cls = state === 'poweredOn'  ? 'bg-green-100 text-green-700 border border-green-300'
            : state === 'poweredOff' ? 'bg-red-100 text-red-700 border border-red-300'
            :                          'bg-amber-100 text-amber-700 border border-amber-300'
  const label = state === 'poweredOn' ? '● On' : state === 'poweredOff' ? '● Off' : '● Suspended'
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cls} ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-current' : ''}`}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(state) } : undefined}
      title={onClick ? `Filtrar por: ${label}` : undefined}>
      {label}
    </span>
  )
}

function TypeBadge({ type, onClick }) {
  const map = {
    server_physical: ['bg-slate-100 text-slate-800 border border-slate-300', '🔧 Físico',  'physical'],
    server_virtual:  ['bg-blue-100 text-blue-800 border border-blue-300',   '💻 Virtual', 'virtual'],
    vcenter:         ['bg-violet-100 text-violet-800 border border-violet-300','☁ vCenter','vcenter'],
  }
  const [cls, label, tabKey] = map[type] || ['bg-gray-100 text-gray-600', type, '']
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cls} ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-current' : ''}`}
      onClick={onClick && tabKey ? (e) => { e.stopPropagation(); onClick(tabKey) } : undefined}
      title={onClick ? `Filtrar: ${label}` : undefined}>
      {label}
    </span>
  )
}

function RelationsModal({ asset, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['asset-relations', asset.id],
    queryFn: () => cmdbApi.relations(asset.id),
    enabled: !!asset.id,
  })
  return (
    <Modal open onClose={onClose} title={`Relaciones CMDB — ${asset.name}`} maxW="max-w-2xl">
      {isLoading ? <TableSkeleton rows={3} cols={3}/> : (
        <div className="space-y-4 text-sm">
          {data?.hosted_vms?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">💻 VMs alojadas ({data.hosted_vms.length})</p>
              <div className="space-y-1">
                {data.hosted_vms.map(v => (
                  <div key={v.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                    <span className="font-medium text-gray-900 w-48">{v.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${osBadgeCls(v.os)}`}>{v.os || '—'}</span>
                    {v.hypervisor_name && <span className="text-xs text-gray-500">en {v.hypervisor_name}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {data?.databases?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">🗄 Bases de datos ({data.databases.length})</p>
              <div className="space-y-1">
                {data.databases.map(d => (
                  <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-cyan-50 border border-cyan-200">
                    <span className="font-medium text-gray-900 w-48">{d.name}</span>
                    <span className="text-xs font-mono bg-cyan-100 px-2 py-0.5 rounded border border-cyan-300">{d.engine} {d.version}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data?.web_servers?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">🌐 Servidores web ({data.web_servers.length})</p>
              <div className="space-y-1">
                {data.web_servers.map(w => (
                  <div key={w.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
                    <span className="font-medium text-gray-900 w-48">{w.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-green-100 border border-green-300">{w.software || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!data?.hosted_vms?.length && !data?.databases?.length && !data?.web_servers?.length && (
            <p className="text-gray-500 text-center py-4">Sin relaciones CMDB registradas.</p>
          )}
        </div>
      )}
    </Modal>
  )
}

const POWER_LABELS = { poweredOn: '● Encendido', poweredOff: '● Apagado', suspended: '● Suspendido' }
const TAB_LABELS   = { physical: '🔧 Físicos', virtual: '💻 Virtuales', vcenter: '☁ vCenter' }
const OS_LABELS    = { ubuntu:'Ubuntu', rhel:'RHEL', debian:'Debian', windows:'Windows', esxi:'ESXi', photon:'Photon' }

function NotesCell({ assetId, notes, queryKey }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(notes || '')
  const ref = useRef(null)
  const mut = useMutation({
    mutationFn: (text) => cmdbApi.updateNotes(assetId, text),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); setEditing(false) },
  })
  if (editing) return (
    <div className="flex items-center gap-1 mt-0.5" onClick={e => e.stopPropagation()}>
      <input autoFocus ref={ref} className="text-[11px] border border-gray-300 rounded px-1 py-0.5 w-40 focus:outline-none focus:border-primary"
        value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key==='Enter') mut.mutate(val); if (e.key==='Escape') setEditing(false) }}/>
      <button className="text-[10px] text-primary font-medium" onClick={() => mut.mutate(val)}>✓</button>
      <button className="text-[10px] text-gray-400" onClick={() => setEditing(false)}>✕</button>
    </div>
  )
  return (
    <div className="flex items-center gap-1 mt-0.5 group/notes" onClick={e => { e.stopPropagation(); setEditing(true); setVal(notes || '') }}>
      {notes
        ? <span className="text-[11px] text-amber-700 italic truncate max-w-[160px] cursor-pointer" title={notes}>{notes}</span>
        : <span className="text-[10px] text-gray-300 cursor-pointer opacity-0 group-hover/notes:opacity-100">+ nota</span>}
    </div>
  )
}

export default function ServersPage() {
  const navigate = useNavigate()
  const [tab,          setTab]          = useState('')
  const [search,       setSearch]       = useState('')
  const [powerFilter,  setPowerFilter]  = useState('')
  const [osFilter,     setOsFilter]     = useState('')
  const [page,         setPage]         = useState(1)
  const [relations,    setRelations]    = useState(null)

  const resetPage = () => setPage(1)

  const { data, isLoading } = useQuery({
    queryKey: ['cmdb-servers', tab, search, powerFilter, osFilter, page],
    queryFn: () => cmdbApi.servers({
      server_type:    tab || undefined,
      search:         search || undefined,
      vm_power_state: powerFilter || undefined,
      os:             osFilter || undefined,
      page,
      page_size: 50,
    }),
  })

  const servers = data?.data || []
  const total   = data?.total || 0

  const hasFilters = !!(powerFilter || osFilter)

  const handleTabClick    = (key) => { setTab(key); resetPage() }
  const handlePowerFilter = (state) => { setPowerFilter(p => p === state ? '' : state); resetPage() }
  const handleOsFilter    = (os) => {
    const fam = osFamily(os)
    if (!fam) return
    setOsFilter(f => f === fam ? '' : fam)
    resetPage()
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Servidores</h1>
          <p className="text-sm text-gray-500 mt-0.5">Servidores físicos, máquinas virtuales y vCenters — {total} registros</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {TYPE_TABS.map(t => (
          <button key={t.key} onClick={() => handleTabClick(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-800'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Búsqueda */}
      <div className="flex gap-3">
        <input className="input text-sm w-80" placeholder="Buscar por nombre, OS, producto, número de serie…"
          value={search} onChange={e => { setSearch(e.target.value); resetPage() }}/>
      </div>

      {/* Filtros activos */}
      {hasFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-600 font-medium">Filtros:</span>
          {powerFilter && (
            <button onClick={() => { setPowerFilter(''); resetPage() }}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all hover:scale-105
                ${powerFilter === 'poweredOn'  ? 'bg-green-50 text-green-700 border-green-300'
                : powerFilter === 'poweredOff' ? 'bg-red-50 text-red-700 border-red-300'
                :                                'bg-amber-50 text-amber-700 border-amber-300'}`}>
              {POWER_LABELS[powerFilter]} <span className="opacity-60 ml-0.5">✕</span>
            </button>
          )}
          {osFilter && (
            <button onClick={() => { setOsFilter(''); resetPage() }}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all hover:scale-105 ${OS_BADGE[osFilter] || 'bg-gray-100 text-gray-600'}`}>
              OS: {OS_LABELS[osFilter] || osFilter} <span className="opacity-60 ml-0.5">✕</span>
            </button>
          )}
          <button onClick={() => { setPowerFilter(''); setOsFilter(''); resetPage() }}
            className="text-xs text-primary underline">Limpiar todo</button>
        </div>
      )}

      {/* Tabla */}
      {isLoading ? <TableSkeleton rows={6} cols={8}/> : servers.length === 0 ? <Empty label="No hay servidores"/> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nombre</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Producto / Versión</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">OS</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">CPU · RAM · Disco</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">vCenter / Host</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">IPs</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Backup Local</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Backup Cloud</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Última sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {servers.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => navigate(`/assets/${s.id}`)}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{s.name}</div>
                    {s.serial_number && <div className="text-[10px] text-gray-400 font-mono">{s.serial_number}</div>}
                    <NotesCell assetId={s.id} notes={s.notes} queryKey={['cmdb-servers', tab, search, powerFilter, osFilter, page]}/>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex flex-col items-start gap-0.5">
                      <TypeBadge type={s.type} onClick={handleTabClick}/>
                      {s.vm_power_state && (
                        <PowerBadge state={s.vm_power_state} onClick={handlePowerFilter}/>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-800 font-medium">{s.product_name || s.vendor || '—'}</div>
                    <div className="text-xs text-gray-500">{s.product_version || s.firmware_version || '—'}</div>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {s.os
                      ? <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-current ${osBadgeCls(s.os)}`}
                          onClick={() => handleOsFilter(s.os)}
                          title={`Filtrar por OS: ${s.os}`}>
                          {s.os}
                        </span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {s.cpu_count && <span>{s.cpu_count}vCPU</span>}
                    {s.ram_gb && <span> · {s.ram_gb}GB</span>}
                    {s.total_disk_gb && <span> · {s.total_disk_gb}GB</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {s.type === 'vcenter' && (s.vcenter_datacenter || s.vcenter_cluster) && (
                      <div><span className="font-medium">{s.vcenter_datacenter}</span>{s.vcenter_cluster && <span className="text-gray-400"> / {s.vcenter_cluster}</span>}</div>
                    )}
                    {s.vcenter_name && <div className="text-gray-500">☁ {s.vcenter_name}</div>}
                    {s.hypervisor_name && <div className="text-gray-500">🔧 {s.hypervisor_name}</div>}
                    {s.vm_datastore && <div className="text-gray-400 text-[10px]">📀 {s.vm_datastore}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {s.ips?.slice(0, 2).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3"><BackupCell value={s.last_backup_local}/></td>
                  <td className="px-4 py-3"><BackupCell value={s.last_backup_cloud}/></td>
                  <td className="px-4 py-3 text-xs text-gray-600" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-2 items-center">
                      <span>{s.last_sync ? format(new Date(s.last_sync), 'dd/MM HH:mm') : '—'}</span>
                      {(s.type === 'server_physical' || s.type === 'vcenter') && (
                        <button className="btn-secondary text-xs" onClick={() => setRelations(s)}>🔗 Relaciones</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{(page - 1) * 50 + 1}–{Math.min(page * 50, total)} de {total}</span>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
            <button className="btn-secondary text-xs" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Siguiente</button>
          </div>
        </div>
      )}

      {relations && <RelationsModal asset={relations} onClose={() => setRelations(null)}/>}
    </div>
  )
}
