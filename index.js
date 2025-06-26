import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// see readme.md for env vars
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ERKUT_API_KEY = process.env.ERKUT_API_KEY;
const SECRET_TOKEN = process.env.SECRET_TOKEN;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "webhook";

// notify function
async function sendNotification(chatId, text) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
    });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// auth middleware
function verifyApiKey(req, res, next) {
  const clientKey = req.header("ERKUT-API-KEY");
  if (!clientKey || clientKey !== ERKUT_API_KEY) {
    return res.status(401).json({ error: "invalid api key" });
  }
  next();
}

// notify endpoint
app.post("/notify", verifyApiKey, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text not found" });

  const result = await sendNotification(CHAT_ID, text);
  res.json(result);
});

// telegram webhook
app.post(`/${WEBHOOK_PATH}`, async (req, res) => {
  const sig = req.header("X-Telegram-Bot-Api-Secret-Token");
  if (sig !== SECRET_TOKEN) return res.sendStatus(403);
  res.sendStatus(200); // respond to telegram that we received the update

  // then your webhook logic...
  const update = req.body;
  if (update.message?.text) {
    const chatId = update.message.chat.id;
    const text = update.message.text;

    // test it
    await sendNotification(chatId, `📩 Received: ${text}`);
    res.json(result);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Notify + Webhook server is online!`);
  console.log(`🌐 Listening on: http://localhost:${PORT}/`);
});
