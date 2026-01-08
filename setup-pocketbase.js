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

        // Check if 'messages' collection exists
        try {
            await pb.collections.getFirstListItem("name='messages'");
            console.log("ℹ️ 'messages' collection already exists");
        }
        catch {
            console.log("Creating 'messages' collection...");
            await pb.collections.create({
                name: "messages",
                type: "base",
                schema: [
                    {
                        name: "chat_id",
                        type: "text",
                        required: true,
                        presentable: false,
                        unique: false,
                        options: {
                            min: null,
                            max: null,
                            pattern: "",
                        },
                    },
                    {
                        name: "role",
                        type: "select",
                        required: true,
                        presentable: false,
                        unique: false,
                        options: {
                            maxSelect: 1,
                            values: ["user", "assistant"],
                        },
                    },
                    {
                        name: "content",
                        type: "text",
                        required: true,
                        presentable: false,
                        unique: false,
                        options: {
                            min: null,
                            max: null,
                            pattern: "",
                        },
                    },
                    {
                        name: "thread_id",
                        type: "text",
                        required: false,
                        presentable: false,
                        unique: false,
                        options: {
                            min: null,
                            max: null,
                            pattern: "",
                        },
                    },
                ],
            });
            console.log("✅ 'messages' collection created created");
        }
    }
    catch (error) {
        console.error("❌ Error setting up PocketBase:", error.originalError || error.message);
        // process.exit(1); // Don't fail hard if PB is not ready yet, might be starting up
    }
}

setupPocketBase();
