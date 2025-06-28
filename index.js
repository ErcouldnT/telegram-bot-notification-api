import process from "node:process";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";

dotenv.config();

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());

// see readme.md for env vars
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ERKUT_API_KEY = process.env.ERKUT_API_KEY;
const SECRET_TOKEN = process.env.SECRET_TOKEN;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "webhook";

// choose GPT endpoint based on environment
const GPT_BASE_URL
  = process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://gpt.erkut.dev";

// stores chatId ➜ threadId pairs across requests
const chatThreads = new Map();
// stores threadId ➜ promise chain for sequential processing
const threadQueues = new Map();
// queue for active chats in webhook
const activeChats = new Set();

// notify function
async function sendNotification(chatId, text) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
    });
    return { ok: true };
  }
  catch (e) {
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
  if (!text)
    return res.status(400).json({ error: "text not found" });

  const result = await sendNotification(CHAT_ID, text);
  res.json(result);
});

// telegram webhook
app.post(`/${WEBHOOK_PATH}`, async (req, res) => {
  const sig = req.header("X-Telegram-Bot-Api-Secret-Token");
  if (sig !== SECRET_TOKEN)
    return res.sendStatus(403);
  res.sendStatus(200); // respond to telegram that we received the update

  // then your webhook logic...
  const update = req.body;
  if (update.message?.text) {
    const chatId = update.message.chat.id;
    const text = update.message.text;

    // add chatId to active chats if not already present
    activeChats.add(chatId);

    let queueMsg = `There are currently ${activeChats.size} people using this app at the moment.`;
    if (activeChats.size > 5) {
      queueMsg += " Since there are more than 5 users, my response may be slightly delayed.";
    }
    await sendNotification(chatId, queueMsg);

    // retrieve existing threadId for this chat if we have one
    const threadId = chatThreads.get(chatId);

    // function to handle the actual processing logic
    const processRequest = async () => {
      try {
        const payload = {
          prompt: text,
          options: {
            reason: false,
            search: false,
          },
        };
        // if this chat has a previous thread, include it
        if (threadId) {
          payload.options.threadId = threadId;
        }
        const apiRes = await axios.post(`${GPT_BASE_URL}/api/prompt`, payload, {
          headers: { "ERKUT-API-KEY": ERKUT_API_KEY },
        });
        // cache the latest threadId for this chat
        chatThreads.set(chatId, apiRes.data.threadId);
        await sendNotification(chatId, apiRes.data.response);
      }
      catch (error) {
        console.warn("Webhook processRequest error:", error);
      }
    };

    // If threadId exists, queue the request for that thread
    if (threadId) {
      const prev = threadQueues.get(threadId) || Promise.resolve();
      const next = prev.then(() => processRequest()).finally(() => {
        // Remove the queue if this was the last job
        if (threadQueues.get(threadId) === next) {
          threadQueues.delete(threadId);
          activeChats.delete(chatId);
        }
      });
      threadQueues.set(threadId, next);
    }
    else {
      // No threadId, just process immediately
      processRequest();
    }
  }
});

app.get("/", (req, res) => {
  res.send("<html><body><h1>Server is up and running...</h1></body></html>");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.warn(`🚀 Notify + Webhook server is online!`);
  console.warn(`🌐 Listening on: http://localhost:${PORT}/`);
});
