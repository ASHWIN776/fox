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

export default tools;