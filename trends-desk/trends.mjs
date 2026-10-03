// X trend bot: law + finance. Run: node trends.mjs   (needs XAI_API_KEY)
import { SpaceXAI } from "@xai-official/sdk";
import { xSearch } from "@xai-official/sdk/tools";
import { writeFileSync, mkdirSync } from "node:fs";

const client = new SpaceXAI();
const today = new Date();
const from = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const stamp = today.toISOString().slice(0, 10);

const topics = {
  LAW: "legal news, court rulings, Supreme Court, lawsuits, legal commentary, regulation",
  FINANCE: "markets, stocks, the Fed, interest rates, crypto, earnings, economy",
};

let report = `# X trends: law + finance (${stamp})\n\n`;

for (const [name, desc] of Object.entries(topics)) {
  process.stdout.write(`Searching ${name}...\n`);
  const r = await client.responses.create({
    model: "grok-4.7",
    tools: [xSearch({ from_date: from })],
    input: `Search X posts from the last 24 hours about ${desc}.
Find the top 5 topics getting the most engagement right now.
For each one give:
1. The topic in one line
2. Why people are talking about it (2 sentences)
3. 1-2 example post links from X
4. One reply or post idea I could write about it, in a plain, punchy voice
Only use what you actually found in posts. Don't make up numbers.`,
  });
  report += `## ${name}\n\n${r.toText()}\n\n`;
}

mkdirSync("reports", { recursive: true });
const file = `reports/trends-${stamp}.md`;
writeFileSync(file, report);
console.log(report);
console.log(`Saved to ${file}`);
