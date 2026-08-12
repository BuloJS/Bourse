/**
 * Récupère les cours et écrit data/cours.json.
 *
 * Tourne dans une GitHub Action, donc côté serveur : pas de CORS à contourner,
 * et aucune clé d'API — l'endpoint « chart » de Yahoo Finance est ouvert. C'est
 * le seul moyen d'avoir des cours gratuits sans compte sur un site statique.
 *
 * À savoir : cet endpoint n'est pas officiel. Il est stable depuis des années
 * mais rien ne le garantit ; s'il tombe, les cours précédents sont conservés et
 * le tableau de bord affiche leur date, plutôt que de mentir avec du vide.
 *
 * Usage : node scripts/fetch-cours.mjs
 */

import { readFile, writeFile } from "node:fs/promises";

const TICKERS_FILE = "data/tickers.json";
const COURS_FILE = "data/cours.json";

// Surchargeable pour rejouer le script contre une réponse enregistrée, sans
// dépendre du réseau ni du bon vouloir de Yahoo.
const BASE = process.env.YAHOO_BASE ?? "https://query1.finance.yahoo.com/v8/finance/chart";

// Sans en-tête de navigateur, Yahoo répond 429 ou une page de consentement.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
};

async function lireJson(chemin, defaut) {
  try {
    return JSON.parse(await readFile(chemin, "utf8"));
  } catch {
    return defaut;
  }
}

/** Un cours et un mois d'historique pour un symbole. */
async function coursDe(symbole) {
  const url = `${BASE}/${encodeURIComponent(symbole)}?interval=1d&range=1mo`;

  const reponse = await fetch(url, { headers: HEADERS });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

  const resultat = (await reponse.json())?.chart?.result?.[0];
  if (!resultat?.meta) throw new Error("réponse inattendue");

  const meta = resultat.meta;
  const clotures = (resultat.indicators?.quote?.[0]?.close ?? []).filter(
    (valeur) => typeof valeur === "number"
  );

  const prix = meta.regularMarketPrice ?? clotures.at(-1);
  if (typeof prix !== "number") throw new Error("aucun prix");

  return {
    prix,
    veille: meta.chartPreviousClose ?? meta.previousClose ?? clotures.at(-2) ?? prix,
    devise: meta.currency ?? "USD",
    nom: meta.shortName ?? meta.longName ?? symbole,
    // Historique allégé : de quoi tracer une courbe, pas de quoi faire une base.
    historique: clotures.slice(-30).map((valeur) => Math.round(valeur * 100) / 100),
  };
}

/** Deux essais : une erreur réseau ponctuelle ne doit pas vider le fichier. */
async function coursAvecReprise(symbole) {
  try {
    return await coursDe(symbole);
  } catch (erreur) {
    await new Promise((resoudre) => setTimeout(resoudre, 1500));
    return coursDe(symbole).catch(() => {
      throw erreur;
    });
  }
}

const tickers = await lireJson(TICKERS_FILE, []);
const precedent = await lireJson(COURS_FILE, { valeurs: {} });

if (!Array.isArray(tickers) || !tickers.length) {
  console.error(`${TICKERS_FILE} est vide : rien à récupérer.`);
  process.exit(0);
}

const valeurs = {};
const echecs = [];

// En série, avec une pause : Yahoo limite les rafales.
for (const symbole of tickers) {
  try {
    valeurs[symbole] = await coursAvecReprise(symbole);
    console.log(`ok   ${symbole.padEnd(10)} ${valeurs[symbole].prix} ${valeurs[symbole].devise}`);
  } catch (erreur) {
    echecs.push(symbole);
    // On garde la valeur précédente plutôt que de faire disparaître la ligne.
    if (precedent.valeurs?.[symbole]) valeurs[symbole] = precedent.valeurs[symbole];
    console.error(`échec ${symbole} : ${erreur.message}`);
  }
  await new Promise((resoudre) => setTimeout(resoudre, 400));
}

// Taux de change, pour convertir en euros les lignes cotées en dollars.
let taux = precedent.taux ?? {};
try {
  const change = await coursDe("EURUSD=X");
  taux = { EURUSD: change.prix };
  console.log(`ok   EURUSD     ${change.prix}`);
} catch (erreur) {
  console.error(`échec EURUSD : ${erreur.message} — ancien taux conservé`);
}

await writeFile(
  COURS_FILE,
  JSON.stringify({ maj: new Date().toISOString(), taux, echecs, valeurs }, null, 2) + "\n"
);

console.log(`\n${Object.keys(valeurs).length} valeur(s) écrite(s) dans ${COURS_FILE}`);
if (echecs.length) console.log(`échecs conservés à l'ancien cours : ${echecs.join(", ")}`);
