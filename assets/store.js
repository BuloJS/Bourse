/**
 * store.js — lecture et écriture des positions dans Supabase.
 *
 * Les positions (ce que tu possèdes) sont personnelles et ne doivent pas
 * vivre dans un dépôt public : elles vont dans la table `user_data`, sous
 * `app = "bourse"`, protégées par les règles RLS. Seuls les cours, qui sont
 * publics par nature, sont versionnés dans data/cours.json.
 *
 * Écrit avec `fetch` : deux requêtes suffisent, inutile d'embarquer la
 * librairie officielle ni de dépendre d'un CDN.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, PROJECT_REF, APP_NAME } from "./config.js";

const SESSION_KEY = `sb-${PROJECT_REF}-auth-token`;
const REST = `${SUPABASE_URL}/rest/v1/user_data`;

export function session() {
  try {
    const brut = localStorage.getItem(SESSION_KEY);
    if (!brut) return null;
    const parsee = JSON.parse(brut);
    return parsee?.currentSession ?? parsee ?? null;
  } catch {
    return null;
  }
}

function entetes(s) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${s.access_token}`,
    "Content-Type": "application/json",
  };
}

/** Positions enregistrées, ou [] si le compte n'en a pas encore. */
export async function chargerPositions() {
  const s = session();
  if (!s) throw new Error("aucune session");

  const url = `${REST}?app=eq.${encodeURIComponent(APP_NAME)}&select=data`;
  const reponse = await fetch(url, { headers: entetes(s) });
  if (!reponse.ok) throw new Error(`lecture refusée (${reponse.status})`);

  const lignes = await reponse.json();
  const positions = lignes[0]?.data?.positions;
  return Array.isArray(positions) ? positions : [];
}

export async function enregistrerPositions(positions) {
  const s = session();
  if (!s?.user?.id) throw new Error("aucune session");

  const reponse = await fetch(REST, {
    method: "POST",
    headers: { ...entetes(s), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([
      {
        user_id: s.user.id,
        app: APP_NAME,
        data: { positions },
        updated_at: new Date().toISOString(),
      },
    ]),
  });

  if (!reponse.ok) throw new Error(`enregistrement refusé (${reponse.status})`);
}
