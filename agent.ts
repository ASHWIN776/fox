import * as readline from "node:readline";
import { readFileSync } from "node:fs";

const debug = (...args: any[]) => console.error("\x1b[2m[debug]", ...args, "\x1b[0m");

// Load .env file
const env = readFileSync(".env", "utf-8");
for (const line of env.split("\n")) {
  const [key, ...vals] = line.split("=");
  if (key?.trim() && vals.length) {
    const v = vals.join("=").trim();
    if (v && !v.startsWith("#")) process.env[key.trim()] = v;
  }
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY in .env file");
  process.exit(1);
}

const messages: any[] = [];
const systemPrompt = `You are fox, a coding assistant. You help users with programming tasks.

You have access to tools that let you interact with the filesystem and run commands.
Use tools proactively — for example, list files to understand a project before asking
the user for specific paths. Always try to help by taking action, not just asking questions.

Working directory: ${process.cwd()}

Be concise.`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q: string): Promise<string> =>
  new Promise((resolve) => rl.question(q, resolve));

async function main() {
  while (true) {
    const input = await prompt("> ");
    const response = await chat(input);
    console.log(response);
  }
}

async function chat(input: string): Promise<string> {
  messages.push({ role: "user", parts: [{ text: input }] });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: messages,
      systemInstruction: {
        parts: [
          {
            text: systemPrompt,
          },
        ],
      },
      tools: [{
        functionDeclarations: [{
          name: "list_files",
          description: "List files and directories at the given path",
          parameters: {
            type: "object",
            properties: {
              directory: {
                type: "string",
                description: "Directory path to list"
              }                     
            },
            required: ["directory"]
          }
        }]
      }],      
    
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  });
  const data = await response.json();
  messages.push(data.candidates?.[0]?.content);
  debug(JSON.stringify(data, null, 2));

  const parts = data.candidates?.[0]?.content?.parts;
  const text = parts?.find((part: any) => part.text)?.text;
  const functionCall = parts?.find((part: any) => part.functionCall)?.functionCall;

  if (functionCall) {
    console.log(`🔧 ${functionCall.name}(${JSON.stringify(functionCall.args)})`);
    return "";
  }

  return text || "";
}

main().catch(console.error);
