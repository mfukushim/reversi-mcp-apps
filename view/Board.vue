<template>
  <article ref="baseApp" class="wrap" :style="hostContext?.safeAreaInsets && {
      paddingTop: hostContext.safeAreaInsets.top + 'px',
      paddingRight: hostContext.safeAreaInsets.right + 'px',
      paddingBottom: hostContext.safeAreaInsets.bottom + 'px',
      paddingLeft: hostContext.safeAreaInsets.left + 'px',
    }">
    <div v-if="!gameDisabled">
    <div class="header">
      <div class="badge">{{locale == 'ja-JP'?'手番':'Turn'}}: {{ turnText }}</div>
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
          :class="['cell', { disabled: clickDisabled }]"
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
    </div>
    <div v-else class="header">
      {{locale == 'ja-JP'?'ゲームセッションが終了したため盤面が無効です':'Board Disabled. Game session expired.'}}
<!--
      <button class="CmdBtn" @click="restoreGame"> {{locale == 'ja-JP'?'ここからゲームを再開する':'Restore Game from here'}}</button>
-->
    </div>
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
import type {Cell, Color, ExportState, State} from "../Def.ts";

const app = ref<App | null>(null);
const baseApp = ref<HTMLElement | null>(null);
const hostContext = ref<McpUiHostContext | undefined>();

interface PlayResult {
  ok: boolean
  error?: string
  reset?: boolean
  pass?: boolean
  placedIdx?: number
  flips?: number[]
}

class ReversiEngine {
  private b: Cell[] = []
  private to: Color = 'B'
  private seq: number = 0

  init() {
    this.b = Array(64).fill('.')
    // 初期配置
    this.b[27] = 'W'; this.b[28] = 'B'
    this.b[35] = 'B'; this.b[36] = 'W'
    this.to = 'B'
    this.seq = 0
    return this.export()
  }

  import(state: { board: string; to: string, seq:number }) {
    if (!state || state.board.length !== 64) {
      throw new Error('board は64文字の文字列である必要があります')
    }
    if (state.to !== 'B' && state.to !== 'W') {
      throw new Error("to は 'B' または 'W'")
    }
    const arr: Cell[] = []
    for (let i = 0; i < 64; i++) {
      const ch = state.board[i]
      if (ch !== '.' && ch !== 'B' && ch !== 'W') throw new Error('board に不正な文字があります')
      arr.push(ch)
    }
    this.b = arr
    this.to = state.to
    this.seq = state.seq
    return this.export()
  }

  export(): ExportState {
    const { black, white } = this.counts()
    return { board: this.b.join(''), to: this.to, legal: this.legalMoves(this.to), black, white ,seq:this.seq}
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
      this.seq++
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
    this.seq++
    return { ok: true, placedIdx: i, flips }
  }
}

const engine = new ReversiEngine()
const state = ref<ExportState>({} as ExportState)
const gameSession = ref<string>('')
const currentSeq = ref(0)
const done = ref(false)
const locale = ref('en')
const clickDisabled = ref(false)
const animCoord = ref<string>('')
const toastVisible = ref(false)
const toastMessage = ref('')
const gameDisabled = ref(false)
const recentGameState = ref<ExportState|undefined>(undefined)

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
  if (done.value || clickDisabled.value) return // 選択操作後の盤面は無反応にする

  const res = engine.playBlack(coord)
  if (!res.ok) {
    showToast(res.error || 'エラー')
    return
  }

  state.value = engine.export()
  animCoord.value = coord
  currentSeq.value = state.value.seq

  clickCell(coord)

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
    return result.structuredContent as unknown as State;
  } catch (e) {
    await remoteLog('Import error:', e)
    state.value = engine.init()
  }
}

