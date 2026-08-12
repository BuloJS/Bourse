/**
 * Récupère les cours et écrit data/cours.json.
 *
 * Tourne dans une GitHub Action, donc côté serveur : pas de CORS à contourner.
 *
 * Deux fournisseurs sont tentés dans l'ordre :
 *
 *   1. Twelve Data, si le secret TWELVEDATA_KEY est présent. C'est la voie
 *      fiable : une API déclarée, qui ne bloque pas les serveurs partagés.
 *      La clé reste dans les secrets du dépôt, jamais dans la page.
 *   2. Stooq, sans compte. Gratuit mais capricieux depuis les runners GitHub
 *      (répond 200 avec un corps vide). Sert de filet si la clé manque.
 *
 * Yahoo Finance a été abandonné : 429 systématique depuis les runners, dont
 * les adresses IP sont partagées par des milliers de projets.
 *
 * L'historique des courbes n'est demandé à personne : chaque exécution ajoute
 * la clôture du jour à celle des jours précédents. Au bout de quelques
 * semaines la courbe est complète, et elle ne dépend d'aucun fournisseur.
 *
 * Usage : node scripts/fetch-cours.mjs
 */

import { readFile, writeFile } from "node:fs/promises";

const TICKERS_FILE = "data/tickers.json";
const COURS_FILE = "data/cours.json";
const HISTORIQUE_MAX = 60;

// Surchargeables pour rejouer le script contre des réponses enregistrées.
const TWELVE = process.env.TWELVE_BASE ?? "https://api.twelvedata.com";
const STOOQ = process.env.STOOQ_BASE ?? "https://stooq.com/q/d/l/";
const CHANGE = process.env.CHANGE_BASE ?? "https://api.frankfurter.app";
const CLE = process.env.TWELVEDATA_KEY ?? "";

const HEADERS = {
  "User-Agent": "BuloJS-Bourse/1.0 (+https://github.com/BuloJS/Bourse)",
  Accept: "application/json,text/csv,*/*",
};

/** Traduit un ticker « à la Yahoo » vers le symbole attendu par Stooq. */
const PLACES = {
  ".PA": ".fr", ".AS": ".nl", ".BR": ".be", ".DE": ".de", ".F": ".de",
  ".L": ".uk", ".MI": ".it", ".MC": ".es", ".SW": ".ch", ".ST": ".se",
};

function versStooq(ticker) {
  const point = ticker.lastIndexOf(".");
  if (point === -1) return `${ticker.toLowerCase()}.us`;
  const place = PLACES[ticker.slice(point).toUpperCase()];
  return place ? ticker.slice(0, point).toLowerCase() + place : ticker.toLowerCase();
}

async function lireJson(chemin, defaut) {
  try {
    return JSON.parse(await readFile(chemin, "utf8"));
  } catch {
    return defaut;
  }
}

// --- Fournisseur 1 : Twelve Data (avec clé) --------------------------------

async function viaTwelveData({ ticker, mic, exchange, country }) {
  // Un ticker européen nu est ambigu : « ACA » ou « HO » existent sur
  // plusieurs places. Le code MIC (XPAR pour Euronext Paris, XETR pour Xetra)
  // lève l'ambiguïté sans dépendre de l'orthographe du nom de la place.
  const params = new URLSearchParams({ symbol: ticker, apikey: CLE });
  if (mic) params.set("mic_code", mic);
  if (exchange) params.set("exchange", exchange);
  if (country) params.set("country", country);

  const reponse = await fetch(`${TWELVE}/quote?${params}`, { headers: HEADERS });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

  const corps = await reponse.json();
  // Une erreur arrive en 200 avec { status: "error", message: "…" }.
  if (corps?.status === "error" || corps?.code >= 400) {
    throw new Error(corps.message || `code ${corps.code}`);
  }

  const prix = Number(corps.close);
  if (!Number.isFinite(prix)) throw new Error("aucun cours dans la réponse");

  return {
    prix,
    veille: Number(corps.previous_close) || prix,
    devise: corps.currency || "USD",
    nom: corps.name || ticker,
  };
}

// --- Fournisseur 2 : Stooq (sans compte) -----------------------------------

