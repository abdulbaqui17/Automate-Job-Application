import "./env";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

console.log("🔑 API Key:", apiKey ? `✅ Found (${apiKey.slice(0, 10)}...)` : "❌ Missing");

if (!apiKey) {
  console.error("Please set GEMINI_API_KEY in your .env file");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

console.log("🤖 Listing available models...\n");

try {
  // List models first
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  const data = await response.json();
  
  if (data.models) {
    console.log("Available models:");
    for (const model of data.models.slice(0, 10)) {
      console.log(`  - ${model.name} (${model.displayName})`);
    }
  }
  
  // Try gemini-2.5-flash
  console.log("\n🤖 Testing gemini-2.5-flash...\n");
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent("Say hello");
  console.log("✅ Response:", result.response.text());
  console.log("\n🎉 API is working!");
} catch (err: any) {
  console.error("❌ Error:", err.message);
}
