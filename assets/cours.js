/**
 * cours.js — récupération des cours via la fonction Supabase.
 *
 * Deux sources, dans cet ordre :
 *
 *   1. la fonction « cours », qui interroge Yahoo depuis Supabase. Elle couvre
 *      toutes les places, y compris Euronext Paris et Xetra, et n'a besoin
 *      d'aucune clé ;
 *   2. data/cours.json, écrit chaque soir par la GitHub Action, en secours si
 *      la fonction n'est pas déployée ou ne répond pas.
 *
 * Les symboles sont ceux de Yahoo : ACA.PA, HO.PA, EWLD.PA, ABEA.DE, MSFT.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, PROJECT_REF } from "./config.js";

const SESSION_KEY = `sb-${PROJECT_REF}-auth-token`;

function session() {
  try {
    const brut = localStorage.getItem(SESSION_KEY);
    const parsee = brut ? JSON.parse(brut) : null;
    return parsee?.currentSession ?? parsee ?? null;
  } catch {
    return null;
  }
}

/** Cours pour une liste de symboles, via la fonction Supabase. */
export async function coursEnDirect(symboles) {
  if (!symboles.length) return { valeurs: {}, taux: {}, echecs: [], maj: null };

  const s = session();
  if (!s?.access_token) throw new Error("aucune session");

  const url =
    `${SUPABASE_URL}/functions/v1/cours?symboles=${encodeURIComponent(symboles.join(","))}`;

  const reponse = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
  });

  if (!reponse.ok) {
    throw new Error(
      reponse.status === 404
        ? "fonction « cours » non déployée"
        : `fonction cours : HTTP ${reponse.status}`
    );
  }
  return reponse.json();
}

/** Cours figés du dépôt, écrits par la GitHub Action. */
export async function coursDuDepot() {
  const reponse = await fetch("data/cours.json", { cache: "no-cache" });
  if (!reponse.ok) throw new Error(`data/cours.json : HTTP ${reponse.status}`);
  return reponse.json();
}
