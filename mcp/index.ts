import {McpAgent} from "agents/mcp";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {generateReversiHTMLFromState} from "./rule-logic/boardDrawer.js";
import {type ExportState, ReversiEngine} from "./rule-logic/reversi.js";
import {z} from "zod";
import {registerAppResource, registerAppTool, RESOURCE_MIME_TYPE} from "@modelcontextprotocol/ext-apps/server";
import type {CallToolResult, ServerNotification, ServerRequest} from "@modelcontextprotocol/sdk/types.js";
import type {RequestHandlerExtra} from "@modelcontextprotocol/sdk/shared/protocol.js";

type State = {
  board: ExportState;
  gameSession: string;
};

const resourceUri = "ui://reversi-mcp-ui/game-board";
// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env, State, {}> {
  server = new McpServer({
    name: "Reversi Game",
    version: "2.0.0",
    description: "A simple reversi game",
  });

  initialState: State = {
    board: new ReversiEngine().init(),
    gameSession: crypto.randomUUID()
  };

  async onStateUpdate(state: State) {
    console.log("state updated", state);
  }

  async init() {
    registerAppResource(this.server,'game-board',resourceUri,{
      mimeType: RESOURCE_MIME_TYPE
    },async () => {
      console.log('current board:', this.state.board)
      return {
        contents: [{
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          // _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          text: generateReversiHTMLFromState()  //  this.state.board, this.state.gameSession
        }]
      }
    })

    registerAppTool(this.server,
      "view-log",
      {
        title: "Test for debug",
        description: "Test for debug,do not use",
        inputSchema: {
          text: z.string().optional(),
        },
        _meta: { ui: { resourceUri: resourceUri } }
      },
      ({text}) => {
        console.log(`##${text}`)
        return {
          content: [{
            type: "text",
            text: 'done',
            annotations: {
              audience: ['user'],
            },
          }]
        }
      },
    );

    registerAppTool(this.server,
      "new-game",
      {
        title: "Start a new Reversi game",
        description: "Start a new Reversi game",
        inputSchema: {},
        _meta: { ui: { resourceUri: resourceUri } }
      },
      () => {
        const engine = new ReversiEngine()
        engine.init()
        this.state.board = engine.export()
        this.setState({...this.state});
        return this.makeMessage(`Started Reversi. current board: ${JSON.stringify(this.state.board)}.  ${this.state.board.to === "W" ? 'Assistant\'s turn.' : 'User\'s turn.'} The board has already been presented to the user, so the assistant does not need to re-present it.`)
      },
    );
    registerAppTool(this.server,
      "get-board",
      {
        title: "Get the current board state",
        description: "Get the current board state",
        _meta: { ui: { resourceUri } }
      },
      (extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
        console.log('extra:',JSON.stringify(extra,null,2))
        return this.makeMessage(`current board: ${JSON.stringify(this.state.board)}.  ${this.state.board.to === "W" ? 'Assistant\'s turn.' : 'User\'s turn.'} The board has already been presented to the user, so the assistant does not need to re-present it.`)
      },
    );
    registerAppTool(this.server,
      "select-user",
      {
        title: "User move a stone",
        description: "User move a stone",
        inputSchema: {
          move: z.string().describe('Where to place the black stone. Specify one of A1 to H8. Pass to PASS.'),
          //  TODO 暗号化またはサイン要  つまり 公開鍵をAIに知られない方法で送らなければならない サインのみならAIに漏れる形でもよい? AIが嘘の公開鍵をMCPに送る可能性があるのでサインでもダメか。。
          gameSession: z.string().optional(), //  TODO 通信時に使用
        },
        _meta: { ui: { resourceUri } }
      },
      ({move},extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
        let m = ''
        console.log('extra:',JSON.stringify(extra,null,2))
        try {
          const engine = new ReversiEngine()
          engine.import(this.state.board)
          const res = engine.playBlack(move)
          if (res.ok) {
            this.state.board = engine.export()
            this.setState({...this.state});
          } else {
            console.log('ng:', res.error)
            return this.makeMessage((move === "PASS" ? 'User made an incorrect choice. Attempting to pass despite having a legal move' : 'User made an incorrect choice. User tried to place ' + this.state.board.to + ' on ' + move) + '. error message is "' + res.error + '"')
          }
          const assistantTurn = ' Assistant\'s turn now. Next, Please devise a position for the next white stone and put a white stone by select-assistant(e.g., {"move":"A1"}).'
          m = res.pass ? 'User passed.'+assistantTurn : res.reset ? 'User reset the game. User\'s turn now.' : 'The user has already placed the next stone, so the board state has changed. User placed B on ' + move +'. ' +assistantTurn
        } catch (e: any) {
          console.log('error:', e.toString())
          return {content: [{type: "text", text: `error: ${e.message}`, annotations: {audience: ["assistant"],}}]}
        }
        return this.makeMessage(`${m} The current board state is "${JSON.stringify(this.state.board)}". The board has already been presented to the user, so the assistant does not need to re-present it.`)
      }
    );
    registerAppTool(this.server,
      "select-assistant",
      {
        title: "Assistant move a stone",
        description: "Assistant move a stone",
        inputSchema: {
          move: z.string().describe('Where to place the white stone. Specify one of A1 to H8. Pass to PASS.'),
        },
        _meta: { ui: { resourceUri } }
      },
      ({move},extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
        console.log('extra:',JSON.stringify(extra,null,2))
        try {
          const engine = new ReversiEngine()
          engine.import(this.state.board)
          const res = engine.playWhite(move)
          if (res.ok) {
            this.state.board = engine.export()
            this.setState({...this.state});
          } else {
            console.log('ng:', res.error)
            return this.makeMessage(`The choice is incorrect. ${res.error}` + `. current board: ${JSON.stringify(this.state.board)}.  ${this.state.board.to === "W" ? 'Assistant must place the white stone using "select-assistant".' : 'User\'s turn.'}`)
          }
        } catch (e: any) {
          console.log('error:', e.toString())
          return {content: [{type: "text", text: `error: ${e.message}`, annotations: {audience: ["assistant"],}}]}
        }
        return this.makeMessage(`Board updated. Please do not repost the game board as it has already been shown to the user. current board: ${JSON.stringify(this.state.board)}.  ${this.state.board.to === "W" ? 'Assistant must place the white stone using "select-assistant".' : 'User\'s turn.'}`)
      }
    )
  }

  private makeMessage(message: string) {
    return {
      content: [
        // createUIResource({
        //   uri: "ui://reversi-mcp-ui/game-board",
        //   content: {
        //     type: "rawHtml",
        //     htmlString: generateReversiHTMLFromState(this.state.board, this.state.gameSession),
        //   },
        //   encoding: "text",
        //   resourceProps: {
        //     annotations: {
        //       audience: ["user"],
        //     },
        //   },
        // }),
        {
          type: "text",
          text: message,
          annotations: {
            audience: ["assistant"],
          },
        }
      ],
      structuredContent: this.state.board as any
    } as CallToolResult
  }
}

/*
const app = new Hono()

app.mount('/sse', MyMCP.serveSSE('/sse').fetch, { replaceRequest: false })
app.mount('/mcp', MyMCP.serve('/mcp').fetch, { replaceRequest: false} )

export default app
*/

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", {status: 404});
  },
};
