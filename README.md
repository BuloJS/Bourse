# Bourse

Suivi visuel de mes positions : une *treemap* où chaque ligne est un rectangle
dont la **taille** est son poids dans le portefeuille et la **couleur** sa
variation du jour.

👉 https://bulojs.github.io/Bourse/

Accès réservé au compte unique — il faut passer par
[Home](https://bulojs.github.io/Home/).

## Les cours : à la main, ou automatiques

**Le plus simple, et le plus robuste : saisir le cours à la main.** Dans
« modifier » sur une ligne, les champs *Cours actuel* et *Cours de la veille*.
Une fois remplis, ils l'emportent sur tout le reste. Pour un tableau qu'on
regarde une ou deux fois par jour, taper deux nombres ne coûte rien — et rien
d'extérieur ne peut le casser.

La récupération automatique décrite ci-dessous est un **bonus**. Elle est
fragile par nature : les sources gratuites sans compte bloquent volontiers les
adresses IP des serveurs partagés. Si elle ne marche pas, le tableau fonctionne
quand même.

## Comment les cours arrivent ici (quand ça marche)

Il n'existe pas d'API boursière gratuite, sans compte, appelable depuis un
navigateur : les rares endpoints sans clé refusent les appels venus d'une page
web (CORS). Le contournement est une **GitHub Action** :

1. Chaque soir de semaine (18h05 UTC), l'action lit `data/tickers.json` ;
2. elle interroge **Stooq** (cours, en CSV) et **Frankfurter** (taux EUR/USD,
   données BCE) **côté serveur**, où le CORS ne s'applique pas et où aucune clé
   n'est requise ;
3. elle écrit `data/cours.json` et le commite ;
4. le site lit simplement ce fichier.

Résultat : aucun compte, aucune clé dans la page, aucun coût, et le site reste
entièrement statique.

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

Si la traduction se trompe — la couverture de Stooq hors États-Unis est
inégale — impose le symbole à la main :

```json
[
  "MSFT",
  { "ticker": "MC.PA", "stooq": "mc.fr" }
]
```

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
