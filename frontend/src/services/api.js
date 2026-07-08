import { session } from '../auth/session'

const BASE = '/v1'

function authHeader() {
  const t = session.getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const raw = err.detail
    let msg
    if (!raw) {
      msg = `HTTP ${res.status}`
    } else if (typeof raw === 'string') {
      msg = raw
    } else if (Array.isArray(raw)) {
      msg = raw.map(e => `${e.loc?.slice(-1)[0] || 'field'}: ${e.msg}`).join(', ')
    } else {
      msg = JSON.stringify(raw)
    }
    throw Object.assign(new Error(msg), { status: res.status, data: err })
  }
  if (res.status === 204) return null
  return res.json()
}

function buildQS(params) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === '' || v === null) return
    if (Array.isArray(v)) {
      if (v.length > 0) qs.set(k, v.join(','))
    } else {
      qs.set(k, v)
    }
  })
  return qs.toString()
}

export const assetsApi = {
  list: (p = {}) => req(`/assets?${buildQS(p)}`),
  get: (id) => req(`/assets/${id}`),
  ingest: (items) => req('/assets/ingest', { method: 'POST', body: JSON.stringify(items) }),
  bulkUntag: (assetIds, tagIds) => req('/assets/bulk-untag', { method:'POST', body:JSON.stringify({ asset_ids:assetIds, tag_ids:tagIds }) }),
  bulkTags: (asset_ids, tag_ids) => req('/assets/bulk-tags', { method: 'POST', body: JSON.stringify({ asset_ids, tag_ids }) }),
  delete: (id) => req(`/assets/${id}`, { method: 'DELETE' }),
  snapshots: () => req('/assets/history/snapshots'),
}

export const cmdbApi = {
  servers:    (p = {}) => req(`/cmdb/servers?${buildQS(p)}`),
  network:    (p = {}) => req(`/cmdb/network?${buildQS(p)}`),
  databases:  (p = {}) => req(`/cmdb/databases?${buildQS(p)}`),
  webServers: (p = {}) => req(`/cmdb/web-servers?${buildQS(p)}`),
  storage:    (p = {}) => req(`/cmdb/storage?${buildQS(p)}`),
  kubernetes: (p = {}) => req(`/cmdb/kubernetes?${buildQS(p)}`),
  containers: (p = {}) => req(`/cmdb/containers?${buildQS(p)}`),
  relations:  (id)     => req(`/cmdb/asset-relations/${id}`),
  updateNotes: (id, notes) => req(`/v1/assets/${id}/notes`, { method: 'PATCH', body: JSON.stringify({ notes }) }),
}

