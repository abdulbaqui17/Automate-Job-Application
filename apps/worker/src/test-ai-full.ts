import "./env";
import { scoreJobMatch, generateCoverLetter, isAIEnabled } from "./ai";

console.log("🤖 AI Enabled:", isAIEnabled() ? "✅ Yes" : "❌ No");

// Test job scoring
console.log("\n📊 Testing Job Scoring...\n");

const jobDescription = `
Senior Full Stack Developer
We are looking for a Senior Full Stack Developer with experience in:
- React, TypeScript, Node.js
- PostgreSQL, Redis
- AWS or cloud infrastructure
- 5+ years experience
`;

const userSkills = ["React", "TypeScript", "Node.js", "PostgreSQL", "AWS", "Docker"];
const userExperience = "6 years as Full Stack Developer at tech startups";

try {
  const result = await scoreJobMatch(jobDescription, userSkills, userExperience);
  console.log("✅ Job Match Score:", Math.round(result.score * 100) + "%");
  console.log("📝 Reasoning:", result.reasoning);
} catch (err: any) {
  console.error("❌ Scoring failed:", err.message);
}

// Test cover letter generation
console.log("\n✉️ Testing Cover Letter Generation...\n");

try {
  const coverLetter = await generateCoverLetter(
    "Abdul",
    "6 years Full Stack development with React, Node.js, TypeScript",
    "Senior Full Stack Developer",
    "TechCorp",
    jobDescription
  );
  console.log("✅ Generated Cover Letter:\n");
  console.log(coverLetter.slice(0, 500) + "...");
} catch (err: any) {
  console.error("❌ Cover letter failed:", err.message);
}

console.log("\n🎉 All AI tests complete!");
