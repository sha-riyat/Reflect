export type TradeSide = "long" | "short";
export type TradeOutcome = "win" | "loss";

export type Trade = {
  id: string;
  date: string; // ISO string yyyy-mm-dd
  asset: string;
  side: TradeSide;
  outcome: TradeOutcome;
  amount: number; // USD, positive number entered by user
  note?: string;
};

export type CashMove = {
  id: string;
  date: string;
  amount: number; // positif pour dépôt
  note?: string;
};

export type AppState = {
  trades: Trade[];
  deposits: CashMove[];
};
