import process from "node:process";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import { createClient } from "redis";
import PocketBase from "pocketbase";

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
const REDIS_URL = process.env.REDIS_URL;

// GPT API endpoint
const GPT_BASE_URL = process.env.GPT_BASE_URL;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;
const POCKETBASE_URL = process.env.POCKETBASE_URL;
const POCKETBASE_EMAIL = process.env.POCKETBASE_EMAIL;
const POCKETBASE_PASSWORD = process.env.POCKETBASE_PASSWORD;

const DEFAULT_SYSTEM_PROMPT_SUFFIX = "Give flirty answers only.";

// redis client setup
const redis = createClient({ url: REDIS_URL });
redis.on("error", err => console.error("Redis Client Error", err));
await redis.connect();

// PB client setup
const pb = new PocketBase(POCKETBASE_URL);
// disable auto cancellation to allow concurrent requests
pb.autoCancellation(false);

// authenticate PB as admin (needed to write to 'messages' collection)
// in a real app you might use a specific bot user, but admin is fine for this
try {
  await pb.admins.authWithPassword(POCKETBASE_EMAIL, POCKETBASE_PASSWORD);
  console.log("✅ PocketBase admin authenticated");
}
catch (e) {
  console.warn("⚠️ PocketBase auth failed:", e.message);
}

