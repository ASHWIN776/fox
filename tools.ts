
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { debug } from "./utils";

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
      },
      {
        name: "edit_file",
        description: "Edit a file by replacing a specific string with new content. Can also create new files.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "The file path to edit." },
            old_string: { type: "STRING", description: "the string to find and replace (empty string = create/append)" },
            new_string: { type: "STRING", description: "the replacement" }
          },
          required: ["path", "old_string", "new_string"]
        }
      },
      {
        name: "search_code",
        description: "Search for a pattern in code files using ripgrep. Returns matching lines with file paths and line numbers. Prefer this over read_file when exploring an unfamiliar codebase.",
        parameters: {
          type: "OBJECT",
          properties: {
            pattern: { type: "STRING", description: "The search pattern or regex to look for." },
            directory: { type: "STRING", description: "Directory to search in. Defaults to current directory." },
            fileGlob: { type: "STRING", description: "Optional glob to filter file types, e.g. '*.ts' or '*.py'." }
          },
          required: ["pattern"]
        }
      }
    ]
  }
];

const executeTool = async (name: string, args: any): Promise<string> => {
  if (name === "list_files") {
    const directory = args.directory;
    const files = readdirSync(directory);
    return files.join("\t");
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

export { tools, executeTool };