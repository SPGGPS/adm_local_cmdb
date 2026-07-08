import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { cmdbApi } from '../services/api'
import { TableSkeleton, Empty, Spinner } from '../components/ui/index.jsx'
import { AssetTypeBadge } from '../components/ui/index.jsx'
import { format } from 'date-fns'

// Helpers

function K8sVersionBadge({ version }) {
  if (!version) return <span className="text-gray-400 text-xs">—</span>
  return <span className="font-mono text-xs bg-blue-50 text-blue-800 border border-blue-300 px-1.5 py-0.5 rounded">{version}</span>
}

function ProviderBadge({ provider }) {
  const MAP = {
    k3s:      'bg-amber-100 text-amber-800 border-amber-300',
    kubeadm:  'bg-blue-100 text-blue-800 border-blue-300',
    eks:      'bg-orange-100 text-orange-800 border-orange-300',
    gke:      'bg-green-100 text-green-800 border-green-300',
    aks:      'bg-indigo-100 text-indigo-800 border-indigo-300',
    rke2:     'bg-purple-100 text-purple-800 border-purple-300',
    rancher:  'bg-teal-100 text-teal-800 border-teal-300',
  }
  const key = (provider || '').toLowerCase()
  const cls = Object.entries(MAP).find(([k]) => key.includes(k))?.[1] ?? 'bg-gray-100 text-gray-700 border-gray-300'
  return provider
    ? <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${cls}`}>{provider}</span>
    : <span className="text-gray-400 text-xs">—</span>
}

function NodeRoleBadge({ role }) {
  if (role === 'control_plane') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-300 font-bold">Control Plane</span>
  if (role === 'worker')        return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 font-semibold">Worker</span>
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">{role}</span>
}

function NodeStatusBadge({ status }) {
  if (status === 'Ready')    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300 font-semibold">✓ Ready</span>
  if (status === 'NotReady') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 font-semibold">✕ NotReady</span>
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">{status}</span>
}

function PodStatusBadge({ status }) {
  if (status === 'Running')            return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300 font-semibold">Running</span>
  if (status === 'CrashLoopBackOff')   return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-400 font-bold">CrashLoop</span>
  if (status === 'Pending')            return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">Pending</span>
  if (status === 'Completed')          return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">Completed</span>
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">{status}</span>
}

function ContainerStatusBadge({ status }) {
  const MAP = {
    running: 'bg-green-100 text-green-700 border-green-300',
    stopped: 'bg-gray-100 text-gray-600 border-gray-300',
    exited:  'bg-red-100 text-red-700 border-red-300',
    paused:  'bg-amber-100 text-amber-700 border-amber-300',
  }
  const cls = MAP[(status||'').toLowerCase()] ?? 'bg-gray-100 text-gray-600 border-gray-300'
  return status ? <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${cls}`}>{status}</span>
    : <span className="text-gray-400 text-xs">—</span>
}

// Detalle de cluster

