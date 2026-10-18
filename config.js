// ---------------------------------------------------------------------------
// Conexión con la base de datos (Supabase) del presupuesto.
//
// Los dos valores salen de Supabase → Project Settings → API Keys.
// No son secretos: la clave publishable está diseñada para ir dentro de la
// página. El control de acceso lo hacen las políticas de las tablas.
// ---------------------------------------------------------------------------

window.CONFIG = {
  // Ej. "https://abcdefghijk.supabase.co"
  SUPABASE_URL: "https://dikuzddxwvgxufkfbity.supabase.co",

  // Ej. "sb_publishable_..."
  SUPABASE_ANON_KEY: "sb_publishable_kUIuikal_flPF2vFoIpAYg_9uXzWa-o",
};
