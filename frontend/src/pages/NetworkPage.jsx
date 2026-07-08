import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cmdbApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { TableSkeleton, Empty } from '../components/ui/index.jsx'
import { format } from 'date-fns'

const TYPE_TABS = [
  { key: '',             label: 'Todos',          icon: '🌐' },
  { key: 'switch',       label: 'Switches',       icon: '🔀' },
  { key: 'router',       label: 'Routers',        icon: '📡' },
  { key: 'firewall',     label: 'Firewalls',      icon: '🛡' },
  { key: 'load_balancer',label: 'Balanceadores',  icon: '⚖' },
  { key: 'ap',           label: 'Puntos de Acceso',icon: '📶' },
]

const TYPE_STYLES = {
  switch:        ['bg-blue-100 text-blue-800 border border-blue-300',   '🔀 Switch'],
  router:        ['bg-indigo-100 text-indigo-800 border border-indigo-300','📡 Router'],
  firewall:      ['bg-red-100 text-red-800 border border-red-300',      '🛡 Firewall'],
  load_balancer: ['bg-amber-100 text-amber-800 border border-amber-300','⚖ Load Balancer'],
  ap:            ['bg-green-100 text-green-800 border border-green-300','📶 AP'],
}

export default function NetworkPage() {
  const navigate = useNavigate()
  const [tab, setTab]       = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage]     = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['cmdb-network', tab, search, page],
    queryFn: () => cmdbApi.network({ net_type: tab || undefined, search: search || undefined, page, page_size: 50 }),
  })

  const devices = data?.data || []
  const total   = data?.total || 0

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Red</h1>
        <p className="text-sm text-gray-500 mt-0.5">Switches, routers, firewalls, balanceadores y APs — {total} dispositivos</p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {TYPE_TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1) }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-800'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <input className="input text-sm w-80" placeholder="Buscar por nombre, modelo, fabricante…"
        value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>

      {isLoading ? <TableSkeleton rows={6} cols={7}/> : devices.length === 0 ? <Empty label="No hay dispositivos de red"/> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nombre</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Producto / Versión</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Detalles</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">IPs</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Ubicación</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Última sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {devices.map(d => {
                const [cls, label] = TYPE_STYLES[d.type] || ['bg-gray-100 text-gray-600', d.type]
                return (
                  <tr key={d.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={()=>navigate(`/assets/${d.id}`)}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{d.name}</div>
                      {d.serial_number && <div className="text-[10px] text-gray-400 font-mono">{d.serial_number}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cls}`}>{label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-800 font-medium">{d.product_name || d.model || d.vendor || '—'}</div>
                      <div className="text-xs text-gray-500">{d.product_version || d.firmware_version || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 space-y-0.5">
                      {d.port_count && <div>🔌 {d.port_count} puertos {d.max_speed && `· ${d.max_speed}`}</div>}
                      {d.fw_policy_count && <div>📋 {d.fw_policy_count} políticas{d.fw_ha_mode && ` · HA: ${d.fw_ha_mode}`}</div>}
                      {d.fw_zones && <div>🔒 Zonas: {d.fw_zones?.join(', ')}</div>}
                      {d.lb_algorithm && <div>⚖ {d.lb_algorithm}{d.lb_pool_members && ` · ${d.lb_pool_members.length} miembros`}</div>}
                      {d.coverage_area && <div>📶 {d.coverage_area}{d.connected_clients && ` · ${d.connected_clients} clientes`}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{d.ips?.join(', ') || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{d.cell_full_path || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {d.last_sync ? format(new Date(d.last_sync),'dd/MM HH:mm') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{(page-1)*50+1}–{Math.min(page*50,total)} de {total}</span>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
            <button className="btn-secondary text-xs" disabled={page*50>=total} onClick={()=>setPage(p=>p+1)}>Siguiente</button>
          </div>
        </div>
      )}
    </div>
  )
}