export const tagsApi = {
  list: (origin) => req(`/tags${origin ? `?origin=${origin}` : ''}`),
  create: (d) => req('/tags', { method: 'POST', body: JSON.stringify(d) }),
  update: (id, d) => req(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  delete: (id) => req(`/tags/${id}`, { method: 'DELETE' }),
}

export const auditApi = {
  list: (p = {}) => req(`/audit-logs?${buildQS(p)}`),
  get: (id) => req(`/audit-logs/${id}`),
}

export const authApi = {
  oidcConfig: () => req('/auth/oidc/config'),
  me: () => req('/auth/me'),
  uploadAvatar: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/auth/me/avatar`, {
      method: 'PATCH',
      body: fd,
      headers: authHeader(),
    }).then(r => r.json())
  },
  avatarUrl: () => `${BASE}/auth/me/avatar`,
}

export const dataSourcesApi = {
  list: () => req('/data-sources'),
  get: (id) => req(`/data-sources/${id}`),
  create: (d) => req('/data-sources', { method: 'POST', body: JSON.stringify(d) }),
  update: (id, d) => req(`/data-sources/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  delete: (id) => req(`/data-sources/${id}`, { method: 'DELETE' }),
  validate: (id) => req(`/data-sources/${id}/validate`, { method: 'POST' }),
  getPending: (id) => req(`/data-sources/${id}/pending`),
  dismissPending: (sid, assetId) => req(`/data-sources/${sid}/pending/${assetId}/dismiss`, { method: 'POST' }),
  getDiffs: (id) => req(`/data-sources/${id}/diffs`),
  getRuns: (id) => req(`/data-sources/${id}/runs`),
  getRunDetail: (sid, runId) => req(`/data-sources/${sid}/runs/${runId}`),
}

export const exceptionsApi = {
  list: (p = {}) => req(`/exceptions?${buildQS(p)}`),
  get: (id) => req(`/exceptions/${id}`),
  create: (d) => req('/exceptions', { method: 'POST', body: JSON.stringify(d) }),
  revoke: (id) => req(`/exceptions/${id}`, { method: 'DELETE' }),
  reasonCodes: () => req('/exceptions/reason-codes/list'),
}

export const applicationsApi = {
  list: (p = {}) => req(`/applications?${buildQS(p)}`),
  get: (id) => req(`/applications/${id}`),
  create: (d) => req('/applications', { method: 'POST', body: JSON.stringify(d) }),
  update: (id, d) => req(`/applications/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  delete: (id) => req(`/applications/${id}`, { method: 'DELETE' }),
  addBinding: (id, d) => req(`/applications/${id}/infra-bindings`, { method: 'POST', body: JSON.stringify(d) }),
  removeBinding: (id, bid) => req(`/applications/${id}/infra-bindings/${bid}`, { method: 'DELETE' }),
  addDep: (id, d) => req(`/applications/${id}/dependencies`, { method: 'POST', body: JSON.stringify(d) }),
  removeDep: (id, did) => req(`/applications/${id}/dependencies/${did}`, { method: 'DELETE' }),
}

export const servicesApi = {
  list: (p = {}) => req(`/services?${buildQS(p)}`),
  get: (id) => req(`/services/${id}`),
  create: (d) => req('/services', { method: 'POST', body: JSON.stringify(d) }),
  update: (id, d) => req(`/services/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  delete: (id) => req(`/services/${id}`, { method: 'DELETE' }),
  addEndpoint: (id, d) => req(`/services/${id}/endpoints`, { method: 'POST', body: JSON.stringify(d) }),
  removeEndpoint: (id, eid) => req(`/services/${id}/endpoints/${eid}`, { method: 'DELETE' }),
  addComponent: (id, d) => req(`/services/${id}/components`, { method: 'POST', body: JSON.stringify(d) }),
  removeComponent: (id, cid) => req(`/services/${id}/components/${cid}`, { method: 'DELETE' }),
  graph: (id) => req(`/services/${id}/dependency-graph`),
  globalGraph: () => req('/dependency-graph'),
}

export const certificatesApi = {
  list: (p = {}) => req(`/certificates?${buildQS(p)}`),
  get: (id) => req(`/certificates/${id}`),
  create: (d) => req('/certificates', { method: 'POST', body: JSON.stringify(d) }),
  update: (id, d) => req(`/certificates/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  delete: (id) => req(`/certificates/${id}`, { method: 'DELETE' }),
  summary: () => req('/certificates/expiry-summary'),
}

export const infraBindingsApi = {
  list: (appId) => req(`/applications/${appId}/infra-bindings`),
  add: (appId, d) => req(`/applications/${appId}/infra-bindings`, { method: 'POST', body: JSON.stringify(d) }),
  remove: (appId, bindingId) => req(`/applications/${appId}/infra-bindings/${bindingId}`, { method: 'DELETE' }),
}

export const locationsApi = {
  tree: () => req('/locations/tree'),

  listZones:  ()       => req('/zones'),
  createZone: (d)      => req('/zones', { method:'POST', body:JSON.stringify(d) }),
  updateZone: (id, d)  => req(`/zones/${id}`, { method:'PUT', body:JSON.stringify(d) }),
  deleteZone: (id)     => req(`/zones/${id}`, { method:'DELETE' }),

  listSites:  (zone_id) => req(`/sites${zone_id?'?zone_id='+zone_id:''}`),
  createSite: (d)       => req('/sites', { method:'POST', body:JSON.stringify(d) }),
  updateSite: (id, d)   => req(`/sites/${id}`, { method:'PUT', body:JSON.stringify(d) }),
  deleteSite: (id)      => req(`/sites/${id}`, { method:'DELETE' }),

  listCells:  (site_id) => req(`/cells${site_id?'?site_id='+site_id:''}`),
  createCell: (d)       => req('/cells', { method:'POST', body:JSON.stringify(d) }),
  updateCell: (id, d)   => req(`/cells/${id}`, { method:'PUT', body:JSON.stringify(d) }),
  deleteCell: (id)      => req(`/cells/${id}`, { method:'DELETE' }),
  cellAssets: (id)      => req(`/cells/${id}/assets`),

  bulkAssign: (cell_id, asset_ids) => req('/cells/bulk-assign', {
    method:'POST', body:JSON.stringify({ cell_id, asset_ids })
  }),
}

export const eolApi = {
  listProducts: ()            => req('/eol/products'),
  addProduct:   (id, data)    => req(`/eol/products/${id}`, { method:'POST', body:JSON.stringify(data||{}) }),
  updateProduct:(id, data)    => req(`/eol/products/${id}`, { method:'PUT', body:JSON.stringify(data) }),
  deleteProduct:(id)          => req(`/eol/products/${id}`, { method:'DELETE' }),
  syncProduct:  (id)          => req(`/eol/products/${id}/sync`, { method:'POST' }),
  syncAll:      ()            => req('/eol/sync-all', { method:'POST' }),
  allProducts:  ()            => req('/eol/all-products'),
  listCycles:   (id)          => req(`/eol/products/${id}/cycles`),
  updateCycle:  (pid, cid, d) => req(`/eol/products/${pid}/cycles/${cid}`, { method:'PUT', body:JSON.stringify(d) }),
  assetStatus:        ()            => req('/eol/asset-status'),
  recalculateTags:    ()            => req('/eol/recalculate-tags', { method:'POST' }),
  productAssets:      (id, status)  => req(`/eol/products/${id}/assets${status?'?status='+status:''}`),
  productAssetsUnknown: (productId) => req(`/eol/products/${productId}/assets/unknown`),
  detectedProducts:   ()            => req('/eol/detected-products'),
  autoSync:           ()            => req('/eol/auto-sync', { method: 'POST' }),
  addCustomCycle:     (id, d)       => req(`/eol/products/${id}/custom-cycle`, { method:'POST', body:JSON.stringify(d) }),
}

export const dashboardApi = {
  get: () => req('/dashboard'),
}

export const systemApi = {
  version: () => req('/version'),
}
