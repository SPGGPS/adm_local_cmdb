import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cmdbApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { TableSkeleton, Empty } from '../components/ui/index.jsx'
import { format } from 'date-fns'

const SW_COLORS = {
  nginx:   'bg-green-100 text-green-800 border border-green-300',
  apache:  'bg-red-100 text-red-800 border border-red-300',
  iis:     'bg-blue-100 text-blue-800 border border-blue-300',
  tomcat:  'bg-orange-100 text-orange-800 border border-orange-300',
  caddy:   'bg-teal-100 text-teal-800 border border-teal-300',
  haproxy: 'bg-amber-100 text-amber-800 border border-amber-300',
}
function swBadge(sw) {
  const key = (sw||'').toLowerCase()
  return SW_COLORS[key] || 'bg-gray-100 text-gray-700 border border-gray-300'
}

// web_virtual_hosts: strings planos desde DAG EDR
export default function WebServersPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [softwareFilter, setSoftwareFilter] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['cmdb-web-servers', search, softwareFilter, page],
    queryFn: () => cmdbApi.webServers({ search: search||undefined, software: softwareFilter||undefined, page, page_size: 50 }),
  })

  const servers = data?.data || []
  const total   = data?.total || 0

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Servidores Web</h1>
        <p className="text-sm text-gray-500 mt-0.5">Nginx, Apache, IIS, Tomcat… con servidor host asociado — {total} instancias</p>
      </div>

      <div className="flex gap-3">
        <input className="input text-sm w-72" placeholder="Buscar nombre, software, host…"
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
        <select className="input text-sm w-40" value={softwareFilter}
          onChange={e => { setSoftwareFilter(e.target.value); setPage(1) }}>
          <option value="">Todo el software</option>
          {['nginx','apache','iis','tomcat','caddy','haproxy'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {isLoading ? <TableSkeleton rows={5} cols={7}/> : servers.length === 0 ? <Empty label="No hay servidores web"/> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nombre</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Software / Versión</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Servidor host</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Virtual Hosts</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Puerto · SSL</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Cert SSL</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Última sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {servers.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={()=>navigate(`/assets/${s.id}`)}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{s.name}</div>
                    <div className="text-[10px] text-gray-400">{s.ips?.[0] || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${swBadge(s.web_server_software)}`}>
                      {s.product_name || s.web_server_software || '—'}
                    </span>
                    <div className="text-xs text-gray-500 mt-0.5">{s.product_version || s.web_server_version || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    {s.host_asset_id ? (
                      <button className="text-blue-600 hover:underline font-medium text-xs"
                        onClick={() => navigate(`/assets/${s.host_asset_id}`)}>
                        💻 {s.host_asset_name || '—'}
                      </button>
                    ) : <span className="text-gray-400 text-xs">Sin host asignado</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">
                    {s.web_virtual_hosts?.length > 0 ? (
                      <div className="space-y-0.5">
                        {s.web_virtual_hosts.slice(0,3).map((vh,i) => {
                          const label = typeof vh === 'string' ? vh : (vh.server_name || vh.fqdn || String(vh))
                          return (
                            <div key={i} className="truncate max-w-[200px]">
                              <span className="font-mono text-blue-700">{label}</span>
                            </div>
                          )
                        })}
                        {s.web_virtual_hosts.length > 3 && (
                          <div className="text-gray-400">+{s.web_virtual_hosts.length-3} más</div>
                        )}
                      </div>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="font-mono text-gray-700">:{s.web_server_port || '?'}</span>
                    {s.web_ssl_enabled && <span className="ml-2 text-green-600 font-semibold">🔒 SSL</span>}
                  </td>
                  <td className="px-4 py-3 text-[10px] font-mono max-w-[200px]">
                    {s.web_ssl_cert_path ? (
                      <span className="text-green-700 truncate block" title={s.web_ssl_cert_path}>
                        🔒 {s.web_ssl_cert_path}
                      </span>
                    ) : s.web_config_path ? (
                      <span className="text-gray-400 truncate block" title={s.web_config_path}>
                        {s.web_config_path}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {s.last_sync ? format(new Date(s.last_sync),'dd/MM HH:mm') : '—'}
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
