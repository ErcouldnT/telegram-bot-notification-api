import process from "node:process";
import dotenv from "dotenv";
import PocketBase from "pocketbase";

dotenv.config();

const POCKETBASE_URL = process.env.POCKETBASE_URL || "http://localhost:8090";
const POCKETBASE_EMAIL = process.env.POCKETBASE_EMAIL;
const POCKETBASE_PASSWORD = process.env.POCKETBASE_PASSWORD;

async function setupPocketBase() {
    console.log("Connecting to PocketBase at:", POCKETBASE_URL);

    const pb = new PocketBase(POCKETBASE_URL);

    try {
        // Authenticate as admin
        await pb.admins.authWithPassword(POCKETBASE_EMAIL, POCKETBASE_PASSWORD);
        console.log("✅ Authenticated as admin");

        // --- Collections Setup ---

        // 1. Messages Collection
        try {
            const result = await pb.collections.getList(1, 1, { filter: 'name="messages"' });
            if (result.items.length > 0) {
                console.log("ℹ️ 'messages' collection already exists. Skipping creation.");
            } else {
                console.log("Creating 'messages' collection...");
                const collection = await pb.collections.create({
                    name: "messages",
                    type: "base",
                    fields: [
                        { name: "chat_id", type: "text", required: true },
                        { name: "role", type: "select", required: true, maxSelect: 1, values: ["user", "assistant"] },
                        { name: "content", type: "text", required: true },
                        { name: "thread_id", type: "text", required: false },
                        { name: "created", type: "autodate", onCreate: true },
                        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
                    ],
                });
                console.log("✅ 'messages' collection created successfully.");
                console.log("Created Fields:", JSON.stringify(collection.fields, null, 2));
            }
        } catch (err) {
            console.error("❌ Failed to setup 'messages' collection:", err.originalError || err.message);
        }

        // 2. Telegram Users Collection
        try {
            const result = await pb.collections.getList(1, 1, { filter: 'name="telegram_users"' });
            if (result.items.length > 0) {
                console.log("ℹ️ 'telegram_users' collection already exists. Skipping creation.");
            } else {
                console.log("Creating 'telegram_users' collection...");
                await pb.collections.create({
                    name: "telegram_users",
                    type: "base",
                    fields: [
                        { name: "chat_id", type: "text", required: true },
                        { name: "username", type: "text", required: false },
                        { name: "first_name", type: "text", required: false },
                        { name: "last_name", type: "text", required: false },
                        { name: "language_code", type: "text", required: false },
                        { name: "system_prompt", type: "text", required: false }
                    ],
                    // Unique constraint on chat_id would be nice, but handled by logic for now
                });
                console.log("✅ 'telegram_users' collection created successfully.");
            }
        } catch (err) {
            console.error("❌ Failed to setup 'telegram_users' collection:", err.originalError || err.message);
        }

    } catch (error) {
        console.error("❌ Error setting up PocketBase:", error.originalError || error.message);
    }
}

setupPocketBase();
