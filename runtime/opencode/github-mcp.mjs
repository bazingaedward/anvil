import { executionEnvironment } from "../../desktop/main/acceptance.ts";
import { extensionCommand } from "../../desktop/main/extension-command.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  loginPattern,
  repoPattern,
  githubKey,
} from "../../desktop/shared/extensions.ts";

const query = `query($owner:String!, $name:String!, $number:Int!, $after:String){
  viewer { login }
  repository(owner:$owner,name:$name){pullRequest(number:$number){
    title url state body baseRefOid headRefOid changedFiles
    files(first:100,after:$after){nodes{path additions deletions} pageInfo{hasNextPage endCursor}}
  }}
}`;
export async function serveGithub(repo, login, auth) {
  if (
    !repoPattern.test(repo) ||
    !loginPattern.test(login) ||
    !["cli", "keygrant"].includes(auth)
  )
    throw Error("Invalid binding");
  const [owner, name] = repo.split("/");
  const server = new Server(
    { name: "anvil-github", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "read_pull_request",
        description: `Read a pull request in ${repo} using GitHub account ${login}.`,
        inputSchema: {
          type: "object",
          properties: {
            number: { type: "integer", minimum: 1 },
            after: { type: "string" },
          },
          required: ["number"],
          additionalProperties: false,
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const { number, after } = params.arguments || {};
      if (
        params.name !== "read_pull_request" ||
        !Number.isSafeInteger(number) ||
        number < 1 ||
        (after !== undefined &&
          (typeof after !== "string" || after.length > 512))
      )
        throw Error("Invalid pull request arguments");
      const env = { ...executionEnvironment(), GH_PROMPT_DISABLED: "1" };
      if (auth === "keygrant") {
        env.GH_TOKEN = process.env[githubKey(login)];
        if (!env.GH_TOKEN) throw Error("Keygrant credential unavailable");
      }
      const args = [
        "api",
        "--hostname",
        "github.com",
        "graphql",
        "-f",
        "query=" + query,
        "-f",
        "owner=" + owner,
        "-f",
        "name=" + name,
        "-F",
        "number=" + number,
      ];
      if (after) args.push("-f", "after=" + after);
      let stdout;
      try {
        ({ stdout } = await promisify(execFile)(extensionCommand("gh"), args, {
          env,
          timeout: 20000,
          maxBuffer: 1024 * 1024,
        }));
      } catch {
        throw Error(
          `GitHub 无法读取 ${repo} 的 PR #${number}。请检查 ${login} 的授权和 PR 编号。`,
        );
      }
      const data = JSON.parse(stdout).data;
      if (data.viewer?.login?.toLowerCase() !== login.toLowerCase())
        throw Error(`GitHub 账号不匹配，请连接 ${login}。`);
      if (!data.repository?.pullRequest)
        throw Error("Pull request unavailable");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              login: data.viewer.login,
              ...data.repository.pullRequest,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      };
    }
  });
  await server.connect(new StdioServerTransport());
}
