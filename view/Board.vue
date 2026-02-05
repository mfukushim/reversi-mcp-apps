<template>
  <article class="wrap" :style="hostContext?.safeAreaInsets && {
      paddingTop: hostContext.safeAreaInsets.top + 'px',
      paddingRight: hostContext.safeAreaInsets.right + 'px',
      paddingBottom: hostContext.safeAreaInsets.bottom + 'px',
      paddingLeft: hostContext.safeAreaInsets.left + 'px',
      width: '600px',
      height: '650px'
    }">
    <div class="header">
      <div class="badge">手番: {{ turnText }}</div>
      <div class="controls">
        <button class="CmdBtn" type="button" title="合法手が無いときのみ有効" @click="onCell('PASS')">PASS</button>
<!--
        <button class="CmdBtn new" type="button" title="新しい対局を開始" @click="onCell('NEW')">NEW</button>
-->
      </div>
      <div class="counts">
        <span class="disc b"></span><strong>{{ state.black }}</strong>
        <span style="color:#999">:</span>
        <span class="disc w"></span><strong>{{ state.white }}</strong>
      </div>
    </div>

    <div class="board">
      <!-- ガイド文字（上と左） -->
      <div class="guides" aria-hidden="true">
        <div class="guide-top">
          <div v-for="ch in topGuides" :key="ch">{{ ch }}</div>
        </div>
        <div class="guide-left">
          <div v-for="n in leftGuides" :key="n">{{ n }}</div>
        </div>
      </div>
      <div class="grid">
        <div
          v-for="(ch, i) in state.board"
          :key="i"
          class="cell"
          :data-coord="getCoord(i)"
          tabindex="0"
          :aria-label="getCoord(i)"
          @click="onCell(getCoord(i))"
          @keydown="onKeydown($event, getCoord(i))"
        >
          <div v-if="ch === 'B'" :class="['disc', 'B', { appear: animCoord === getCoord(i) }]"></div>
          <div v-else-if="ch === 'W'" :class="['disc', 'W', { appear: animCoord === getCoord(i) }]"></div>
          <div v-else-if="isLegal(getCoord(i))" class="hint"></div>
        </div>
      </div>
    </div>

    <div :class="['toast', { show: toastVisible }]">{{ toastMessage }}</div>
  </article>
</template>

<script setup lang="ts">
import { ref, onMounted, watchEffect, computed } from "vue";
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const app = ref<App | null>(null);
const hostContext = ref<McpUiHostContext | undefined>();


interface ReversiState {
  board: string
  to: string
  legal: string[]
  black: number
  white: number
}

interface PlayResult {
  ok: boolean
  error?: string
  reset?: boolean
  pass?: boolean
  placedIdx?: number
  flips?: number[]
}

// const props = defineProps<{
//   initialState?: { board: string; to: string }
//   gameSession?: string
// }>()

// const emit = defineEmits<{
//   click: [coord: string, result: PlayResult, state: ReversiState]
// }>()

class ReversiEngine {
  private b: string[] = []
  private to: string = 'B'

  init() {
    this.b = Array(64).fill('.')
    // 初期配置
    this.b[27] = 'W'; this.b[28] = 'B'
    this.b[35] = 'B'; this.b[36] = 'W'
    this.to = 'B'
    return this.export()
  }

  import(state: { board: string; to: string }) {
    remoteLog('import',state)
    if (!state || typeof state.board !== 'string' || state.board.length !== 64) {
      throw new Error('board は64文字の文字列である必要があります')
    }
    if (state.to !== 'B' && state.to !== 'W') {
      throw new Error("to は 'B' または 'W'")
    }
    const arr = []
    for (let i = 0; i < 64; i++) {
      const ch = state.board[i]
      if (ch !== '.' && ch !== 'B' && ch !== 'W') throw new Error('board に不正な文字があります')
      arr.push(ch)
    }
    this.b = arr
    this.to = state.to
    return this.export()
  }

  export(): ReversiState {
    const { black, white } = this.counts()
    return { board: this.b.join(''), to: this.to, legal: this.legalMoves(this.to), black, white }
  }

  opp(c: string) { return c === 'B' ? 'W' : 'B' }

  idx(coord: string) { return (coord.charCodeAt(1) - 49) * 8 + (coord.charCodeAt(0) - 65) }

  rc(i: number) { return [Math.floor(i / 8), i % 8] }

  coord(i: number) { return String.fromCharCode(65 + (i % 8)) + String.fromCharCode(49 + Math.floor(i / 8)) }

  counts() {
    let b = 0, w = 0
    for (const x of this.b) {
      if (x === 'B') b++
      else if (x === 'W') w++
    }
    return { black: b, white: w }
  }

  legalMoves(color: string) {
    const res = []
    for (let i = 0; i < 64; i++) {
      if (this.b[i] !== '.') continue
      if (this.flips(i, color).length > 0) res.push(this.coord(i))
    }
    return res
  }

