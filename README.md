# Bourse

Suivi visuel de mes positions : une *treemap* où chaque ligne est un rectangle
dont la **taille** est son poids dans le portefeuille et la **couleur** sa
variation du jour.

👉 https://bulojs.github.io/Bourse/

Accès réservé au compte unique — il faut passer par
[Home](https://bulojs.github.io/Home/).

## La fonction « cours » — à déployer une fois

C'est la voie principale, et la seule qui couvre les marchés européens.

**Pourquoi.** Aucune source gratuite ne convient telle quelle :

| Source | Depuis un navigateur | Depuis GitHub Actions | Europe |
|---|---|---|---|
| Yahoo Finance | bloqué (CORS) | `429`, IP partagées | ✅ complète |
| Stooq | bloqué (CORS) | page de blocage | — |
| Twelve Data | clé exposée | ✅ | ❌ `404`, plan gratuit = États-Unis |

Yahoo a la meilleure couverture et ne demande aucune clé : il ne refusait que
les adresses IP de GitHub. Une petite fonction hébergée par **Supabase**
l'interroge depuis une autre infrastructure, et la page l'appelle avec le
jeton de ta session — donc elle ne répond qu'à toi.

**Déploiement** (une fois, 5 minutes) :

1. Supabase → ton projet → **Edge Functions** → *Deploy a new function*
2. Nom : `cours`
3. Colle le contenu de
   [`supabase/functions/cours/index.ts`](supabase/functions/cours/index.ts)
4. Déploie.

Les symboles sont ceux de Yahoo :

| Titre | Symbole |
|---|---|
| Crédit Agricole | `ACA.PA` |
| Thales | `HO.PA` |
| Amundi MSCI World | `EWLD.PA` |
| Alphabet (Xetra) | `ABEA.DE` |
| Xtrackers MSCI USA (Xetra) | `XDUS.DE` |
| Microsoft, Alphabet (US) | `MSFT`, `GOOGL` |

Une fois la fonction déployée, **`data/tickers.json` ne sert plus** : les cours
sont demandés pour les lignes que tu détiens, sans liste à tenir à jour à côté.

## La clé Twelve Data — secours pour les titres américains

Les cours arrivent tout seuls, mais il faut **une clé gratuite** :

1. Crée un compte sur [twelvedata.com](https://twelvedata.com/pricing) — plan
   *Basic*, gratuit, 800 requêtes par jour (on en utilise une poignée).
2. Copie la clé d'API.
3. Dans ce dépôt : **Settings → Secrets and variables → Actions → New
   repository secret**, nom `TWELVEDATA_KEY`, valeur = ta clé.

**La clé reste dans les secrets du dépôt et n'apparaît jamais dans la page**,
contrairement à un appel fait depuis le navigateur. C'est justement pour ça
qu'on passe par une action.

Sans cette clé, le script se rabat sur Stooq (sans compte) — mais Stooq bloque
les serveurs GitHub, donc il ne faut pas compter dessus.

Une saisie manuelle du cours reste possible par ligne (champs *Cours actuel* et
*Cours de la veille*) : c'est un dépannage si un titre exotique n'est pas
couvert, pas le mode normal.

## Comment les cours arrivent ici

Il n'existe pas d'API boursière gratuite, sans compte, appelable depuis un
navigateur : les rares endpoints sans clé refusent les appels venus d'une page
web (CORS). Le contournement est une **GitHub Action** :

1. Chaque soir de semaine (18h05 UTC), l'action lit `data/tickers.json` ;
2. elle interroge **Twelve Data** pour les cours et **Frankfurter** (données
   BCE) pour le taux EUR/USD, **côté serveur**, où le CORS ne s'applique pas ;
3. elle écrit `data/cours.json` et le commite ;
4. le site lit simplement ce fichier.

Résultat : aucune clé dans la page, aucun coût, et le site reste entièrement
statique.

**Les courbes ne sont demandées à personne** : chaque exécution ajoute la
clôture du jour aux précédentes dans `data/cours.json`. Au bout de quelques
semaines la courbe est complète, et elle ne dépend d'aucun fournisseur. Les
premiers jours, la colonne « 30 jours » affiche donc un tiret.

L'action se relance aussi à chaque modification de `data/tickers.json`, et à la
main depuis l'onglet Actions.

> **État réel des sources, mesuré depuis les serveurs GitHub :**
>
> | Source | Résultat |
> |---|---|
> | Yahoo Finance | `HTTP 429` — adresses IP des runners limitées en permanence |
> | Stooq | `HTTP 200` mais CSV vide — même cause probable |
> | Frankfurter (taux de change) | ✅ fonctionne |
>
> Autrement dit : le taux EUR/USD est récupéré sans problème, les cours
> d'actions non. C'est pour ça que la saisie manuelle est la voie principale et
> non un dépannage.

Si une source tombe, les derniers cours connus sont conservés et la date
affichée sous « Investi » cesse d'avancer : le tableau ne montre jamais des
valeurs vides comme si elles étaient à jour. Et si **plus rien** ne peut être
récupéré, l'action échoue franchement plutôt que de se terminer en vert avec un
fichier vide.

## Ajouter une ligne

Deux choses à faire, dans cet ordre :

1. **Dans la page**, bouton « + Ajouter une ligne » : ticker, quantité, prix de
   revient unitaire. C'est enregistré dans Supabase, donc synchronisé entre tes
   PC — et **pas** dans ce dépôt public.
2. **Dans `data/tickers.json`**, ajoute le ticker pour que son cours soit
   récupéré. La page te le rappelle en clair tant que ça n'est pas fait.

Le ticker se saisit au format habituel (celui de Yahoo, Boursorama, Google
Finance) ; le script le traduit tout seul vers le symbole de Stooq :

| Marché | Tu écris | Interrogé comme |
|---|---|---|
| États-Unis | `MSFT`, `GOOGL` | `msft.us` |
| Paris | `MC.PA` (LVMH) | `mc.fr` |
| Amsterdam | `ASML.AS` | `asml.nl` |
| Francfort | `SAP.DE` | `sap.de` |
| Londres | `SHEL.L` | `shel.uk` |

**Hors États-Unis, précise la place de cotation.** Un ticker européen nu est
ambigu : `ACA` ou `HO` existent sur plusieurs marchés, et le fournisseur répond
alors « symbol not found ». Le code MIC lève l'ambiguïté :

```json
[
  "MSFT",
  { "ticker": "ACA",  "mic": "XPAR" },
  { "ticker": "ABEA", "mic": "XETR" }
]
```

| Place | MIC |
|---|---|
| Euronext Paris | `XPAR` |
| Euronext Amsterdam | `XAMS` |
| Xetra (Francfort) | `XETR` |
| Borsa Italiana | `XMIL` |
| London Stock Exchange | `XLON` |
| Bolsa de Madrid | `XMAD` |

Champs acceptés : `mic`, `exchange` (nom de la place), `country`, et `stooq`
pour forcer le symbole du fournisseur de repli. `note` sert juste à te
rappeler de quoi il s'agit.

La colonne « échecs » de `data/cours.json` et le journal de l'action te disent
exactement quel symbole n'a rien renvoyé.

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
