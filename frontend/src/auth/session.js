// Token de acceso actual. Actualizado por AuthContext en cada cambio de sesión.
let _token = null

export const session = {
  setToken: (t) => { _token = t },
  getToken: () => _token,
}