  flips(i: number, color: string) {
    if (this.b[i] !== '.') return []
    const [r, c] = this.rc(i), opp = this.opp(color)
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    const res = []
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc
      const tmp = []
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && this.b[rr * 8 + cc] === opp) {
        tmp.push(rr * 8 + cc)
        rr += dr
        cc += dc
      }
      if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && this.b[rr * 8 + cc] === color && tmp.length) {
        res.push(...tmp)
      }
    }
    return res
  }

  playBlack(move: string) {
    return this.play('B', move)
  }

  play(to: string, coord: string): PlayResult {
    if (coord === 'NEW') {
      this.init() // 盤面初期化 手番は黒
      return { ok: true, reset: true }
    }
    if (to !== this.to) {
      return { ok: false, error: 'Invalid turn' }
    }
    if (coord === 'PASS') {
      const leg = this.legalMoves(this.to)
      if (leg.length) return { ok: false, error: 'There are still legal options.' }
      this.to = this.opp(this.to)
      return { ok: true, pass: true }
    }
    if (!/^[A-H][1-8]$/.test(coord)) return { ok: false, error: 'Invalid coordinates.' }
    const i = this.idx(coord)
    if (this.b[i] !== '.') return { ok: false, error: 'There is already a stone.' }
    const flips = this.flips(i, this.to)
    if (!flips.length) return { ok: false, error: "Can't flip stones." }
    this.b[i] = this.to
    for (const j of flips) this.b[j] = this.to
    this.to = this.opp(this.to)
    if (this.legalMoves(this.to).length === 0) this.to = this.opp(this.to) // 相手に手が無ければ自動パス
    return { ok: true, placedIdx: i, flips }
  }
}

const engine = new ReversiEngine()
const state = ref<ReversiState>({} as ReversiState)
const done = ref(false)
const animCoord = ref<string>('')
const toastVisible = ref(false)
const toastMessage = ref('')

const turnText = computed(() => {
  return state.value.to === 'B' ? '黒(B)' : '白(W)'
})

const topGuides = Array.from({ length: 8 }, (_, i) => String.fromCharCode(65 + i))
const leftGuides = Array.from({ length: 8 }, (_, i) => i + 1)

function getCoord(i: number) {
  return String.fromCharCode(65 + (i % 8)) + String.fromCharCode(49 + Math.floor(i / 8))
}

function isLegal(coord: string) {
  return state.value.legal?.includes(coord)
}

function showToast(msg: string) {
  toastMessage.value = msg || "Can't do it"
  toastVisible.value = true
  setTimeout(() => {
    toastVisible.value = false
  }, 1200)
}

function onCell(coord: string) {
  if (done.value) return // 選択操作後の盤面は無反応にする

  remoteLog('onCell:', coord,state.value);
  const res = engine.playBlack(coord)
  if (!res.ok) {
    showToast(res.error || 'エラー')
    return
  }

  state.value = engine.export()
  animCoord.value = coord

  clickCell(coord, res)

  // アニメーション用のクラスをリセット
  setTimeout(() => {
    animCoord.value = ''
  }, 300)
}

function onKeydown(event: KeyboardEvent, coord: string) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onCell(coord)
  }
}

async function remoteLog(...args: any[]) {
  if (!app.value) return
  const s = args.map(value => value instanceof Object ? JSON.stringify(value) : value).join(',');
  await app.value.callServerTool({ name: "view-log", arguments: {text: s} });
}

async function importBoard() {
  try {
    if (!app.value) throw new Error('App not found')
    const result:CallToolResult = await app.value.callServerTool({ name: "get-board", arguments: {} });
    await remoteLog("get-board result:", result);
    // const res = result.content.find(c => c.type === 'text');
    if (result.structuredContent) {
      state.value = engine.import(result.structuredContent as unknown as ReversiState)
    }
  } catch (e) {
    await remoteLog('Import error:', e)
    state.value = engine.init()
  }
}

async function clickCell(coord:string,res:PlayResult) {
  try {
    await remoteLog('Clicked:', coord,res);
    if (!app.value) throw new Error('App not found')
    const result:CallToolResult = await app.value.callServerTool({ name: "select-user", arguments: { move: coord } });
    await remoteLog("select-user result:", result);
    const result2 = await app.value.updateModelContext(
        {content:[{type:'text',text:'The user has already placed the next stone, so the board state has changed. User placed B on ' + coord
                +'. Assistant\'s turn now. Next, Please devise a position for the next white stone and put a white stone by select-assistant(e.g., {"move":"A1"}).'
                +` The current board state is "${JSON.stringify(state.value)}".`}]})
    await remoteLog("select-user result2:", result2);
    const result3 = await app.value.sendMessage({
        role: "user",
        content: [{type:'text',text:'I placed B on ' + coord +'. Your turn now.'}]
    })
    await remoteLog("select-user result3:", result3);
    // const res = result.content.find(c => c.type === 'text');
    // if (res) {
    //   state.value = JSON.parse(res.text);
    // }
  } catch (e) {
    console.error('Import error:', e)
    state.value = engine.init()
  }
}

