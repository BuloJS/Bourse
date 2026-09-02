/**
 * Fonction Supabase « cours » — passe-plat vers Yahoo Finance.
 *
 * Pourquoi elle existe :
 *
 *   - Yahoo couvre toutes les places (Paris, Xetra, New York) mais refuse les
 *     appels venus d'un navigateur (CORS) et répond 429 aux serveurs GitHub,
 *     dont les adresses IP sont partagées par des milliers de projets.
 *   - Twelve Data accepte les serveurs mais son plan gratuit s'arrête aux
 *     marchés américains : 404 sur ACA, HO, EWLD, ABEA, XDUS.
 *
 * Cette fonction tourne sur l'infrastructure Supabase : ni CORS, ni adresse IP
 * mise à l'index, ni clé d'API. Le navigateur l'appelle avec le jeton de ta
 * session, donc elle ne répond qu'à toi.
 *
 * Déploiement : voir le README, section « La fonction cours ».
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ENTETES_YAHOO = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
};

/** Cours et historique d'un symbole, au format attendu par la page. */
async function coursDe(symbole: string) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbole)}` +
    `?interval=1d&range=1mo`;

  const reponse = await fetch(url, { headers: ENTETES_YAHOO });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

  const resultat = (await reponse.json())?.chart?.result?.[0];
  const meta = resultat?.meta;
  if (!meta) throw new Error("réponse inattendue");

  const clotures: number[] = (resultat.indicators?.quote?.[0]?.close ?? []).filter(
    (v: unknown) => typeof v === "number",
  );
  const dates: number[] = resultat.timestamp ?? [];

  const prix = meta.regularMarketPrice ?? clotures.at(-1);
  if (typeof prix !== "number") throw new Error("aucun prix");

  return {
    prix,
    veille: meta.chartPreviousClose ?? meta.previousClose ?? clotures.at(-2) ?? prix,
    devise: meta.currency ?? "EUR",
    nom: meta.shortName ?? meta.longName ?? symbole,
    historique: clotures.slice(-30).map((c, i) => ({
      d: new Date((dates.at(-30 + i) ?? 0) * 1000).toISOString().slice(0, 10),
      c: Math.round(c * 100) / 100,
    })),
  };
}

/**
 * Dividende annuel par titre, en un seul appel groupé pour tous les symboles
 * (moins de requêtes qu'un appel par ligne, donc moins de risque de blocage).
 *
 * Yahoo ne fournit pas de « dividende prévu 2026 » : `trailingAnnualDividendRate`
 * est le dernier montant annuel par action réellement déclaré. C'est une
 * estimation basée sur le passé, pas une promesse — la page le présente comme
 * tel plutôt que comme un chiffre garanti.
 */
async function dividendesDe(symboles: string[]) {
  if (!symboles.length) return {} as Record<string, { parAction: number; rendement: number | null }>;

  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symboles.join(","))}`;
  const reponse = await fetch(url, { headers: ENTETES_YAHOO });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

  const lignes = (await reponse.json())?.quoteResponse?.result ?? [];
  const sortie: Record<string, { parAction: number; rendement: number | null }> = {};

  for (const ligne of lignes) {
    const parAction = ligne?.trailingAnnualDividendRate;
    if (typeof parAction === "number" && parAction > 0) {
      sortie[ligne.symbol] = {
        parAction,
        rendement: typeof ligne.trailingAnnualDividendYield === "number"
          ? Math.round(ligne.trailingAnnualDividendYield * 10000) / 100 // fraction → %
          : null,
      };
    }
  }
  return sortie;
}

Deno.serve(async (requete) => {
  if (requete.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const symboles = (new URL(requete.url).searchParams.get("symboles") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30); // borne haute : personne n'a besoin de plus, et ça cadre les abus

  const valeurs: Record<string, unknown> = {};
  const echecs: string[] = [];

  // En série : Yahoo tolère mal les rafales.
  for (const symbole of symboles) {
    try {
      valeurs[symbole] = await coursDe(symbole);
    } catch (erreur) {
      echecs.push(`${symbole}: ${(erreur as Error).message}`);
    }
  }

  // Un échec ici ne doit pas faire échouer les cours : le dividende est un
  // complément, son absence se traduit juste par « — » sur la ligne.
  try {
    const dividendes = await dividendesDe(Object.keys(valeurs));
    for (const [symbole, dividende] of Object.entries(dividendes)) {
      (valeurs[symbole] as Record<string, unknown>).dividende = dividende;
    }
  } catch {
    // Cours disponibles, dividendes absents : la page l'affiche comme tel.
  }

  // Taux de change, pour convertir les lignes cotées en dollars.
  let taux: Record<string, number> = {};
  try {
    const reponse = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD");
    const usd = (await reponse.json())?.rates?.USD;
    if (typeof usd === "number") taux = { EURUSD: usd };
  } catch {
    // Sans taux, la page affiche les lignes en dollars telles quelles.
  }

  return new Response(
    JSON.stringify({ maj: new Date().toISOString(), taux, echecs, valeurs }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
