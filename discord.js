// Небольшой помощник для уведомлений владельца сайта в Discord через
// Incoming Webhook — чтобы не заходить на сайт специально проверить,
// нет ли новых демок/челленджей/сообщений на модерации.
//
// Если DISCORD_WEBHOOK_URL не задан в переменных окружения — молча
// ничего не делаем, остальной функционал сайта не ломается.

async function notifyDiscord(message) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch (e) {
    // Ошибка отправки в Discord не должна ронять основной запрос —
    // просто логируем и продолжаем.
    console.error("Не удалось отправить уведомление в Discord:", e);
  }
}

module.exports = { notifyDiscord };
