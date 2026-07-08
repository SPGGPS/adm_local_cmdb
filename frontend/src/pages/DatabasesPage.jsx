import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cmdbApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { TableSkeleton, Empty } from '../components/ui/index.jsx'
import { format } from 'date-fns'

const ENGINE_COLORS = {
  postgresql: 'bg-blue-100 text-blue-800 border border-blue-300',
  sqlserver:  'bg-red-100 text-red-800 border border-red-300',
  mysql:      'bg-orange-100 text-orange-800 border border-orange-300',
  mariadb:    'bg-amber-100 text-amber-800 border border-amber-300',
  mongodb:    'bg-green-100 text-green-800 border border-green-300',
  redis:      'bg-rose-100 text-rose-800 border border-rose-300',
  oracle:     'bg-red-100 text-red-900 border border-red-400',
}
function engineBadge(engine) {
  const key = (engine||'').toLowerCase().replace(/\s/g,'')
  for (const [k,v] of Object.entries(ENGINE_COLORS)) if (key.includes(k)) return v
  return 'bg-gray-100 text-gray-700 border border-gray-300'
}

function haMode(mode) {
  if (!mode || mode === 'none') return null
  const cls = mode === 'primary' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`}>{mode}</span>
}

export default function DatabasesPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [engineFilter, setEngineFilter] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['cmdb-databases', search, engineFilter, page],
    queryFn: () => cmdbApi.databases({ search: search||undefined, engine: engineFilter||undefined, page, page_size: 50 }),
  })

  const dbs    = data?.data || []
  const total  = data?.total || 0
  const engines = [...new Set(dbs.map(d => d.db_engine).filter(Boolean))]

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Bases de Datos</h1>
        <p className="text-sm text-gray-500 mt-0.5">Instancias de BBDD con servidor host asociado — {total} instancias</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <input className="input text-sm w-72" placeholder="Buscar nombre, motor, host…"
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
        <select className="input text-sm w-48" value={engineFilter}
          onChange={e => { setEngineFilter(e.target.value); setPage(1) }}>
          <option value="">Todos los motores</option>
          {['postgresql','sqlserver','mysql','mariadb','mongodb','redis','oracle'].map(e => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      </div>

      {isLoading ? <TableSkeleton rows={5} cols={8}/> : dbs.length === 0 ? <Empty label="No hay bases de datos"/> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nombre</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Motor / Versión</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Servidor host</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Conexiones</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tamaño</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">HA / Cluster</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Puerto</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Última sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dbs.map(d => (
                <tr key={d.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={()=>navigate(`/assets/${d.id}`)}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{d.name}</div>
                    <div className="text-[10px] text-gray-400">{d.ips?.[0] || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${engineBadge(d.db_engine)}`}>
                      {d.product_name || d.db_engine}
                    </span>
                    <div className="text-xs text-gray-500 mt-0.5">{d.product_version || d.db_version || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    {d.db_host_asset_id ? (
                      <button className="text-blue-600 hover:underline font-medium text-xs"
                        onClick={() => navigate(`/assets/${d.db_host_asset_id}`)}>
                        🔧 {d.db_host_display || d.db_host || '—'}
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs">{d.db_host || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {d.db_connections_active != null && (
                      <div>
                        <span className="font-semibold text-gray-800">{d.db_connections_active}</span>
                        <span className="text-gray-400"> / {d.db_connections_max || '?'}</span>
                        <div className="w-24 bg-gray-200 rounded-full h-1.5 mt-1">
                          <div className="bg-blue-500 h-1.5 rounded-full"
                            style={{width:`${Math.min(100,(d.db_connections_active/(d.db_connections_max||100))*100)}%`}}/>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">
                    {d.db_size_gb ? `${d.db_size_gb} GB` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs space-y-0.5">
                    {haMode(d.db_ha_mode)}
                    {d.db_is_cluster && <div><span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">Cluster</span></div>}
                    {d.db_replication && <div><span className="text-[10px] text-gray-500">⟳ Replicación</span></div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {d.db_port || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {d.last_sync ? format(new Date(d.last_sync),'dd/MM HH:mm') : '—'}
                  </td>
                </tr>
              ))}
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
