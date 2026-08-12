# Bourse

Suivi visuel de mes positions : une *treemap* où chaque ligne est un rectangle
dont la **taille** est son poids dans le portefeuille et la **couleur** sa
variation du jour.

👉 https://bulojs.github.io/Bourse/

Accès réservé au compte unique — il faut passer par
[Home](https://bulojs.github.io/Home/).

## Comment les cours arrivent ici

Il n'existe pas d'API boursière gratuite, sans compte, appelable depuis un
navigateur : les rares endpoints sans clé refusent les appels venus d'une page
web (CORS). Le contournement est une **GitHub Action** :

1. Chaque soir de semaine (18h05 UTC), l'action lit `data/tickers.json` ;
2. elle appelle Yahoo Finance **côté serveur**, où le CORS ne s'applique pas et
   où aucune clé n'est requise ;
3. elle écrit `data/cours.json` et le commite ;
4. le site lit simplement ce fichier.

Résultat : aucun compte, aucune clé dans la page, aucun coût, et le site reste
entièrement statique.

L'action se relance aussi à chaque modification de `data/tickers.json`, et à la
main depuis l'onglet Actions.

> **Cet endpoint Yahoo n'est pas officiel.** Il est stable depuis des années et
> toléré, mais rien ne le garantit. S'il tombe, les derniers cours connus sont
> conservés et la date affichée sous « Investi » cesse d'avancer — le tableau
> ne ment jamais avec des valeurs vides.

## Ajouter une ligne

Deux choses à faire, dans cet ordre :

1. **Dans la page**, bouton « + Ajouter une ligne » : ticker, quantité, prix de
   revient unitaire. C'est enregistré dans Supabase, donc synchronisé entre tes
   PC — et **pas** dans ce dépôt public.
2. **Dans `data/tickers.json`**, ajoute le ticker pour que son cours soit
   récupéré. La page te le rappelle en clair tant que ça n'est pas fait.

Le ticker est celui de Yahoo Finance :

| Marché | Exemple |
|---|---|
| États-Unis | `GOOGL`, `MSFT`, `AAPL` |
| Paris | `MC.PA` (LVMH), `TTE.PA`, `AI.PA` |
| Amsterdam | `ASML.AS` |
| ETF | `CW8.PA`, `ESE.PA` |

## Ce qui est public, ce qui ne l'est pas

| Donnée | Où | Visible par |
|---|---|---|
| Cours, historiques, taux de change | `data/cours.json` | tout le monde — ce sont des données publiques |
| Liste des tickers suivis | `data/tickers.json` | tout le monde |
| **Quantités, prix de revient, valorisation** | Supabase, table `user_data` | **toi seul**, via les règles RLS |

Autrement dit : on peut voir que tu suis Microsoft, pas combien tu en as.

## Prix de revient et devises

Le prix de revient se saisit **en euros**, tel que tu l'as payé. Les cours
américains arrivent en dollars et sont convertis avec le taux EUR/USD récupéré
par la même action. Une ligne dont la devise est inconnue est affichée brute
plutôt que convertie avec un taux inventé.

## Mise en route

1. Settings → Pages → branche `main`, dossier `/ (root)`.
2. Settings → Actions → General → Workflow permissions → **Read and write**,
   sans quoi l'action ne peut pas commiter les cours.
3. Onglet Actions → « Cours du jour » → *Run workflow*, pour un premier
   remplissage sans attendre le soir.
