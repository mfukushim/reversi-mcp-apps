import {z} from "zod";

//  def

const ColorSchema = z.enum(["B", "W"]);
export type Color = z.infer<typeof ColorSchema>;
const CellSchema = z.enum([".","B", "W"]);
export type Cell = z.infer<typeof CellSchema>;

export const ExportStateSchema = z.object({
  board: z.string(),          // 64文字 (A1..H1, A2..H2, ... A8..H8)
  to: ColorSchema,              // 次手番
  seq: z.number(),              //  シーケンス
  legal: z.array(z.string()),        // 次手番の合法手 (座標)
  black: z.number(),          // 黒の石数
  white: z.number(),          // 白の石数
});

export type ExportState = z.infer<typeof ExportStateSchema>;

export type State = {
  board: ExportState;
  gameSession: string;
  currentSeq: number;
};

export type PlayResult = {
  ok: boolean
  error?: string
  reset?: boolean
  pass?: boolean
  placedIdx?: number
  flips?: number[]
}
