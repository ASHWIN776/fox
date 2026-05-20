import * as readline from "node:readline";
import { tools, executeTool } from "./tools";
import systemPrompt from "./system-prompt"; 
import { debug } from "./utils";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY in .env file");
  process.exit(1);
}

const messages: any[] = [];

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