async function viaStooq(ticker) {
  const symbole = versStooq(ticker);
  const reponse = await fetch(`${STOOQ}?s=${encodeURIComponent(symbole)}&i=d`, { headers: HEADERS });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

  const texte = (await reponse.text()).trim();
  const lignes = texte.split("\n").slice(1).filter(Boolean);
  const clotures = lignes
    .map((ligne) => Number(ligne.split(",")[4]))
    .filter((valeur) => Number.isFinite(valeur));

  if (!clotures.length) {
    throw new Error(`corps inutilisable : ${JSON.stringify(texte.slice(0, 100))}`);
  }

  return {
    prix: clotures.at(-1),
    veille: clotures.at(-2) ?? clotures.at(-1),
    devise: symbole.endsWith(".us") ? "USD" : "EUR",
    nom: ticker,
  };
}

/** Essaie les fournisseurs dans l'ordre et remonte toutes les raisons d'échec. */
async function coursDe(entree) {
  const raisons = [];

  if (CLE) {
    try {
      return { ...(await viaTwelveData(entree)), source: "twelvedata" };
    } catch (erreur) {
      raisons.push(`twelvedata: ${erreur.message}`);
    }
  } else {
    raisons.push("twelvedata: pas de clé (secret TWELVEDATA_KEY absent)");
  }

  try {
    return { ...(await viaStooq(entree.stooq || entree.ticker)), source: "stooq" };
  } catch (erreur) {
    raisons.push(`stooq: ${erreur.message}`);
  }

  throw new Error(raisons.join(" | "));
}

// --- Exécution -------------------------------------------------------------

const tickers = await lireJson(TICKERS_FILE, []);
const precedent = await lireJson(COURS_FILE, { valeurs: {} });

if (!Array.isArray(tickers) || !tickers.length) {
  console.error(`${TICKERS_FILE} est vide : rien à récupérer.`);
  process.exit(0);
}

const valeurs = {};
const echecs = [];
const aujourdhui = new Date().toISOString().slice(0, 10);

for (const brut of tickers) {
  // Une entrée est soit "MSFT", soit { ticker, mic, exchange, country, stooq }.
  const entree = typeof brut === "string" ? { ticker: brut } : brut;
  const { ticker } = entree;
  const ancien = precedent.valeurs?.[ticker];

  try {
    const cours = await coursDe(entree);

    // L'historique se construit ici, jour après jour : une entrée par date,
    // la dernière étant remplacée si le script tourne deux fois le même jour.
    const historique = (ancien?.historique ?? []).filter((point) => point.d !== aujourdhui);
    historique.push({ d: aujourdhui, c: Math.round(cours.prix * 100) / 100 });

    valeurs[ticker] = { ...cours, historique: historique.slice(-HISTORIQUE_MAX) };
    console.log(`ok    ${ticker.padEnd(10)} ${cours.prix} ${cours.devise}  (${cours.source})`);
  } catch (erreur) {
    echecs.push(ticker);
    if (ancien) valeurs[ticker] = ancien; // on garde le dernier cours connu
    console.error(`échec ${ticker.padEnd(10)} ${erreur.message}`);
  }

  await new Promise((r) => setTimeout(r, 500));
}

// Taux de change, pour convertir en euros les lignes cotées en dollars.
let taux = precedent.taux ?? {};
try {
  const reponse = await fetch(`${CHANGE}/latest?from=EUR&to=USD`, { headers: HEADERS });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
  const usd = (await reponse.json())?.rates?.USD;
  if (!Number.isFinite(usd)) throw new Error("réponse inattendue");
  taux = { EURUSD: usd };
  console.log(`ok    EURUSD     ${usd}`);
} catch (erreur) {
  console.error(`échec EURUSD    ${erreur.message} — ancien taux conservé`);
}

await writeFile(
  COURS_FILE,
  JSON.stringify({ maj: new Date().toISOString(), taux, echecs, valeurs }, null, 2) + "\n"
);

const reussis = tickers.length - echecs.length;
console.log(`\n${reussis}/${tickers.length} cours récupéré(s) → ${COURS_FILE}`);

// Un échec total doit faire rougir l'action, sinon le problème passe inaperçu.
if (!reussis) {
  console.error(
    "\nAucun cours récupéré." +
    (CLE ? "" : "\nAucune clé configurée : ajoute le secret TWELVEDATA_KEY (voir le README).")
  );
  process.exit(1);
}
