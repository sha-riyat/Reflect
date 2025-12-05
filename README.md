# Reflect — Trackrecord trader personnel

Reflect est une web app Next.js (App Router) pensée pour remplacer un fichier Excel et suivre vos performances de trading en un clin d’œil.

## Fonctionnalités
- Entrée manuelle ultra rapide : date, actif, côté, taille, prix d’entrée/sortie, frais, tags (stratégie, setup, erreur, session), note.
- Dashboard visuel : equity curve, heatmap calendrier façon GitHub, net P&L, cartes KPI (win rate, R:R, profit factor, max drawdown, moyennes gain/perte).
- Moteur de tri & tags : filtres par actif, stratégie, setup, erreur, session, côté et plage de dates, tri par date ou P&L.
- Gestion du solde : ajoutez vos dépôts (capital) sans impacter le P&L pour visualiser le capital net.
- Persistance : Supabase (trades/dépôts) si les clés sont présentes, sinon fallback `localStorage` (sans données d’exemple).
- Design épuré inspiré de Finary, prêt pour un déploiement Vercel.
- Authentification : Supabase Auth email/mot de passe (formulaire sur la page, bouton de déconnexion).

## Démarrage
```bash
npm install
npm run dev
# puis ouvrir http://localhost:3000
```

## Déploiement Vercel (via GitHub)
1. Commitez/poussez ce repo sur GitHub.
2. Sur Vercel, importez le repo et sélectionnez le framework Next.js.
3. Dans les variables d’environnement Vercel, ajoutez :
   - `NEXT_PUBLIC_SUPABASE_URL=https://rytehmfnqwnuqrpykilb.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dGVobWZucXdudXFycHlraWxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4ODcwMjQsImV4cCI6MjA4MDQ2MzAyNH0.CsY0TerI6H4KiGCdhKhLozjEkceZKS6kCp_74eeQgng`
4. Déployez. Les données sont lues/écrites sur Supabase (tables `trades`/`deposits` avec RLS `user_id = auth.uid()`).

## Supabase
- Créez deux tables (types UUID) :
  - `trades`: `id uuid default uuid_generate_v4() primary key`, `user_id uuid references auth.users`, `date date`, `asset text`, `side text`, `outcome text`, `amount numeric`, `note text`.
  - `deposits`: `id uuid default uuid_generate_v4() primary key`, `user_id uuid references auth.users`, `date date`, `amount numeric`, `note text`.
- Ajoutez un index sur `date` pour chaque table.
- Activez les RLS et ajoutez des policies pour que chaque utilisateur ne lise/écrive/supprime que ses lignes (`user_id = auth.uid()`), par ex. :
  ```sql
  alter table trades enable row level security;
  alter table deposits enable row level security;

  create policy "trades_select_own" on trades for select using (auth.uid() = user_id);
  create policy "trades_insert_own" on trades for insert with check (auth.uid() = user_id);
  create policy "trades_delete_own" on trades for delete using (auth.uid() = user_id);

  create policy "deposits_select_own" on deposits for select using (auth.uid() = user_id);
  create policy "deposits_insert_own" on deposits for insert with check (auth.uid() = user_id);
  create policy "deposits_delete_own" on deposits for delete using (auth.uid() = user_id);
  ```
- Ajoutez un fichier `.env.local` :
  ```env
  NEXT_PUBLIC_SUPABASE_URL=https://votre-url.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=...anon...
  ```
- Les actions (ajout trade/dépôt) utilisent Supabase si les clés sont définies, sinon localStorage.

## Notes techniques
- Stack : Next.js 16, React 19, TypeScript, Tailwind v4, Recharts, date-fns, lucide-react.
- Configuration Vercel : déploiement standard Next.js, sans API ni base de données (données côté client uniquement).
- Fonts : Space Grotesk via `next/font`.

## Structure
- `src/app/page.tsx` : page principale (UI, formulaires, filtres, graphiques).
- `src/lib/stats.ts` : calculs P&L, equity, KPI.
- `src/lib/sample-data.ts` : jeu de données d’exemple.
- `src/lib/use-local-storage.ts` : hook de persistance locale.
