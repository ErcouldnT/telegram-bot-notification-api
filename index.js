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
// stores threadId ➜ queue length
const threadQueueLengths = new Map();
// queue for active chats in webhook
const activeChats = new Set();

// notify function
async function sendNotification(chatId, text) {
  try {
    const res = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
    return { ok: true, data: res.data.result };
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

    if (activeChats.size >= 3) {
      const queueMsg = `There are currently ${activeChats.size} people using this app at the moment. Since there are more users, my response may be slightly delayed. Be patient, I will respond as soon as possible 🙂`;
      await sendNotification(chatId, queueMsg);
    }

    // retrieve existing threadId for this chat if we have one
    const threadId = chatThreads.get(chatId);

    // function to handle the actual processing logic
    const processRequest = async () => {
      try {
        const progressMessageRes = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: "In process... 🧑🏻‍💻",
        });
        const progressMessageId = progressMessageRes.data.result.message_id;

        const payload = {
          systemPrompt: "Respond in plain text only — no formatting, no tables, no images, no formulas, no links, no markdown. Use only HTML tags supported by Telegram (e.g., <b>, <i>, <code>, <pre>) if formatting is necessary. Exclude all sources and citations from the response. If the user asks for the weather, respond with only the temperature in degrees. If you provide code, always wrap it in <pre> tags. If you want a piece of text to be easily copyable in one tap, wrap it in <code> tags.",
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

        const telegramMaxLength = 4096;
        const fullResponse = apiRes.data.response;

        if (!fullResponse || fullResponse.length === 0) {
          await sendNotification(chatId, "No response received from the AI. Please contact @ercouldnt for support.");
        }

        console.warn(fullResponse.slice(0, 100));

        for (let i = 0; i < fullResponse.length; i += telegramMaxLength) {
          const chunk = fullResponse.slice(i, i + telegramMaxLength);
          await sendNotification(chatId, chunk);
        }

        // delete the progress message
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
          chat_id: chatId,
          message_id: progressMessageId,
        });
      }
      catch (error) {
        console.warn("Webhook processRequest error:", error);
      }
    };

    // if threadId exists, queue the request for that thread
    if (threadId) {
      // max queue length is 3 for each thread
      const queueLength = threadQueueLengths.get(threadId) || 0;
      if (queueLength >= 3) {
        await sendNotification(chatId, "There are too many requests from you. Please wait for previous operations to complete before sending new messages 👹");
        return;
      }

      const prev = threadQueues.get(threadId) || Promise.resolve();
      threadQueueLengths.set(threadId, queueLength + 1);
      const next = prev.then(() => processRequest()).finally(() => {
        // when the job is done, remove it from the queue
        const currentLength = threadQueueLengths.get(threadId) || 1;
        if (currentLength <= 1) {
          threadQueueLengths.delete(threadId);
        }
        else {
          threadQueueLengths.set(threadId, currentLength - 1);
        }
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
