# Telegram Bot Notification API 🚀

A simple Node.js + Express service to:

1. **Send notifications** to a Telegram chat using a `/notify` endpoint.
2. **Optionally receive and respond** to incoming messages via Telegram webhook.

---

## 📋 Table of Contents

- [Features](#features)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [Usage](#usage)
  - [1. Notification Mode](#1-notification-mode)
  - [2. Webhook Mode (Optional)](#2-webhook-mode-optional)
- [API Reference](#api-reference)
- [Security](#security)
- [License](#license)

---

## 🧩 Features

- `/notify`: Send a simple text message to your specified Telegram chat.
- `/webhook`: (Optional) Listen and respond to messages sent to your bot.
- Secure `/notify` with an `ERKUT_API_KEY` header.
- Validate webhook requests using Telegram's `X-Telegram-Bot-Api-Secret-Token`.

---

## 🔐 Environment Variables

Make a `.env` file in your project root and define:

```bash
BOT_TOKEN=<your-telegram-bot-token>
CHAT_ID=<target-telegram-chat-id>
ERKUT_API_KEY=<your-secret-api-key-for-notify>
SECRET_TOKEN=<very_secret_token_for_webhook_validation>
WEBHOOK_PATH=<optional: custom webhook path, default "webhook">
PORT=<optional: server port, default 3000>
```

- `BOT_TOKEN`: Telegram bot token (from **@BotFather**).
- `CHAT_ID`: Numeric ID to send notifications to.
- `ERKUT_API_KEY`: Custom key required in `ERKUT_API_KEY` header for `/notify`.
- `SECRET_TOKEN`: Must match Telegram webhook’s `secret_token`.
- `WEBHOOK_PATH`: Defines URL path for webhook (e.g. `/webhook` or `/webhook-42`).
- `PORT`: HTTP server port.

---

## ⚙️ Installation

```bash
git clone https://github.com/ErcouldnT/telegram-bot-notification-api.git
cd telegram-bot-notification-api
npm install
cp .env.example .env
# Edit .env values as needed
npm start
```

---

## 🚀 Usage

### 1. Notification Mode

Send a message via:

```bash
curl -X POST http://localhost:3000/notify \
  -H "Content-Type: application/json" \
  -H "ERKUT_API_KEY: $ERKUT_API_KEY" \
  -d '{"text": "Server is 90% full!"}'
```

- Requires correct `ERKUT_API_KEY`; otherwise returns `401 Unauthorized`.
- Missing `"text"` returns `400 Bad Request`.

---

### 2. Webhook Mode (Optional)

**Register webhook** in Telegram:

```bash
curl -X POST https://api.telegram.org/bot$BOT_TOKEN/setWebhook \
  -d "url=https://your.domain.com/${WEBHOOK_PATH}" \
  -d "secret_token=${SECRET_TOKEN}"
```

Now, Telegram sends each incoming message to your server:

- Validates `X-Telegram-Bot-Api-Secret-Token` header.
- Always returns `200 OK` to acknowledge receipt.
- Then echoes incoming message back to the same chat.

---

## 🛡 API Reference

| Endpoint         | Method | Headers                                     | Body                 | Description                                 |
| ---------------- | ------ | ------------------------------------------- | -------------------- | ------------------------------------------- |
| `/notify`        | POST   | `ERKUT_API_KEY: <key>`                      | `{ "text": "…" }`    | Sends a notification to your Telegram chat. |
| `/:WEBHOOK_PATH` | POST   | `X-Telegram-Bot-Api-Secret-Token: <secret>` | Telegram update JSON | Handles incoming Telegram updates securely. |

---

## 🔧 Security

- **/notify** protected with `ERKUT_API_KEY` — rejects unauthorized requests with `401`.
- **/webhook** validated using Telegram’s `X-Telegram-Bot-Api-Secret-Token`.
- Be sure to use **HTTPS** in production.
- Optionally, enforce IP whitelisting (Telegram IP blocks) and rate limiting.

---

## 📝 License

This project is open-source under the [MIT License](LICENSE).
