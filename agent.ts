import * as readline from "node:readline";
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

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
const tools = [
  {
    functionDeclarations: [
      {
        name: "list_files",
        description: "List files and directories in a given path.",
        parameters: {
          type: "OBJECT",
          properties: {
            directory: { type: "STRING", description: "The directory to list." }
          },
          required: ["directory"]
        }
      },
      {
        name: "read_file",
        description: "Read the contents of a file at the given path",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "The file path to read." }
          },
          required: ["path"]
        }
      },
      {
        name: "run_bash",
        description: "Execute a bash command and return its output",
        parameters: {
          type: "OBJECT",
          properties: {
            command: { type: "STRING", description: "The bash command to execute." }
          },
          required: ["command"]
        }
      }
    ]
  }
];
const executeTool = async (name: string, args: any) => {
  if (name === "list_files") {
    const directory = args.directory;
    const files = readdirSync(directory);
    return files;
  }
  if (name === "read_file") {
    const path = args.path;
    try {
      const content = readFileSync(path, "utf-8");
      return content;
    } catch (error) {
      return "Error: file not found";
    }
  }
  if (name === "run_bash") {
    const command = args.command;
    try {
      const output = execSync(command, { 
        encoding: "utf-8",
        timeout: 30000 
      }).trim();
      debug(`Command output: ${output}`);
      return output;
    } catch (error: any) {
      return `
        Exit code: ${error.status}
        stderr: ${error.stderr}
        stdout: ${error.stdout}
      `;
    }
  }
  return "Unknown tool";
};

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

  while(true){
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
        tools: tools,      
      
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
    });
    const data: any = await response.json();
    debug(JSON.stringify(data, null, 2));

    if (data.error?.code === 429) {
      const retryInfo = data.error?.details?.find((d: any) => d["@type"]?.includes("RetryInfo"));
      const delaySec = parseInt(retryInfo?.retryDelay ?? "60");
      for (let i = delaySec + 10; i > 0; i--) {
        process.stdout.write(`\r\x1b[31mRate limited — retrying in ${i}s...\x1b[0m`);
        await new Promise(r => setTimeout(r, 1000));
      }
      process.stdout.write("\r\x1b[2K");
      continue;
    }

    messages.push(data.candidates?.[0]?.content);

    const parts = data.candidates?.[0]?.content?.parts;
    const text = parts?.find((part: any) => part.text)?.text;
    const functionCall = parts?.find((part: any) => part.functionCall)?.functionCall;
  
    if (functionCall) {
      console.log(`🔧 ${functionCall.name}(${JSON.stringify(functionCall.args)})`);
      const result = await executeTool(functionCall.name, functionCall.args);
      messages.push({
        role: "function", 
        parts: [
          { 
            functionResponse: {
              name: functionCall.name,
              response: {
                name: functionCall.name,
                content: result
              }
            }
          } 
        ] 
      });
      continue;
    }
  
    return text || "";
  }


}

main().catch(console.error);