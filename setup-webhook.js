import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const SECRET_TOKEN = process.env.SECRET_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "webhook";

async function registerWebhook() {
    if (!BOT_TOKEN) {
        console.error("❌ BOT_TOKEN is not set");
        process.exit(1);
    }

    if (!WEBHOOK_URL) {
        console.error("❌ WEBHOOK_URL is not set (e.g., https://yourdomain.com)");
        process.exit(1);
    }

    const fullWebhookUrl = `${WEBHOOK_URL}/${WEBHOOK_PATH}`;

    console.log(`🔗 Registering webhook: ${fullWebhookUrl}`);

    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: fullWebhookUrl,
                secret_token: SECRET_TOKEN,
                allowed_updates: ["message"],
            }),
        });

        const result = await response.json();

        if (result.ok) {
            console.log("✅ Webhook registered successfully!");
            console.log(`   URL: ${fullWebhookUrl}`);
        }
        else {
            console.error("❌ Failed to register webhook:", result.description);
            process.exit(1);
        }
    }
    catch (error) {
        console.error("❌ Error registering webhook:", error.message);
        process.exit(1);
    }
}

registerWebhook();
