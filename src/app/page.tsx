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
  Filter,
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
      "rounded-3xl border border-white/5 bg-gradient-to-br from-[#0f131c]/90 via-[#0b0f17]/90 to-[#0f131c]/90 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur",
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
  <div className="rounded-2xl border border-white/5 bg-white/5 p-4 backdrop-blur">
    <p className="text-sm text-slate-400">{label}</p>
    <div className="mt-2 flex flex-col gap-2">
      <span className="text-2xl font-semibold text-slate-50">{value}</span>
      {helper ? (
        <span
          className={clsx(
            "inline-flex w-fit max-w-full items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
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
  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
    {label}: {value}
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
  const [, setErrorRemote] = useState<string | null>(null);
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

  const handleSignOut = async () => {
    if (supabase && supabaseConfigured) {
      await supabase.auth.signOut();
    }
    setState({ trades: [], deposits: [] });
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
            <h1 className="text-3xl font-semibold">Connexion requise</h1>
            <p className="text-sm text-slate-300">
              Connectez-vous pour sauvegarder vos trades et dépôts sur Supabase.
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
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-14 pt-8 text-slate-100 sm:px-6">
      <header className="relative overflow-hidden rounded-[30px] bg-gradient-to-r from-[#0d1118] via-[#0b0f16] to-[#0d1118] p-6 text-white shadow-[0_25px_80px_rgba(0,0,0,0.45)] ring-1 ring-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(122,247,197,0.18),transparent_30%),radial-gradient(circle_at_90%_10%,rgba(59,130,246,0.2),transparent_25%)]" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-[#1a2233] to-[#0b101a] text-xl font-semibold shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
              R
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-emerald-200">
                <Sparkles size={16} />
                Reflect
              </div>
              <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
                Journal de trading personnel
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">
                Une vue immersive pour suivre vos entrées, vos dépôts et vos métriques clés.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                  <BadgeCheck size={12} className="inline me-1" />
                  Profil privé
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                  <Flame size={12} className="inline me-1" />
                  Serial trader
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Déconnexion
            </button>
            <a
              href="#actions"
              onClick={(e) => {
                e.preventDefault();
                actionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="flex items-center gap-2 rounded-xl bg-[#7af7c5] px-5 py-3 text-sm font-semibold text-[#0b0d13] shadow-[0_12px_30px_rgba(122,247,197,0.35)] transition hover:-translate-y-[1px] hover:shadow-[0_16px_40px_rgba(122,247,197,0.45)]"
            >
              <Plus size={16} />
              Ajouter un mouvement
            </a>
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">

          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm font-semibold text-slate-200">
                <Filter size={16} />
                Filtres & tri
              </div>
              <Pill label="Actif" value={filters.asset === "all" ? "Tous" : filters.asset} />
              <Pill
                label="Résultat"
                value={filters.outcome === "all" ? "Tous" : filters.outcome}
              />
              <Pill label="Côté" value={filters.side === "all" ? "Tous" : filters.side} />
              <div className="ms-auto flex gap-2">
                <button
                  onClick={handleResetFilters}
                  className="rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-200 hover:border-white/20"
                >
                  Reset filtres
                </button>
                <button
                  onClick={handleClear}
                  className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/15"
                >
                  <Trash2 size={15} />
                  Tout vider
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
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
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
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
          </Card>

          <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Journal</p>
              <p className="text-xl font-semibold text-slate-50">
                {filteredTrades.length} trades filtrés
              </p>
            </div>
            <div className="flex gap-2">
              <TinyStat label="Net P&L" value={currency.format(metrics.netPnl)} />
              <TinyStat label="Capital net" value={currency.format(netCapital)} />
            </div>
          </div>
          {errorRemote ? (
            <div className="mt-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {errorRemote}
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {filteredTrades.length === 0 && (
              <div className="flex items-center justify-between rounded-2xl border border-dashed border-white/10 px-3 py-3 text-sm text-slate-400">
                Aucun trade pour ces filtres. Ajustez le moteur de tri ou ajoutez un trade.
              </div>
            )}
            {filteredTrades.map((trade) => {
              const pnl = calculatePnl(trade);
              return (
                <div
                  key={trade.id}
                  className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.35)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <span
                          className={clsx(
                            "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold",
                            pnl >= 0
                              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                              : "border-rose-400/40 bg-rose-400/10 text-rose-200",
                          )}
                        >
                          {trade.asset.slice(0, 3)}
                        </span>
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
                            {trade.asset}
                            <span
                              className={clsx(
                                "rounded-full px-2 py-1 text-[11px] font-semibold tracking-wide",
                                trade.side === "long"
                                  ? "bg-emerald-400/10 text-emerald-200"
                                  : "bg-rose-400/10 text-rose-200",
                              )}
                            >
                              {trade.side}
                            </span>
                            <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300">
                              {format(parseISO(trade.date), "dd MMM")}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">
                            Résultat: {trade.outcome === "win" ? "Gain" : "Perte"}
                          </p>
                          {trade.note ? (
                            <p className="mt-1 text-xs text-slate-500">Note : {trade.note}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => deleteTrade(trade.id)}
                          className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 hover:border-rose-400/50 hover:bg-rose-500/15 hover:text-rose-100"
                          title="Supprimer le trade"
                        >
                          <Trash2 size={14} />
                        </button>
                        <div className="text-right">
                          <span
                            className={clsx(
                              "text-lg font-semibold",
                              pnl >= 0 ? "text-emerald-300" : "text-rose-300",
                            )}
                          >
                            {pnl >= 0 ? "+" : ""}
                            {currency.format(pnl)}
                          </span>
                          <p className="text-[11px] text-slate-400">Net</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Tableau de bord</p>
                <p className="text-xl font-semibold text-slate-50">Performance globale</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                <LineChart size={14} />
                {filteredTrades.length} trades
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                helper={`${metrics.totalTrades} trades`}
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
            </div>
            <div className="mt-4 h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurve}>
                  <defs>
                    <linearGradient id="pnl" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#7af7c5" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#7af7c5" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) => format(parseISO(value), "dd MMM")}
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) => currency.format(value).replace("€", "")}
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                  />
                  <Tooltip content={<EquityTooltip />} />
                  <Area
                    dataKey="value"
                    stroke="#7af7c5"
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
                <p className="text-sm text-slate-400">Heatmap</p>
                <p className="text-lg font-semibold text-slate-50">
                  Jours gagnants / perdants
                </p>
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

          <div id="actions" ref={actionRef}>
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Actions rapides</p>
                  <p className="text-lg font-semibold text-slate-50">
                    Ajouter un trade ou un dépôt
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
                <SelectField
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
                    rows={2}
                    placeholder="Contexte, émotions, choses à revoir..."
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

            <div className="mt-4 space-y-2">
              {deposits
                .slice()
                .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())
                .slice(0, 4)
                .map((deposit) => (
                  <div
                    key={deposit.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-semibold text-slate-200">
                        {format(parseISO(deposit.date), "dd MMM")}
                      </span>
                      <span>Dépôt</span>
                      {deposit.note ? (
                        <span className="text-xs text-slate-400">• {deposit.note}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => deleteDeposit(deposit.id)}
                        className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 hover:border-rose-400/50 hover:bg-rose-500/15 hover:text-rose-100"
                        title="Supprimer le dépôt"
                      >
                        <Trash2 size={14} />
                      </button>
                      <span className="text-sm font-semibold text-emerald-300">
                        +{currency.format(deposit.amount)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            </Card>
          </div>
        </div>
      </section>

      {!hydrated && (
        <div className="text-center text-sm text-slate-500">
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