function ClusterDetail({ cluster, onClose }) {
  const [tab, setTab] = useState('nodes')
  const nodes        = cluster.k8s_nodes        || []
  const pods         = cluster.k8s_pods         || []
  const deployments  = cluster.k8s_deployments  || []
  const helmReleases = cluster.k8s_helm_releases || []
  const namespaces   = cluster.k8s_namespaces   || []

  const tabs = [
    { id:'nodes',    label:`Nodos (${nodes.length})` },
    { id:'pods',     label:`Pods (${pods.length})` },
    { id:'deploys',  label:`Deployments (${deployments.length})` },
    { id:'helm',     label:`Helm (${helmReleases.length})` },
    { id:'info',     label:'Info' },
  ]

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="flex flex-wrap gap-3">
        <span className="badge bg-blue-50 text-blue-800 border border-blue-300 font-semibold">
          k8s {cluster.k8s_version || '—'}
        </span>
        {cluster.k8s_provider && <ProviderBadge provider={cluster.k8s_provider}/>}
        <span className="badge bg-indigo-50 text-indigo-700 border border-indigo-200">
          🎛 {cluster.k8s_control_plane_count || 0} control-plane
        </span>
        <span className="badge bg-blue-50 text-blue-700 border border-blue-200">
          ⚙ {cluster.k8s_worker_count || 0} workers
        </span>
        {cluster.k8s_network_plugin && (
          <span className="badge bg-purple-50 text-purple-700 border border-purple-200">
            🔗 {cluster.k8s_network_plugin}
          </span>
        )}
        {cluster.k8s_container_runtime && (
          <span className="badge bg-gray-100 text-gray-700 border border-gray-300">
            📦 {cluster.k8s_container_runtime}
          </span>
        )}
      </div>

      {/* Namespaces */}
      {namespaces.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-gray-500 font-medium mr-1">Namespaces:</span>
          {namespaces.map(ns => (
            <span key={ns} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200 font-mono">{ns}</span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${tab===t.id ? 'border-b-2 border-red-600 text-red-700 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Nodos */}
      {tab === 'nodes' && (
        nodes.length === 0 ? <Empty message="Sin nodos registrados"/> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Rol</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Versión</th>
                <th className="px-3 py-2 text-left">IPs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {nodes.map((n, i) => (
                <tr key={i} className={`hover:bg-blue-50/30 ${n.role === 'control_plane' ? 'bg-indigo-50/20' : ''}`}>
                  <td className="px-3 py-2 font-semibold text-gray-900 font-mono text-xs">{n.name}</td>
                  <td className="px-3 py-2"><NodeRoleBadge role={n.role}/></td>
                  <td className="px-3 py-2"><NodeStatusBadge status={n.status}/></td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{n.version || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 font-mono">{(n.ips||[]).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {/* Pods */}
      {tab === 'pods' && (
        pods.length === 0 ? <Empty message="Sin pods registrados"/> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Namespace</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Imagen(es)</th>
                <th className="px-3 py-2 text-left">Nodo</th>
                <th className="px-3 py-2 text-right">Reinicios</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pods.map((p, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs text-gray-900 max-w-[180px] truncate" title={p.name}>{p.name}</td>
                  <td className="px-3 py-2 text-xs"><span className="font-mono bg-gray-100 px-1 rounded text-gray-700">{p.namespace}</span></td>
                  <td className="px-3 py-2"><PodStatusBadge status={p.status}/></td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-600 max-w-[200px] truncate" title={(p.images||[]).join(', ')}>{(p.images||[]).join(', ')}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 font-mono">{p.node || '—'}</td>
                  <td className={`px-3 py-2 text-right text-xs font-bold ${(p.restarts||0) > 5 ? 'text-red-600' : (p.restarts||0) > 0 ? 'text-amber-600' : 'text-gray-500'}`}>{p.restarts ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {/* Deployments */}
      {tab === 'deploys' && (
        deployments.length === 0 ? <Empty message="Sin deployments registrados"/> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Namespace</th>
                <th className="px-3 py-2 text-left">Réplicas</th>
                <th className="px-3 py-2 text-left">Imagen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deployments.map((d, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-semibold text-gray-900 text-sm">{d.name}</td>
                  <td className="px-3 py-2 text-xs"><span className="font-mono bg-gray-100 px-1 rounded text-gray-700">{d.namespace}</span></td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-bold ${d.ready < d.replicas ? 'text-red-600' : 'text-green-700'}`}>
                      {d.ready}/{d.replicas}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-600">{d.image || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {/* Helm */}
      {tab === 'helm' && (
        helmReleases.length === 0 ? <Empty message="Sin releases Helm registrados"/> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                <th className="px-3 py-2 text-left">Release</th>
                <th className="px-3 py-2 text-left">Namespace</th>
                <th className="px-3 py-2 text-left">Chart</th>
                <th className="px-3 py-2 text-left">Versión chart</th>
                <th className="px-3 py-2 text-left">App version</th>
                <th className="px-3 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {helmReleases.map((h, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-semibold text-gray-900">{h.name}</td>
                  <td className="px-3 py-2 text-xs"><span className="font-mono bg-gray-100 px-1 rounded text-gray-700">{h.namespace}</span></td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-700">{h.chart}</td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-600">{h.chart_version || '—'}</td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-600">{h.app_version || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${h.status === 'deployed' ? 'bg-green-100 text-green-700 border-green-300' : h.status === 'failed' ? 'bg-red-100 text-red-700 border-red-300' : 'bg-amber-100 text-amber-700 border-amber-300'}`}>
                      {h.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {/* Info general */}
      {tab === 'info' && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          {[
            ['Proveedor',           cluster.k8s_provider],
            ['Versión K8s',         cluster.k8s_version],
            ['Plugin de red',       cluster.k8s_network_plugin],
            ['Ingress class',       cluster.k8s_ingress_class],
            ['Container runtime',  cluster.k8s_container_runtime],
            ['Storage class',      cluster.k8s_storage_class],
            ['IPs',                (cluster.ips||[]).map(i=>i.ip||i).join(', ')],
            ['Descripción',        cluster.description],
          ].map(([label, val]) => val ? (
            <div key={label}>
              <p className="text-xs text-gray-500 font-medium">{label}</p>
              <p className="text-sm text-gray-900 mt-0.5">{val}</p>
            </div>
          ) : null)}
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-gray-100">
        <button className="btn-secondary" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}

// Página principal

export default function KubernetesPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('clusters')
  const [search, setSearch] = useState('')
  const [detailCluster, setDetailCluster] = useState(null)
  const [detailModal, setDetailModal] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)

  const { data: clustersData, isLoading: loadingClusters } = useQuery({
    queryKey: ['cmdb-kubernetes', search, page],
    queryFn: () => cmdbApi.kubernetes({ search: search || undefined, page, page_size: 50 }),
    enabled: tab === 'clusters',
  })

  const { data: containersData, isLoading: loadingContainers } = useQuery({
    queryKey: ['cmdb-containers', search, statusFilter, page],
    queryFn: () => cmdbApi.containers({ search: search || undefined, status: statusFilter || undefined, page, page_size: 50 }),
    enabled: tab === 'containers',
  })

  const clusters   = clustersData?.data   || []
  const containers = containersData?.data || []
  const totalClusters   = clustersData?.total   || 0
  const totalContainers = containersData?.total || 0

  function openCluster(c) {
    setDetailCluster(c)
    setDetailModal(true)
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Contenedores</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Clusters Kubernetes y contenedores Docker — {totalClusters} clusters · {totalContainers} contenedores
        </p>
      </div>

      {/* Tabs principales */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { id:'clusters',    label:`☸ Clusters K8s (${totalClusters})` },
          { id:'containers',  label:`📦 Contenedores Docker (${totalContainers})` },
        ].map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setPage(1); setSearch('') }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab===t.id ? 'border-b-2 border-red-600 text-red-700 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap items-end">
        <input className="input text-sm w-72" placeholder={tab==='clusters' ? 'Buscar cluster, proveedor, versión…' : 'Buscar contenedor, imagen…'}
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
        {tab === 'containers' && (
          <select className="input text-sm w-40" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Todos los estados</option>
            {['running','stopped','exited','paused'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* CLUSTERS */}
      {tab === 'clusters' && (
        loadingClusters ? <TableSkeleton rows={4} cols={7}/> : clusters.length === 0 ? <Empty message="No hay clusters Kubernetes registrados"/> : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                  <th className="px-4 py-3 text-left">Cluster</th>
                  <th className="px-4 py-3 text-left">Proveedor</th>
                  <th className="px-4 py-3 text-left">Versión K8s</th>
                  <th className="px-4 py-3 text-left">Nodos</th>
                  <th className="px-4 py-3 text-left">Pods</th>
                  <th className="px-4 py-3 text-left">Helm</th>
                  <th className="px-4 py-3 text-left">Red</th>
                  <th className="px-4 py-3 text-left">Última sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clusters.map(c => {
                  const nodes    = c.k8s_nodes || []
                  const cp       = nodes.filter(n => n.role === 'control_plane')
                  const workers  = nodes.filter(n => n.role === 'worker')
                  const notReady = nodes.filter(n => n.status !== 'Ready')
                  const pods     = c.k8s_pods || []
                  const crashing = pods.filter(p => p.status === 'CrashLoopBackOff').length
                  const helm     = c.k8s_helm_releases || []
                  return (
                    <tr key={c.id} className="hover:bg-blue-50/30 cursor-pointer transition-colors"
                      onClick={() => openCluster(c)}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{c.name}</p>
                        <p className="text-xs text-gray-500">{c.description?.slice(0,60) || '—'}</p>
                      </td>
                      <td className="px-4 py-3"><ProviderBadge provider={c.k8s_provider}/></td>
                      <td className="px-4 py-3"><K8sVersionBadge version={c.k8s_version}/></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold">
                            🎛 {cp.length} CP
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 font-semibold">
                            ⚙ {workers.length} W
                          </span>
                          {notReady.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 font-bold">
                              ✕ {notReady.length} NotReady
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold text-gray-800">{pods.length}</span>
                        {crashing > 0 && <span className="ml-1 text-xs text-red-600 font-bold">({crashing} crash)</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-sm font-medium">{helm.length}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{c.k8s_network_plugin || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {c.last_sync ? format(new Date(c.last_sync),'dd/MM HH:mm') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {totalClusters > 50 && (
              <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-700 border-t border-gray-100">
                <span>{(page-1)*50+1}–{Math.min(page*50,totalClusters)} de {totalClusters}</span>
                <div className="flex gap-2">
                  <button className="btn-secondary text-xs" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
                  <button className="btn-secondary text-xs" disabled={page*50>=totalClusters} onClick={()=>setPage(p=>p+1)}>Siguiente</button>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* CONTAINERS */}
      {tab === 'containers' && (
        loadingContainers ? <TableSkeleton rows={4} cols={7}/> : containers.length === 0 ? <Empty message="No hay contenedores Docker registrados"/> : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                  <th className="px-4 py-3 text-left">Nombre</th>
                  <th className="px-4 py-3 text-left">Imagen</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Runtime</th>
                  <th className="px-4 py-3 text-left">Host</th>
                  <th className="px-4 py-3 text-left">Puertos</th>
                  <th className="px-4 py-3 text-left">Compose</th>
                  <th className="px-4 py-3 text-left">Última sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {containers.map(c => (
                  <tr key={c.id} className="hover:bg-blue-50/30 transition-colors cursor-pointer" onClick={()=>navigate(`/assets/${c.id}`)}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.description?.slice(0,50) || ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-800">{c.container_image || '—'}</span>
                      {c.container_image_tag && <span className="ml-1 text-[10px] text-gray-500">:{c.container_image_tag}</span>}
                    </td>
                    <td className="px-4 py-3"><ContainerStatusBadge status={c.container_status}/></td>
                    <td className="px-4 py-3 text-xs text-gray-600">{c.container_runtime || '—'}</td>
                    <td className="px-4 py-3">
                      {c.host_asset_name
                        ? <button className="text-xs text-primary hover:underline font-medium" onClick={() => navigate(`/assets/${c.host_asset_id}`)}>{c.host_asset_name}</button>
                        : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(c.container_ports || []).slice(0,3).map((p, i) => (
                          <span key={i} className="text-[10px] font-mono bg-gray-100 text-gray-700 border border-gray-200 px-1 rounded">
                            {p.host_port}:{p.container_port}/{p.protocol}
                          </span>
                        ))}
                        {(c.container_ports||[]).length > 3 && <span className="text-[10px] text-gray-400">+{(c.container_ports||[]).length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {c.container_compose_project ? (
                        <span className="font-mono">{c.container_compose_project}{c.container_compose_service ? `/${c.container_compose_service}` : ''}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600" onClick={e=>e.stopPropagation()}>
                      {c.last_sync ? format(new Date(c.last_sync),'dd/MM HH:mm') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalContainers > 50 && (
              <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-700 border-t border-gray-100">
                <span>{(page-1)*50+1}–{Math.min(page*50,totalContainers)} de {totalContainers}</span>
                <div className="flex gap-2">
                  <button className="btn-secondary text-xs" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
                  <button className="btn-secondary text-xs" disabled={page*50>=totalContainers} onClick={()=>setPage(p=>p+1)}>Siguiente</button>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* Modal detalle cluster */}
      {detailModal && detailCluster && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.5)'}}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{detailCluster.name}</h2>
                <p className="text-xs text-gray-500">Cluster Kubernetes — detalle</p>
              </div>
              <button onClick={() => { setDetailModal(false); setDetailCluster(null) }}
                className="text-gray-400 hover:text-gray-700 text-xl font-bold">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <ClusterDetail cluster={detailCluster} onClose={() => { setDetailModal(false); setDetailCluster(null) }}/>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
