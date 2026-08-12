/**
 * Récupère les cours et écrit data/cours.json.
 *
 * Tourne dans une GitHub Action, donc côté serveur : pas de CORS à contourner,
 * et aucune clé d'API.
 *
 * Sources :
 *   - Stooq pour les actions et ETF (CSV, sans compte) ;
 *   - Frankfurter (données BCE) pour le taux EUR/USD.
 *
 * Yahoo Finance a été abandonné : il répond 429 depuis les serveurs GitHub,
 * dont les adresses IP sont partagées par des milliers de projets et donc
 * limitées en permanence. Ce n'était pas réparable côté code.
 *
 * Usage : node scripts/fetch-cours.mjs
 */

import { readFile, writeFile } from "node:fs/promises";

const TICKERS_FILE = "data/tickers.json";
const COURS_FILE = "data/cours.json";

// Surchargeables pour rejouer le script contre des réponses enregistrées.
const STOOQ = process.env.STOOQ_BASE ?? "https://stooq.com/q/d/l/";
const CHANGE = process.env.CHANGE_BASE ?? "https://api.frankfurter.app";

const HEADERS = {
  "User-Agent": "BuloJS-Bourse/1.0 (+https://github.com/BuloJS/Bourse)",
  Accept: "text/csv,*/*",
};

/**
 * Traduit un ticker « à la Yahoo » — celui que tu saisis dans la page — vers
 * le symbole attendu par Stooq. Sans suffixe, on suppose les États-Unis.
 * Une entrée de data/tickers.json peut aussi imposer son symbole si la
 * correspondance automatique se trompe.
 */
const PLACES = {
  ".PA": ".fr", ".AS": ".nl", ".BR": ".be", ".DE": ".de", ".F": ".de",
  ".L": ".uk", ".MI": ".it", ".MC": ".es", ".SW": ".ch", ".ST": ".se",
};

function versStooq(ticker) {
  const point = ticker.lastIndexOf(".");
  if (point === -1) return `${ticker.toLowerCase()}.us`;

  const suffixe = ticker.slice(point).toUpperCase();
  const place = PLACES[suffixe];
  return place
    ? ticker.slice(0, point).toLowerCase() + place
    : ticker.toLowerCase(); // suffixe déjà au format Stooq
}

async function lireJson(chemin, defaut) {
  try {
    return JSON.parse(await readFile(chemin, "utf8"));
  } catch {
    return defaut;
  }
}

function ilYaNJours(n) {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Historique quotidien d'un symbole. Stooq renvoie un CSV
 * « Date,Open,High,Low,Close,Volume », le plus ancien en premier.
 */
async function coursDe(ticker, symbole) {
  const url =
    `${STOOQ}?s=${encodeURIComponent(symbole)}&i=d` +
    `&d1=${ilYaNJours(60)}&d2=${ilYaNJours(0)}`;

  const reponse = await fetch(url, { headers: HEADERS });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

  const texte = (await reponse.text()).trim();
  // Un symbole inconnu ne renvoie pas une erreur HTTP mais un corps vide.
  if (!texte || /no data|exceeded/i.test(texte)) throw new Error("symbole inconnu ou quota atteint");

  const lignes = texte.split("\n").slice(1).filter(Boolean);
  const clotures = lignes
    .map((ligne) => Number(ligne.split(",")[4]))
    .filter((valeur) => Number.isFinite(valeur));

  if (!clotures.length) {
    // Stooq répond parfois 200 avec un corps inutilisable (quota, symbole
    // inconnu, blocage). On remonte un extrait : sans lui, le journal dit
    // seulement « rien reçu », ce qui n'aide à rien.
    throw new Error(`aucune clôture exploitable — reçu : ${JSON.stringify(texte.slice(0, 120))}`);
  }

  return {
    prix: clotures.at(-1),
    veille: clotures.at(-2) ?? clotures.at(-1),
    // Stooq cote chaque place dans sa monnaie locale.
    devise: symbole.endsWith(".us") ? "USD" : "EUR",
    nom: ticker,
    historique: clotures.slice(-30).map((v) => Math.round(v * 100) / 100),
  };
}

/** Deux essais : une erreur réseau ponctuelle ne doit pas vider le fichier. */
async function avecReprise(ticker, symbole) {
  try {
    return await coursDe(ticker, symbole);
  } catch (erreur) {
    await new Promise((r) => setTimeout(r, 2000));
    return coursDe(ticker, symbole).catch(() => {
      throw erreur;
    });
  }
}

const brut = await lireJson(TICKERS_FILE, []);
const precedent = await lireJson(COURS_FILE, { valeurs: {} });

if (!Array.isArray(brut) || !brut.length) {
  console.error(`${TICKERS_FILE} est vide : rien à récupérer.`);
  process.exit(0);
}

// Une entrée est soit "MSFT", soit { "ticker": "MSFT", "stooq": "msft.us" }.
const tickers = brut.map((entree) =>
  typeof entree === "string"
    ? { ticker: entree, stooq: versStooq(entree) }
    : { ticker: entree.ticker, stooq: entree.stooq || versStooq(entree.ticker) }
);

const valeurs = {};
const echecs = [];

for (const { ticker, stooq } of tickers) {
  try {
    valeurs[ticker] = await avecReprise(ticker, stooq);
    console.log(`ok    ${ticker.padEnd(10)} ${valeurs[ticker].prix} ${valeurs[ticker].devise}  (${stooq})`);
  } catch (erreur) {
    echecs.push(ticker);
    // On garde la valeur précédente plutôt que de faire disparaître la ligne.
    if (precedent.valeurs?.[ticker]) valeurs[ticker] = precedent.valeurs[ticker];
    console.error(`échec ${ticker.padEnd(10)} ${erreur.message}  (${stooq})`);
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

// Un échec total doit faire rougir l'action. Sinon elle se termine en vert
// avec un fichier vide, et le problème passe inaperçu — ce qui est arrivé.
if (!reussis) {
  console.error("\nAucun cours récupéré : la source est injoignable ou refuse les requêtes.");
  process.exit(1);
}