watchEffect(() => {
  const ctx = hostContext.value;
  if (ctx?.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx?.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx?.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
});

onMounted(async () => {
  const instance = new App({ name: "Reversi App", version: "1.0.0" });
  instance.ontoolinput = (params) => {
    console.info("Received tool call input:", params);
  };

  instance.ontoolresult = (result) => {
    console.info("Received tool call result:", result);
    // serverTime.value = extractTime(result);
  };

  instance.ontoolcancelled = (params) => {
    console.info("Tool call cancelled:", params.reason);
  };

  instance.onerror = console.error;

  instance.onhostcontextchanged = (params) => {
    hostContext.value = { ...hostContext.value, ...params };
  };

  await instance.connect();
  app.value = instance;
  hostContext.value = instance.getHostContext();

  await remoteLog('hostContext:', JSON.stringify(hostContext.value,null,2));

  await importBoard();
/*
  try {
    if (props.initialState) {
      state.value = engine.import({ board: props.initialState.board, to: props.initialState.to })
    } else {
      state.value = engine.init()
    }
  } catch (e) {
    console.error('Import error:', e)
    state.value = engine.init()
  }
*/
})
</script>

<style scoped>
* {
  box-sizing: border-box;
}

.wrap {
  --gap: clamp(2px, 1.2vw, 10px);
  max-width: 720px;
  margin: 0 auto;
  padding: 12px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
  background: #fafafa;
  color: #222;
}

.header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin: 10px 0;
  flex-wrap: wrap;
}

.badge {
  background: #e3f2fd;
  border-radius: 999px;
  padding: 6px 10px;
  font-weight: 600;
}

.counts {
  display: flex;
  gap: 8px;
  align-items: center;
}

.counts .disc {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.35);
}

.counts .disc.b {
  background: #111;
}

.counts .disc.w {
  background: #f7f7f7;
  border: 1px solid rgba(0, 0, 0, 0.15);
}

.board {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: #174d1b;
  padding: calc(var(--gap) * 2 + 18px);
  border-radius: 12px;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.08), inset 0 0 0 2px rgba(255, 255, 255, 0.08);
}

.grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  gap: var(--gap);
  width: 100%;
  height: 100%;
}

.cell {
  position: relative;
  background: linear-gradient(135deg, #2f7d32, #266628);
  border-radius: 8px;
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  outline: none;
}

.cell:hover {
  filter: brightness(1.06);
}

.cell:focus-visible {
  box-shadow: 0 0 0 3px #ffc107, inset 0 0 0 2px rgba(0, 0, 0, 0.2);
}

.disc {
  position: absolute;
  inset: 12%;
  border-radius: 50%;
  box-shadow: inset 0 6px 10px rgba(0, 0, 0, 0.35), 0 3px 8px rgba(0, 0, 0, 0.2);
  opacity: 1;
  transform: scale(1);
}

.disc.B {
  background: #111;
}

.disc.W {
  background: #f7f7f7;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.hint {
  position: absolute;
  inset: 38%;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.18);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

/* 置石アニメ */
@keyframes appear {
  from {
    transform: scale(0);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.disc.appear {
  animation: appear 0.3s ease-out;
}

/* ガイド（上: A-H、左: 1-8） */
.guides {
  pointer-events: none;
  position: absolute;
  inset: 0;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
  z-index: 10;
}

.guide-top {
  position: absolute;
  left: calc(var(--gap) * 2 + 18px);
  right: calc(var(--gap) * 2 + 18px);
  top: 6px;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: var(--gap);
  font-size: clamp(10px, 2.2vw, 14px);
  text-align: center;
}

.guide-top > div {
  display: flex;
  align-items: center;
  justify-content: center;
}

.guide-left {
  position: absolute;
  top: calc(var(--gap) * 2 + 18px);
  bottom: calc(var(--gap) * 2 + 18px);
  left: 6px;
  display: grid;
  grid-template-rows: repeat(8, 1fr);
  gap: var(--gap);
  font-size: clamp(10px, 2.2vw, 14px);
  text-align: left;
}

.guide-left > div {
  display: flex;
  align-items: center;
}

/* コマンドボタン */
.controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.CmdBtn {
  padding: 8px 12px;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 700;
  background: #ffe082;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12), inset 0 -2px 0 rgba(0, 0, 0, 0.12);
}

.CmdBtn:hover {
  filter: brightness(1.04);
}

.CmdBtn.new {
  background: #bbdefb;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  background: #333;
  color: #fff;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.25s;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.toast.show {
  opacity: 1;
}
</style>