async function clickCell(coord:string) {
  try {
    if (!app.value) throw new Error('App not found')
    await app.value.callServerTool({
      name: "select-user", arguments: { move: coord,gameSession:gameSession.value} });
    const cap = app.value.getHostCapabilities()
    if (cap?.updateModelContext) {
      await app.value.updateModelContext(
          {content:[{type:'text',text:'The user has already placed the next stone, so the board state has changed. User placed B on ' + coord
                  +'. Assistant\'s turn now. Next, Please devise a position for the next white stone and put a white stone by select-assistant(e.g., {"move":"A1"}).'
                  +` The current board state is "${JSON.stringify(state.value)}".`}]})
      await app.value.sendMessage({
        role: "user",
        content: [{type:'text',text:locale.value === 'ja-JP' ?`黒を${coord}に置きました。あなたの手番です。`:`I placed B on ${coord}. Your turn now.`}]
      })
    } else {
      await app.value.sendMessage({
        role: "user",
        content: [{type:'text',text:locale.value === 'ja-JP' ?`黒を${coord}に置きました。あなたの手番です。\n現在の盤面:"${JSON.stringify(state.value)}"`:`I placed B on ${coord}. Your turn now.\nThe current board state is "${JSON.stringify(state.value)}".`}]
      })
    }

    // 正常に実行完了したらクリックを無効化
    clickDisabled.value = true
  } catch (e) {
    console.error('Import error:', e)
    state.value = engine.init()
  }
}

/*
async function restoreGame() {
  if (!app.value) return
  gameDisabled.value = false
  done.value = false
  clickDisabled.value = false
  if(recentGameState.value) state.value = engine.import(recentGameState.value)
  await remoteLog('Restored game1:', state.value,gameSession.value)
  //  TODO ここで止まる?
  const res = await app.value.callServerTool({ name: "restore-game", arguments: { state: state.value,gameSession:gameSession.value } });
  await remoteLog('Restored game2:', res)
}
*/

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
  locale.value = ctx?.locale || 'en'
});

onMounted(async () => {
  // await remoteLog('logStart:')
  const instance = new App({ name: "Reversi App", version: "1.0.0" },{},{autoResize:false});
  gameDisabled.value = false
  done.value = false
  clickDisabled.value = false
  instance.ontoolinput = async (params) => {
    console.info("Received tool call input:", params);
  };
  instance.ontoolresult = async (result) => {
    console.info("Received tool call result:", result);
    if (result.structuredContent?.board) {
      state.value = engine.import(result.structuredContent.board as unknown as ExportState)
      recentGameState.value = result.structuredContent.board as unknown as ExportState
    }
    if (result.structuredContent?.gameSession) {
      gameSession.value = result.structuredContent.gameSession as string
    }
    const currentSeq = state.value.seq
    const currentState = await importBoard()
    if(currentState?.gameSession && result.structuredContent?.gameSession
        && currentState.gameSession === result.structuredContent?.gameSession) {
      gameDisabled.value = false
      done.value = false
      clickDisabled.value = false
      state.value = engine.import(currentState.board)
      if (currentSeq === state.value.seq) {
        recentGameState.value = currentState.board
        return
      }
    }
    console.log('Game session mismatch, disabling game',
        currentState?.gameSession,result.structuredContent?.gameSession,currentSeq,state.value.seq)
    gameDisabled.value = true
    app.value?.sendSizeChanged({ height:50 });
  };

  instance.ontoolcancelled = async (params) => {
    console.info("Tool call cancelled:", params.reason);
  };

  instance.onerror = console.error;

  instance.onhostcontextchanged = async (params) => {
    hostContext.value = { ...hostContext.value, ...params };
  };

  await instance.connect(undefined,{});
  app.value = instance;
  hostContext.value = instance.getHostContext();
  if (baseApp.value) {
    const { width, height } = baseApp.value?.getBoundingClientRect();
    console.log('width:', width, 'height:', height)
    app.value.sendSizeChanged({ height:Math.floor(height*1.2) });
  }
})
</script>

<style scoped>
* {
  box-sizing: border-box;
}

.wrap {
  --gap: clamp(2px, 1.2vw, 10px);
  max-width: 500px;
  max-height: 550px;
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
  outline: none;
}

.cell:not(.disabled) {
  cursor: pointer;
}

.cell.disabled {
  cursor: not-allowed;
  opacity: 0.6;
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
