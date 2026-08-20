// AGUATERO - Webhook de Mercado Pago para suscripciones.
// La firma se valida con MP_WEBHOOK_SECRET antes de tocar Supabase.
const crypto = require('crypto');

function parseSignature(value) {
  const out = {};
  String(value || '').split(',').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function validSignature(req, id) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;
  const xSignature = req.headers['x-signature'] || req.headers['X-Signature'];
  const xRequestId = req.headers['x-request-id'] || req.headers['X-Request-Id'] || '';
  const sig = parseSignature(xSignature);
  if (!sig.ts || !sig.v1 || !id) return false;
  const manifest = `id:${id};request-id:${xRequestId};ts:${sig.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(sig.v1), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const token = process.env.MP_ACCESS_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !supabaseUrl || !serviceKey || !process.env.MP_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook sin configurar' });
  }

  try {
    const body = req.body || {};
    const id = String((body.data && body.data.id) || req.query.id || '');
    if (!id) return res.status(200).json({ received: true });
    if (req.method === 'POST' && !validSignature(req, id)) return res.status(401).json({ error: 'Firma inválida' });

    const mp = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const subscription = await mp.json();
    if (!mp.ok) return res.status(200).json({ received: true });

    const external = String(subscription.external_reference || '');
    const parts = external.split(':');
    const userId = parts[1];
    const plan = parts[2];
    if (!userId || !plan) return res.status(200).json({ received: true });

    const currentEnd = subscription.next_payment_date || subscription.auto_recurring?.end_date || null;
    await fetch(`${supabaseUrl}/rest/v1/subscriptions?mp_preapproval_id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        user_id: userId,
        plan,
        status: subscription.status || 'pending',
        mp_preapproval_id: String(subscription.id || id),
        payer_email: subscription.payer_email || null,
        current_period_end: currentEnd,
        last_mp_event: body.type || body.topic || 'subscription_update'
      })
    });

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('mercadoPagoWebhook:', e);
    return res.status(200).json({ received: true });
  }
};
