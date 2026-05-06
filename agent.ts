import * as readline from "node:readline";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import tools from "./tools";
import systemPrompt from "./system-prompt"; 

const debug = (...args: any[]) => console.error("\x1b[2m[debug]", ...args, "\x1b[0m");

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY in .env file");
  process.exit(1);
}

const messages: any[] = [];

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
  if (name === "edit_file") {
    const path = args.path;
    const old_string = args.old_string;
    const new_string = args.new_string;

    let fileContent: string;

    try {
      try {
        fileContent = readFileSync(path, "utf-8");
      } catch (error: any) {
        if (error.code === "ENOENT" && old_string === "") {
          // File doesn't exist, create it
          writeFileSync(path, new_string);
          return "File created successfully";
        }
        throw new Error("Error: file not found");
      }
  
      if (old_string === "") {
        appendFileSync(path, new_string);
        return "String appended to file";
      }
      
      if (fileContent.includes(old_string)) {
        const matches = fileContent.match(new RegExp(old_string, "g"));
        if (matches && matches.length > 1) {
          throw new Error("Error: multiple occurrences found in file");
        }
        const newContent = fileContent.replace(old_string, new_string);
        writeFileSync(path, newContent);
        return "File edited successfully";
      } else {
        throw new Error("Error: string not found in file");
      }
    } catch (error: any) {
      debug(`Edit file error: ${error.message}`);
      return error.message;
    }
  }

  if(name === "search_code") {
    const pattern = args.pattern;
    const directory = args.directory;
    const fileGlob = args.fileGlob;
    
    let command = `rg --no-color -n`;
    if (fileGlob) command += ` -g "${fileGlob}"`;
    command += ` "${pattern}" "${directory}"`;
    
    try {
      const result = execSync(command, { encoding: "utf-8" });
      return result;
    } catch (error: any) {
      if (error.status === 1) {
        return "No matches found";
      }
      debug(`Search code error: ${error.message}`);
      return error.message;
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