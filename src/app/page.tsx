'use client';

import clsx from "clsx";
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Flame,
  LineChart,
  Plus,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import {
  aggregateDailyPnl,
  buildEquityCurve,
  calculateMetrics,
  calculatePnl,
  type EquityPoint,
} from "@/lib/stats";
import { AppState, CashMove, Trade } from "@/lib/types";
import { supabase, supabaseConfigured } from "@/lib/supabase-browser";
import { useLocalStorageState } from "@/lib/use-local-storage";
import { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

type Filters = {
  asset: string;
  outcome: "all" | "win" | "loss";
  side: "all" | "long" | "short";
  dateFrom: string;
  dateTo: string;
};

type DraftTrade = {
  date: string;
  asset: string;
  side: "long" | "short";
  outcome: "win" | "loss";
  amount: number;
  note: string;
};

type DraftDeposit = {
  date: string;
  amount: number;
  note: string;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const defaultFilters: Filters = {
  asset: "all",
  outcome: "all",
  side: "all",
  dateFrom: "",
  dateTo: "",
};

const draftTemplate = (): DraftTrade => ({
  date: format(new Date(), "yyyy-MM-dd"),
  asset: "EURUSD",
  side: "long",
  outcome: "win",
  amount: 200,
  note: "",
});

const depositTemplate = (): DraftDeposit => ({
  date: format(new Date(), "yyyy-MM-dd"),
  amount: 1000,
  note: "",
});

const Card = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    className={clsx(
      "rounded-3xl border border-emerald-500/10 bg-gradient-to-br from-[#0a1410]/95 via-[#07100c]/95 to-[#0d1b12]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-emerald-500/5 backdrop-blur",
      className,
    )}
  >
    {children}
  </div>
);

const StatCard = ({
  label,
  value,
  helper,
  tone = "neutral",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "positive" | "negative" | "neutral";
}) => (
  <div className="rounded-2xl border border-emerald-500/10 bg-[#0d1b12]/80 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur">
    <p className="text-xs uppercase tracking-wide text-emerald-200/80">{label}</p>
    <div className="mt-2 flex flex-col gap-2">
      <span className="text-2xl font-semibold text-slate-50">{value}</span>
      {helper ? (
        <span
          className={clsx(
            "inline-flex w-fit max-w-full items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold",
            tone === "positive" &&
              "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20",
            tone === "negative" &&
              "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/20",
            tone === "neutral" && "bg-white/10 text-slate-300",
          )}
        >
          {tone === "positive" && <ArrowUpRight size={14} />}
          {tone === "negative" && <ArrowDownRight size={14} />}
          <span className="whitespace-normal leading-tight">{helper}</span>
        </span>
      ) : null}
    </div>
  </div>
);

const Pill = ({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) => (
  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
    <span className="text-slate-400">{label}</span> <span className="text-slate-100">{value}</span>
  </span>
);

const TagBadge = ({ label }: { label?: string }) =>
  label ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-xs font-medium text-slate-200">
      <Tag size={12} />
      {label}
    </span>
  ) : null;

type EquityTooltipProps = TooltipProps<number, string> & {
  payload?: { payload: EquityPoint }[];
};

const EquityTooltip = ({ active, payload }: EquityTooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as EquityPoint;
  return (
    <div className="rounded-xl border border-white/10 bg-[#0f131c] px-3 py-2 shadow-lg">
      <p className="text-sm font-semibold text-slate-50">
        {format(parseISO(point.date), "dd MMM yyyy")}
      </p>
      <p className="text-sm text-slate-300">P&L : {currency.format(point.pnl)}</p>
      <p className="text-sm text-emerald-300">
        Equity : {currency.format(point.value)}
      </p>
    </div>
  );
};

const Heatmap = ({
  dailyPnls,
  start,
  end,
}: {
  dailyPnls: Record<string, number>;
  start: Date;
  end: Date;
}) => {
  const normalizedStart = startOfWeek(start, { weekStartsOn: 1 });
  const normalizedEnd = endOfWeek(end, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: normalizedStart, end: normalizedEnd });
  const weeks: Date[][] = [];

  days.forEach((day, index) => {
    const weekIndex = Math.floor(index / 7);
    if (!weeks[weekIndex]) weeks[weekIndex] = [];
    weeks[weekIndex].push(day);
  });

  const maxAbs = Math.max(
    0,
    ...Object.values(dailyPnls).map((value) => Math.abs(value)),
  );

  const colorFor = (value?: number) => {
    if (value === undefined || value === 0) return "#1f2937";
    const intensity = maxAbs ? Math.min(1, Math.abs(value) / maxAbs) : 0.2;
    const alpha = 0.18 + intensity * 0.6;
    if (value > 0) {
      return `rgba(82, 227, 173, ${alpha})`;
    }
    return `rgba(248, 113, 113, ${alpha})`;
  };

  return (
    <div className="flex gap-2 overflow-x-auto">
      {weeks.map((week, idx) => (
        <div key={idx} className="grid grid-rows-7 gap-1">
          {week.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const value = dailyPnls[key];
            return (
              <div
                key={key}
                title={`${format(day, "dd MMM")}: ${
                  value ? currency.format(value) : "0 €"
                }`}
                className="h-3.5 w-3.5 rounded-[6px] border border-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
                style={{ background: colorFor(value) }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};

const TinyStat = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-sm text-slate-300">
    <p className="text-[12px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="text-lg font-semibold text-slate-50">{value}</p>
  </div>
);

export default function HomePage() {
  const [rawState, setState, hydrated] = useLocalStorageState<AppState | Trade[]>(
    "reflect-trades",
    { trades: [], deposits: [] },
  );
  const [, setLoadingRemote] = useState(true);
  const [errorRemote, setErrorRemote] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [sortBy, setSortBy] = useState<"date" | "pnl">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [draft, setDraft] = useState<DraftTrade>(draftTemplate());
  const [depositDraft, setDepositDraft] = useState<DraftDeposit>(depositTemplate());
  const [actionTab, setActionTab] = useState<"trade" | "deposit">("trade");
  const actionRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);

  const state: AppState = useMemo(() => {
    if (Array.isArray(rawState)) {
      return { trades: rawState, deposits: [] };
    }
    return rawState;
  }, [rawState]);

  const trades = state.trades;
  const deposits = state.deposits;

  const filteredTrades = useMemo(() => {
    return trades
      .filter((trade) => {
        if (filters.asset !== "all" && trade.asset !== filters.asset) return false;
        if (filters.side !== "all" && trade.side !== filters.side) return false;
        if (filters.outcome !== "all" && trade.outcome !== filters.outcome) return false;
        if (filters.dateFrom && parseISO(trade.date) < parseISO(filters.dateFrom))
          return false;
        if (filters.dateTo && parseISO(trade.date) > parseISO(filters.dateTo))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "date") {
          const diff = parseISO(a.date).getTime() - parseISO(b.date).getTime();
          return sortDir === "asc" ? diff : -diff;
        }
        const pnlDiff = calculatePnl(a) - calculatePnl(b);
        return sortDir === "asc" ? pnlDiff : -pnlDiff;
      });
  }, [filters, sortBy, sortDir, trades]);

  const metrics = useMemo(
    () => calculateMetrics(filteredTrades),
    [filteredTrades],
  );

  const equityCurve = useMemo(
    () => buildEquityCurve(filteredTrades, deposits),
    [deposits, filteredTrades],
  );

  const dailyPnls = useMemo(
    () => aggregateDailyPnl(filteredTrades),
    [filteredTrades],
  );

  const totalDeposits = useMemo(
    () => deposits.reduce((acc, d) => acc + d.amount, 0),
    [deposits],
  );
  const netCapital = totalDeposits + metrics.netPnl;

  const dateValues = filteredTrades.map((trade) => parseISO(trade.date));
  const maxDate = dateValues.length
    ? new Date(Math.max(...dateValues.map((d) => d.getTime())))
    : new Date();
  const minDate = dateValues.length
    ? new Date(Math.min(...dateValues.map((d) => d.getTime())))
    : subDays(new Date(), 60);
  const heatmapStart = (() => {
    const suggested = subDays(maxDate, 56);
    return suggested < minDate ? minDate : suggested;
  })();

  const pnlTrend =
    equityCurve.length >= 2
      ? equityCurve[equityCurve.length - 1].value -
        equityCurve[Math.max(0, equityCurve.length - 4)].value
      : 0;

  const unique = {
    assets: Array.from(new Set(trades.map((t) => t.asset))),
  };

  const winCount = filteredTrades.filter((t) => t.outcome === "win").length;
  const lossCount = filteredTrades.filter((t) => t.outcome === "loss").length;
  const outcomeTotal = winCount + lossCount;
  const winShare = outcomeTotal ? Math.round((winCount / outcomeTotal) * 100) : 0;
  const lossShare = outcomeTotal ? 100 - winShare : 0;

  const handleScrollToActions = () =>
    actionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const handleSignOut = async () => {
    if (!supabase || !supabaseConfigured) return;
    await supabase.auth.signOut();
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.asset || !draft.date || !draft.amount) return;
    if (!session || !supabase || !supabaseConfigured) {
      setErrorRemote("Connectez-vous pour enregistrer un trade.");
      return;
    }

    const trade: Omit<Trade, "id"> = {
      date: draft.date,
      asset: draft.asset.trim().toUpperCase(),
      side: draft.side,
      outcome: draft.outcome,
      amount: Number(draft.amount),
      note: draft.note,
    };

    const run = async () => {
      const client = supabase;
      if (!client) return;
      const { data, error } = await client
        .from("trades")
        .insert({ ...trade, user_id: session.user.id })
        .select()
        .single();
      if (error || !data) {
        console.error("Insertion trade supabase", error);
        setErrorRemote("Impossible d'enregistrer le trade (Supabase)");
        return;
      }
      setState((prev) => {
        const current = Array.isArray(prev)
          ? { trades: prev, deposits: [] }
          : prev;
        return { ...current, trades: [...current.trades, data as Trade] };
      });
      setDraft((prev) => ({ ...draftTemplate(), asset: prev.asset }));
    };

    run();
  };

  const handleDeposit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!depositDraft.amount) return;
    if (!session || !supabase || !supabaseConfigured) {
      setErrorRemote("Connectez-vous pour enregistrer un dépôt.");
      return;
    }
    const deposit: Omit<CashMove, "id"> = {
      date: depositDraft.date,
      amount: Number(depositDraft.amount),
      note: depositDraft.note?.trim() || undefined,
    };
    const run = async () => {
      const client = supabase;
      if (!client) return;
      const { data, error } = await client
        .from("deposits")
        .insert({ ...deposit, user_id: session.user.id })
        .select()
        .single();
      if (error || !data) {
        console.error("Insertion dépôt supabase", error);
        setErrorRemote("Impossible d'enregistrer le dépôt (Supabase)");
        return;
      }
      setState((prev) => {
        const current = Array.isArray(prev)
          ? { trades: prev, deposits: [] }
          : prev;
        return { ...current, deposits: [...current.deposits, data as CashMove] };
      });
      setDepositDraft(depositTemplate());
    };
    run();
  };

  const deleteTrade = async (id: string) => {
    const client = supabase;
    if (session && client && supabaseConfigured) {
      const { error } = await client
        .from("trades")
        .delete()
        .eq("id", id)
        .eq("user_id", session.user.id);
      if (error) {
        console.error("Suppression trade supabase", error);
        setErrorRemote("Impossible de supprimer le trade (Supabase)");
        return;
      }
    }
    setState((prev) => {
      const current = Array.isArray(prev) ? { trades: prev, deposits: [] } : prev;
      return { ...current, trades: current.trades.filter((t) => t.id !== id) };
    });
  };

  const deleteDeposit = async (id: string) => {
    const client = supabase;
    if (session && client && supabaseConfigured) {
      const { error } = await client
        .from("deposits")
        .delete()
        .eq("id", id)
        .eq("user_id", session.user.id);
      if (error) {
        console.error("Suppression dépôt supabase", error);
        setErrorRemote("Impossible de supprimer le dépôt (Supabase)");
        return;
      }
    }
    setState((prev) => {
      const current = Array.isArray(prev) ? { trades: prev, deposits: [] } : prev;
      return { ...current, deposits: current.deposits.filter((d) => d.id !== id) };
    });
  };

  const handleClear = () => setState({ trades: [], deposits: [] });
  const handleResetFilters = () => setFilters(defaultFilters);

  useEffect(() => {
    const loadRemote = async () => {
      if (!session || !supabase || !supabaseConfigured) return;
      setLoadingRemote(true);
      setErrorRemote(null);
      const userId = session.user.id;
      const [{ data: tradesData, error: tradesErr }, { data: depositsData, error: depErr }] =
        await Promise.all([
          supabase
            .from("trades")
            .select("*")
            .eq("user_id", userId)
            .order("date", { ascending: true }),
          supabase
            .from("deposits")
            .select("*")
            .eq("user_id", userId)
            .order("date", { ascending: true }),
        ]);
      if (tradesErr || depErr) {
        const error = tradesErr ?? depErr;
        console.error("Lecture supabase", error?.message ?? error);
        setErrorRemote("Lecture Supabase impossible, utilisation des données locales.");
        setLoadingRemote(false);
        return;
      }
      setState({ trades: tradesData ?? [], deposits: depositsData ?? [] });
      setLoadingRemote(false);
    };
    loadRemote();
  }, [session, setState]);

  useEffect(() => {
    if (!supabase || !supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !supabaseConfigured) {
      setAuthError("Supabase n'est pas configuré (URL/clé manquants).");
      return;
    }
    setAuthError(null);
    setAuthInfo(null);
    setAuthLoading(true);
    try {
      if (authMode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        if (!data.session) {
          setAuthInfo("Compte créé. Vérifiez votre email pour confirmer et vous connecter.");
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur d'authentification";
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
  };

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 px-6 pb-12 pt-12 text-slate-100">
        <header className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0d1118] via-[#0b0f16] to-[#0d1118] p-6 text-white shadow-[0_25px_80px_rgba(0,0,0,0.45)] ring-1 ring-white/5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(122,247,197,0.18),transparent_30%),radial-gradient(circle_at_90%_10%,rgba(59,130,246,0.2),transparent_25%)]" />
          <div className="relative space-y-2">
            <div className="flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-emerald-200">
              <Sparkles size={16} />
              Reflect
            </div>
            <h1 className="text-3xl font-semibold">Espace sécurisé</h1>
            <p className="text-sm text-slate-300">
              Connectez-vous pour synchroniser vos mouvements (trades et dépôts) sur Supabase.
            </p>
          </div>
        </header>

        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold text-slate-50">
              {authMode === "signin" ? "Se connecter" : "Créer un compte"}
            </p>
            <button
              onClick={() => setAuthMode((m) => (m === "signin" ? "signup" : "signin"))}
              className="text-sm text-emerald-200 hover:text-emerald-100"
            >
              {authMode === "signin" ? "Créer un compte" : "Déjà un compte ?"}
            </button>
          </div>
          <form onSubmit={handleAuth} className="space-y-3">
            <InputField
              label="Email"
              value={authEmail}
              onChange={setAuthEmail}
              type="email"
              placeholder="you@example.com"
            />
            <InputField
              label="Mot de passe"
              value={authPassword}
              onChange={setAuthPassword}
              type="password"
              placeholder="••••••••"
            />
            {authError ? (
              <p className="text-sm text-rose-300">{authError}</p>
            ) : null}
            {authInfo ? <p className="text-sm text-emerald-200">{authInfo}</p> : null}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-[0_10px_25px_rgba(16,185,129,0.3)] transition hover:-translate-y-[1px] hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {authLoading
                ? "En cours..."
                : authMode === "signin"
                  ? "Se connecter"
                  : "Créer un compte"}
            </button>
          </form>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="sticky top-0 z-20 mb-6">
        <div className="flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-[#0c1811]/90 px-4 py-3 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/30 via-emerald-500/10 to-transparent text-lg font-semibold text-emerald-100 ring-1 ring-emerald-500/40">
              R
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-emerald-200/90">Reflect</p>
              <p className="text-sm text-slate-300">Performance trader privée</p>
            </div>
          </div>
          <nav className="hidden items-center gap-2 text-sm font-semibold text-slate-200 md:flex">
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-100">Dashboard</span>
            <span className="rounded-full px-3 py-1 hover:bg-white/5">Journal</span>
            <span className="rounded-full px-3 py-1 hover:bg-white/5">Analytics</span>
            <span className="rounded-full px-3 py-1 hover:bg-white/5">Paramètres</span>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={handleScrollToActions}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-[0_12px_28px_rgba(16,185,129,0.35)] transition hover:-translate-y-[1px] hover:bg-emerald-400"
            >
              <Plus size={16} />
              Ajouter un événement
            </button>
            <button
              onClick={handleSignOut}
              className="hidden rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-400/40 hover:text-emerald-100 sm:inline-flex"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(25,226,122,0.16),transparent_35%),radial-gradient(circle_at_85%_0%,rgba(16,185,129,0.14),transparent_32%)]" />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-500/30">
                <Sparkles size={14} />
                Vue d'ensemble
              </div>
              <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-4xl">
                Tableau de bord Reflect
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Suivi unifié des trades, dépôts et indicateurs clés. Pensé pour remplacer définitivement ton tableur.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                  <BadgeCheck size={12} className="inline me-1" />
                  Données privées
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                  <Flame size={12} className="inline me-1" />
                  Serial trader
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/15 bg-[#0c1811]/70 p-4 text-sm shadow-inner">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/90">Net P&L</p>
                  <p className={clsx("text-2xl font-semibold", metrics.netPnl >= 0 ? "text-emerald-200" : "text-rose-200")}>
                    {currency.format(metrics.netPnl)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/90">Capital</p>
                  <p className="text-2xl font-semibold text-slate-50">{currency.format(netCapital)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <LineChart size={14} className="text-emerald-300" />
                {pnlTrend === 0
                  ? "Stabilité récente"
                  : `${pnlTrend > 0 ? "+" : ""}${currency.format(pnlTrend)} sur les derniers mouvements`}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <BadgeCheck size={14} className="text-emerald-300" />
                {session.user.email}
              </div>
              <button
                onClick={handleScrollToActions}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/15"
              >
                Ajouter un trade ou un dépôt
              </button>
            </div>
          </div>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(25,226,122,0.1),transparent_40%)]" />
          <div className="relative flex flex-col gap-3">
            <p className="text-sm text-slate-400">Synchronisation Supabase</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-slate-50">Session active</p>
                <p className="text-sm text-slate-300">{session.user.email}</p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-500/30">
                Connecté
              </span>
            </div>
            {errorRemote ? (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {errorRemote}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100">
                Données synchronisées sur Supabase et conservées en local.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <TinyStat label="Trades" value={`${trades.length}`} />
              <TinyStat label="Dépôts" value={`${deposits.length}`} />
              <TinyStat label="Win rate" value={`${metrics.winRate.toFixed(1)}%`} />
              <TinyStat label="Capital net" value={currency.format(netCapital)} />
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Net P&L"
          value={currency.format(metrics.netPnl)}
          helper={
            pnlTrend === 0
              ? undefined
              : `${pnlTrend > 0 ? "+" : ""}${currency.format(pnlTrend)} vs derniers trades`
          }
          tone={metrics.netPnl >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Capital net"
          value={currency.format(netCapital)}
          helper={`Dépôts ${currency.format(totalDeposits)}`}
          tone={netCapital >= 0 ? "positive" : "neutral"}
        />
        <StatCard
          label="Win rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          helper={`${winCount} gains / ${lossCount} pertes`}
          tone={metrics.winRate >= 50 ? "positive" : "neutral"}
        />
        <StatCard
          label="Profit factor"
          value={metrics.profitFactor ? metrics.profitFactor.toFixed(2) : "–"}
          helper=">1 = profitable"
          tone={
            metrics.profitFactor && metrics.profitFactor >= 1 ? "positive" : "neutral"
          }
        />
        <StatCard
          label="Max drawdown"
          value={currency.format(metrics.maxDrawdown)}
          helper="Creux cumulé"
          tone={metrics.maxDrawdown > 0 ? "negative" : "neutral"}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Courbe d'equity</p>
              <p className="text-xl font-semibold text-slate-50">Performance historique</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill label="Trades" value={filteredTrades.length} />
              <Pill label="Dépôts" value={deposits.length} />
              <Pill label="P&L net" value={currency.format(metrics.netPnl)} />
            </div>
          </div>
          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityCurve}>
                <defs>
                  <linearGradient id="pnl" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0.08} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#153220" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => format(parseISO(value), "dd MMM")}
                  tick={{ fill: "#9bb8a7", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value) => currency.format(value).replace("$", "")}
                  tick={{ fill: "#9bb8a7", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip content={<EquityTooltip />} />
                <Area
                  dataKey="value"
                  stroke="#22c55e"
                  fill="url(#pnl)"
                  strokeWidth={2.4}
                  type="monotone"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-300">
            <TagBadge label={`Max drawdown ${currency.format(metrics.maxDrawdown)}`} />
            <TagBadge
              label={
                metrics.averageWin
                  ? `Gain moyen ${currency.format(metrics.averageWin)}`
                  : undefined
              }
            />
            <TagBadge
              label={
                metrics.averageLoss
                  ? `Perte moyenne ${currency.format(Math.abs(metrics.averageLoss))}`
                  : undefined
              }
            />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Répartition</p>
              <p className="text-lg font-semibold text-slate-50">Issues & risques</p>
            </div>
            <Tag size={18} className="text-emerald-300" />
          </div>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative mx-auto h-40 w-40">
              <div
                className="absolute inset-0 rounded-full border border-emerald-500/20 bg-[conic-gradient(#22c55e_0deg,#22c55e_var(--win),#1a2c22_var(--win),#1a2c22_360deg)] shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
                style={{ ["--win" as string]: `${(winShare / 100) * 360}deg` }}
              />
              <div className="absolute inset-4 rounded-full border border-white/5 bg-[#0d1b12]/90 flex flex-col items-center justify-center text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Win rate</p>
                <p className="text-2xl font-semibold text-slate-50">{winShare}%</p>
                <p className="text-[11px] text-slate-400">{winCount} gains / {lossCount} pertes</p>
              </div>
            </div>
            <div className="flex-1 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Trades totaux</span>
                <span className="font-semibold text-slate-50">{filteredTrades.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Dépôts cumulés</span>
                <span className="font-semibold text-slate-50">{currency.format(totalDeposits)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Profit factor</span>
                <span className="font-semibold text-slate-50">
                  {metrics.profitFactor ? metrics.profitFactor.toFixed(2) : "–"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Max drawdown</span>
                <span className="font-semibold text-rose-200">{currency.format(metrics.maxDrawdown)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" /> Gagnants ({winShare}%)
                <span className="inline-flex h-2 w-2 rounded-full bg-rose-400" /> Perdants ({lossShare}%)
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Journal des trades</p>
              <p className="text-xl font-semibold text-slate-50">Vue tabulaire & suppression</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <button
                onClick={() => {
                  setSortBy("date");
                  setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                }}
                className={clsx(
                  "rounded-full border px-3 py-1 font-semibold",
                  sortBy === "date"
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 text-slate-200",
                )}
              >
                Trier par date ({sortDir === "asc" ? "↑" : "↓"})
              </button>
              <button
                onClick={() => {
                  setSortBy("pnl");
                  setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                }}
                className={clsx(
                  "rounded-full border px-3 py-1 font-semibold",
                  sortBy === "pnl"
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 text-slate-200",
                )}
              >
                Trier par P&L ({sortDir === "asc" ? "↑" : "↓"})
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            <SelectField
              label="Actif"
              value={filters.asset}
              onChange={(value) => setFilters((prev) => ({ ...prev, asset: value }))}
              options={unique.assets}
            />
            <SelectField
              label="Résultat"
              value={filters.outcome}
              onChange={(value) => setFilters((prev) => ({ ...prev, outcome: value }))}
              options={["win", "loss"]}
            />
            <SelectField
              label="Côté"
              value={filters.side}
              onChange={(value) => setFilters((prev) => ({ ...prev, side: value }))}
              options={["long", "short"]}
            />
            <InputField
              label="Du"
              type="date"
              value={filters.dateFrom}
              onChange={(value) => setFilters((prev) => ({ ...prev, dateFrom: value }))}
            />
            <InputField
              label="Au"
              type="date"
              value={filters.dateTo}
              onChange={(value) => setFilters((prev) => ({ ...prev, dateTo: value }))}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={handleResetFilters}
              className="rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-200 hover:border-white/20"
            >
              Réinitialiser les filtres
            </button>
            <button
              onClick={handleClear}
              className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/15"
            >
              <Trash2 size={15} />
              Tout vider
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-separate border-spacing-y-2 text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="text-left">Ticker</th>
                  <th className="text-left">Date</th>
                  <th className="text-left">Côté</th>
                  <th className="text-left">Résultat</th>
                  <th className="text-left">Montant</th>
                  <th className="text-left">P&L net</th>
                  <th className="text-left">Note</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-4 text-center text-sm text-slate-400">
                      Aucun trade pour ces filtres. Ajuste les sélecteurs ou ajoute un nouveau trade.
                    </td>
                  </tr>
                ) : (
                  filteredTrades.map((trade) => {
                    const pnl = calculatePnl(trade);
                    return (
                      <tr
                        key={trade.id}
                        className="rounded-2xl border border-emerald-500/10 bg-[#0d1b12]/80 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
                      >
                        <td className="rounded-l-2xl px-3 py-3 font-semibold text-slate-50">
                          {trade.asset}
                        </td>
                        <td className="px-3 py-3 text-slate-300">
                          {format(parseISO(trade.date), "dd MMM yyyy")}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={clsx(
                              "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                              trade.side === "long"
                                ? "bg-emerald-500/15 text-emerald-100"
                                : "bg-rose-500/15 text-rose-100",
                            )}
                          >
                            {trade.side}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={clsx(
                              "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                              trade.outcome === "win"
                                ? "bg-emerald-500/15 text-emerald-100"
                                : "bg-rose-500/15 text-rose-100",
                            )}
                          >
                            {trade.outcome === "win" ? "Gagnant" : "Perdant"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-200">{currency.format(trade.amount)}</td>
                        <td
                          className={clsx(
                            "px-3 py-3 font-semibold",
                            pnl >= 0 ? "text-emerald-300" : "text-rose-300",
                          )}
                        >
                          {pnl >= 0 ? "+" : ""}
                          {currency.format(pnl)}
                        </td>
                        <td className="px-3 py-3 text-slate-300 max-w-[180px]">
                          {trade.note || "—"}
                        </td>
                        <td className="rounded-r-2xl px-3 py-3 text-right">
                          <button
                            onClick={() => deleteTrade(trade.id)}
                            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 hover:border-rose-400/50 hover:bg-rose-500/15 hover:text-rose-100"
                            title="Supprimer le trade"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Dépôts</p>
                <p className="text-lg font-semibold text-slate-50">Historique des apports</p>
              </div>
              <Pill label="Total" value={currency.format(totalDeposits)} />
            </div>
            <div className="mt-3 space-y-2">
              {deposits.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-400">
                  Aucun dépôt enregistré pour l'instant.
                </div>
              ) : (
                deposits
                  .slice()
                  .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())
                  .map((deposit) => (
                    <div
                      key={deposit.id}
                      className="flex items-center justify-between rounded-2xl border border-emerald-500/10 bg-[#0d1b12]/80 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-100">
                          {format(parseISO(deposit.date), "dd MMM")}
                        </span>
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-50">Dépôt</span>
                          <span className="text-xs text-slate-400">{deposit.note || "—"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-emerald-300">
                          +{currency.format(deposit.amount)}
                        </span>
                        <button
                          onClick={() => deleteDeposit(deposit.id)}
                          className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 hover:border-rose-400/50 hover:bg-rose-500/15 hover:text-rose-100"
                          title="Supprimer le dépôt"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Heatmap</p>
                <p className="text-lg font-semibold text-slate-50">Jours gagnants / perdants</p>
              </div>
              <BarChart3 className="text-emerald-300" />
            </div>
            <div className="mt-3">
              <Heatmap dailyPnls={dailyPnls} start={heatmapStart} end={maxDate} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Jours gagnants
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-400" />
                Jours perdants
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="actions" ref={actionRef} className="mt-6">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Saisie</p>
              <p className="text-xl font-semibold text-slate-50">Ajouter un trade ou un dépôt</p>
              <p className="text-sm text-slate-300">
                Formulaire compact inspiré du design pro : résultat, montant en USD et note optionnelle.
              </p>
            </div>
            <div className="flex gap-2 rounded-full border border-white/10 bg-white/5 p-1 text-xs font-semibold text-slate-200">
              <button
                onClick={() => setActionTab("trade")}
                className={clsx(
                  "rounded-full px-3 py-1 transition",
                  actionTab === "trade" ? "bg-emerald-400/20 text-emerald-100" : "",
                )}
              >
                Trade
              </button>
              <button
                onClick={() => setActionTab("deposit")}
                className={clsx(
                  "rounded-full px-3 py-1 transition",
                  actionTab === "deposit" ? "bg-emerald-400/20 text-emerald-100" : "",
                )}
              >
                Dépôt
              </button>
            </div>
          </div>

          {actionTab === "trade" ? (
            <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-3">
              <InputField
                label="Date"
                type="date"
                value={draft.date}
                onChange={(value) => setDraft((prev) => ({ ...prev, date: value }))}
              />
              <InputField
                label="Actif"
                value={draft.asset}
                onChange={(value) => setDraft((prev) => ({ ...prev, asset: value }))}
                placeholder="EURUSD"
              />
              <InputField
                label="Côté"
                value={draft.side}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, side: value as DraftTrade["side"] }))
                }
                options={["long", "short"]}
              />
              <InputField
                label="Résultat"
                value={draft.outcome}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, outcome: value as DraftTrade["outcome"] }))
                }
                options={["win", "loss"]}
              />
              <InputField
                label="Montant (USD)"
                type="number"
                value={draft.amount}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, amount: Number(value) || 0 }))
                }
              />
              <div className="md:col-span-3">
                <label className="text-sm font-medium text-slate-200">Note</label>
                <textarea
                  value={draft.note}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, note: e.target.value.slice(0, 180) }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-white/20 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                  rows={3}
                  placeholder="Contexte, émotion, choses à revoir..."
                />
              </div>
              <div className="md:col-span-3 flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-[0_12px_25px_rgba(16,185,129,0.3)] transition hover:-translate-y-[1px] hover:bg-emerald-400"
                >
                  <Plus size={16} />
                  Enregistrer le trade
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(draftTemplate())}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-white/20"
                >
                  Réinitialiser
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleDeposit} className="grid gap-3 md:grid-cols-3">
              <InputField
                label="Date"
                type="date"
                value={depositDraft.date}
                onChange={(value) => setDepositDraft((prev) => ({ ...prev, date: value }))}
              />
              <InputField
                label="Montant"
                type="number"
                value={depositDraft.amount}
                onChange={(value) =>
                  setDepositDraft((prev) => ({ ...prev, amount: Number(value) || 0 }))
                }
              />
              <InputField
                label="Note (opt.)"
                value={depositDraft.note}
                onChange={(value) => setDepositDraft((prev) => ({ ...prev, note: value }))}
                placeholder="Depot, virement..."
                required={false}
              />
              <div className="md:col-span-3 flex gap-2">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-[0_12px_25px_rgba(16,185,129,0.3)] transition hover:-translate-y-[1px] hover:bg-emerald-400"
                >
                  <Plus size={16} />
                  Enregistrer le dépôt
                </button>
                <button
                  type="button"
                  onClick={() => setDepositDraft(depositTemplate())}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-white/20"
                >
                  Réinitialiser
                </button>
              </div>
            </form>
          )}
        </Card>
      </section>

      {!hydrated && (
        <div className="mt-4 text-center text-sm text-slate-500">
          Chargement des données locales...
        </div>
      )}
    </main>
  );
}

const SelectField = <T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm font-medium text-slate-200">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-white/20 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
    >
      <option value="all">Tous</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </div>
);

const InputField = ({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  step,
  required = true,
  options,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  step?: string;
  required?: boolean;
  options?: string[];
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm font-medium text-slate-200">{label}</label>
    {options ? (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-white/20 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    ) : (
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        placeholder={placeholder}
        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-white/20 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
        required={required}
      />
    )}
  </div>
);
