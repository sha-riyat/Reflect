import { parseISO } from "date-fns";
import { CashMove, Trade } from "./types";

export type EquityPoint = {
  date: string;
  value: number;
  pnl: number;
};

export type TrackRecordMetrics = {
  netPnl: number;
  winRate: number;
  profitFactor: number | null;
  riskReward: number | null;
  maxDrawdown: number;
  averageWin: number | null;
  averageLoss: number | null;
  totalTrades: number;
};

export const calculatePnl = (trade: Trade) => {
  const sign = trade.outcome === "win" ? 1 : -1;
  return trade.amount * sign;
};

export const buildEquityCurve = (
  trades: Trade[],
  deposits: CashMove[] = [],
): EquityPoint[] => {
  const entries = [
    ...trades.map((trade) => ({
      date: trade.date,
      delta: calculatePnl(trade),
    })),
    ...deposits.map((deposit) => ({
      date: deposit.date,
      delta: deposit.amount,
    })),
  ].sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

  let equity = 0;
  return entries.map((entry) => {
    equity += entry.delta;
    return { date: entry.date, value: equity, pnl: entry.delta };
  });
};

export const aggregateDailyPnl = (trades: Trade[]) => {
  return trades.reduce<Record<string, number>>((acc, trade) => {
    const dayKey = trade.date;
    const pnl = calculatePnl(trade);
    acc[dayKey] = (acc[dayKey] ?? 0) + pnl;
    return acc;
  }, {});
};

export const calculateMetrics = (trades: Trade[]): TrackRecordMetrics => {
  if (!trades.length) {
    return {
      netPnl: 0,
      winRate: 0,
      profitFactor: null,
      riskReward: null,
      maxDrawdown: 0,
      averageWin: null,
      averageLoss: null,
      totalTrades: 0,
    };
  }

  const pnls = trades.map(calculatePnl);
  const winners = pnls.filter((p) => p > 0);
  const losers = pnls.filter((p) => p < 0);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const averageWin = winners.length ? sum(winners) / winners.length : null;
  const averageLoss = losers.length ? sum(losers) / losers.length : null;

  const profitFactor =
    winners.length && losers.length
      ? sum(winners) / Math.abs(sum(losers))
      : null;

  const riskReward =
    averageWin !== null && averageLoss !== null && averageLoss !== 0
      ? averageWin / Math.abs(averageLoss)
      : null;

  const equityPoints = buildEquityCurve(trades);
  let peak = 0;
  let maxDrawdown = 0;
  equityPoints.forEach((point) => {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.max(maxDrawdown, peak - point.value);
  });

  return {
    netPnl: sum(pnls),
    winRate: (winners.length / trades.length) * 100,
    profitFactor,
    riskReward,
    maxDrawdown,
    averageWin,
    averageLoss,
    totalTrades: trades.length,
  };
};
