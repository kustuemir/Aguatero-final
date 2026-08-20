// AGUATERO - Vercel Function
// Crea una suscripcion de Mercado Pago. Las credenciales privadas viven SOLO en Vercel.

const PLANES = {
  mensual: { nombre: 'Aguatero mensual', precio: 14999, frecuencia: 1, tipo: 'months' },
  anual: { nombre: 'Aguatero anual', precio: 159999, frecuencia: 12, tipo: 'months' }
};

async function getAuthenticatedUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;
  const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  return await r.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const token = process.env.MP_ACCESS_TOKEN;
  const appBaseUrl = process.env.APP_BASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !appBaseUrl || !supabaseUrl || !serviceKey || !process.env.SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: 'Backend de pagos sin configurar' });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user || !user.id || !user.email) return res.status(401).json({ error: 'Sesión no válida' });

    const { plan } = req.body || {};
    if (!PLANES[plan]) return res.status(400).json({ error: 'Plan inválido' });

    const cfg = PLANES[plan];
    const webhookUrl = `${appBaseUrl.replace(/\/$/, '')}/api/mercadoPagoWebhook`;
    const response = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reason: cfg.nombre,
        external_reference: `aguatero:${user.id}:${plan}`,
        payer_email: user.email,
        auto_recurring: {
          frequency: cfg.frecuencia,
          frequency_type: cfg.tipo,
          transaction_amount: cfg.precio,
          currency_id: 'ARS'
        },
        back_url: appBaseUrl,
        notification_url: webhookUrl
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Mercado Pago rechazó la solicitud' });

    if (data.id) {
      await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          user_id: user.id,
          plan,
          status: data.status || 'pending',
          mp_preapproval_id: String(data.id),
          payer_email: user.email,
          last_mp_event: 'created'
        })
      });
    }

    return res.status(200).json({ init_point: data.init_point, id: data.id, status: data.status });
  } catch (e) {
    console.error('createMercadoPagoSubscription:', e);
    return res.status(500).json({ error: 'Error interno al crear la suscripción' });
  }
};