// stores threadId ➜ promise chain for sequential processing (remains in-memory)
const threadQueues = new Map();

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
    const from = update.message.from;

    // Sync user data to PocketBase
    if (from) {
      try {
        const userData = {
          chat_id: String(chatId),
          username: from.username || "",
          first_name: from.first_name || "",
          last_name: from.last_name || "",
          language_code: from.language_code || "",
        };

        // Try to find existing user first
        try {
          const record = await pb.collection("telegram_users").getFirstListItem(`chat_id="${String(chatId)}"`);
          // Update specific fields (preserve system_prompt if exists)
          await pb.collection("telegram_users").update(record.id, userData);
        } catch {
          // Create if not exists
          await pb.collection("telegram_users").create({
            ...userData,
            system_prompt: DEFAULT_SYSTEM_PROMPT_SUFFIX
          });
        }
      } catch (err) {
        console.warn("⚠️ Failed to sync user data:", err.message);
      }
    }

    // handle commands
    if (text.startsWith("/")) {
      const command = text.split(" ")[0];

      if (command === "/start") {
        await sendNotification(chatId, "Hello! I am ready to help you. Just send me a message. 🤖");
        return;
      }

      if (command === "/help") {
        const helpText = `
<b>Available Commands:</b>
/start - Start conversation
/clear - Clear conversation history context
/system - View/Set system prompt
/system reset - Reset system prompt
/help - Show this help message
        `;
        await sendNotification(chatId, helpText);
        return;
      }

      if (command === "/clear") {
        await redis.hDel("chat_threads", String(chatId));
        await sendNotification(chatId, "Conversation context cleared. Starting fresh! 🧹");
        return;
      }


      if (command.startsWith("/system")) {
        const args = text.slice(7).trim(); // remove "/system"
        const userId = String(chatId);

        if (!args) {
          // View current prompt
          try {
            const record = await pb.collection("telegram_users").getFirstListItem(`chat_id="${userId}"`);
            const currentParams = record.system_prompt || DEFAULT_SYSTEM_PROMPT_SUFFIX + " (Default)";
            await sendNotification(chatId, `Currently using:\n<b>${currentParams}</b>`);
          } catch (e) {
            await sendNotification(chatId, `Currently using: <b>${DEFAULT_SYSTEM_PROMPT_SUFFIX} (Default)</b>`);
          }
          return;
        }

        if (args === "reset") {
          try {
            // find and update or delete
            const record = await pb.collection("telegram_users").getFirstListItem(`chat_id="${userId}"`);
            await pb.collection("telegram_users").update(record.id, { system_prompt: DEFAULT_SYSTEM_PROMPT_SUFFIX });
            await sendNotification(chatId, `✅ System prompt reset to default (${DEFAULT_SYSTEM_PROMPT_SUFFIX}).`);
          } catch (e) {
            // if not found, it's already default
            await sendNotification(chatId, `✅ System prompt is already default.`);
          }
          return;
        }

        // Set custom prompt
        try {
          try {
            const record = await pb.collection("telegram_users").getFirstListItem(`chat_id="${userId}"`);
            await pb.collection("telegram_users").update(record.id, { system_prompt: args });
          } catch {
            await pb.collection("telegram_users").create({ chat_id: userId, system_prompt: args });
          }
          await sendNotification(chatId, `✅ Custom prompt set to:\n"<b>${args}</b>"`);
        } catch (e) {
          console.error(e);
          await sendNotification(chatId, "❌ Failed to set custom prompt.");
        }
        return;
      }

      if (command === "/history") {
        try {
          const records = await pb.collection("messages").getList(1, 10, {
            filter: `chat_id = "${chatId}"`,
            sort: "-created",
          });

          if (records.items.length === 0) {
            await sendNotification(chatId, "No history found.");
            return;
          }

          let historyMsg = "<b>Last 10 messages:</b>\n\n";
          // reverse to show chronological order
          const reversed = records.items.reverse();

          for (const msg of reversed) {
            const roleIcon = msg.role === "user" ? "👤" : "🤖";
            // truncate long messages
            const content = msg.content.length > 50 ? msg.content.substring(0, 50) + "..." : msg.content;
            historyMsg += `${roleIcon} <b>${msg.role}:</b> ${content}\n`;
          }
          await sendNotification(chatId, historyMsg);
        }
        catch (e) {
          console.error("History error:", e);
          await sendNotification(chatId, "Failed to fetch history.");
        }
        return;
      }
    }

    // retrieve existing threadId for this chat if we have one
    const threadId = await redis.hGet("chat_threads", String(chatId));

    // store user message to PB
    let userMsgRecordId = null;
    try {
      const record = await pb.collection("messages").create({
        chat_id: String(chatId),
        role: "user",
        content: text,
        thread_id: threadId || "",
      });
      userMsgRecordId = record.id;
    }
    catch (e) {
    }

    // add chatId to active chats if not already present
    await redis.sAdd("active_chats", String(chatId));
    const activeChatsCount = await redis.sCard("active_chats");

    if (activeChatsCount >= 3) {
      const queueMsg = `There are currently ${activeChatsCount} people using this app at the moment. Since there are more users, my response may be slightly delayed. Be patient, I will respond as soon as possible 🙂`;
      await sendNotification(chatId, queueMsg);
    }

    // function to handle the actual processing logic
    const processRequest = async () => {
      try {
        const progressMessageRes = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: "In process... 🧑🏻‍💻",
        });
        const progressMessageId = progressMessageRes.data.result.message_id;

        // Fetch custom system prompt
        let systemPromptPart = DEFAULT_SYSTEM_PROMPT_SUFFIX;
        try {
          const userSettings = await pb.collection("telegram_users").getFirstListItem(`chat_id="${String(chatId)}"`);
          if (userSettings.system_prompt) {
            systemPromptPart = userSettings.system_prompt;
          }
        } catch (e) { /* use default */ }

        const finalSystemPrompt = `${SYSTEM_PROMPT} ${systemPromptPart}`;

        const payload = {
          systemPrompt: finalSystemPrompt,
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
        await redis.hSet("chat_threads", String(chatId), apiRes.data.threadId);

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

        // store AI response to PB
        try {
          const newThreadId = apiRes.data.threadId;

          await pb.collection("messages").create({
            chat_id: String(chatId),
            role: "assistant",
            content: fullResponse,
            thread_id: threadId || newThreadId,
          });

          // if we didn't have a threadId before (it was the first message), update the user message
          if (!threadId && userMsgRecordId) {
            try {
              await pb.collection("messages").update(userMsgRecordId, {
                thread_id: newThreadId
              });
            } catch (updateErr) {
              console.warn("Failed to backfill thread_id for user msg:", updateErr.message);
            }
          }
        }
        catch (e) {
          console.warn("PB assistant msg save error:", e.message);
        }
      }
      catch (error) {
        console.warn("Webhook processRequest error:", error);
      }
    };

    // if threadId exists, queue the request for that thread
    if (threadId) {
      // max queue length is 3 for each thread
      const queueLength = Number(await redis.hGet("thread_queue_lengths", threadId)) || 0;
      if (queueLength >= 3) {
        await sendNotification(chatId, "There are too many requests from you. Please wait for previous operations to complete before sending new messages 👹");
        return;
      }

      const prev = threadQueues.get(threadId) || Promise.resolve();
      await redis.hSet("thread_queue_lengths", threadId, queueLength + 1);

      const next = prev.then(() => processRequest()).finally(async () => {
        // when the job is done, remove it from the queue
        const currentLength = Number(await redis.hGet("thread_queue_lengths", threadId)) || 1;
        if (currentLength <= 1) {
          await redis.hDel("thread_queue_lengths", threadId);
        }
        else {
          await redis.hSet("thread_queue_lengths", threadId, currentLength - 1);
        }
        // Remove the queue if this was the last job
        if (threadQueues.get(threadId) === next) {
          threadQueues.delete(threadId);
          await redis.sRem("active_chats", String(chatId));
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

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.warn(`🚀 Notify + Webhook server is online!`);
  console.warn(`🌐 Listening on: http://localhost:${PORT}/`);
});
