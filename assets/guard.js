/**
 * guard.js — accès réservé au compte unique, via la page d'accueil.
 *
 * Volontairement autonome : Finance n'utilise pas Supabase pour ses données,
 * il serait absurde de lui faire télécharger la librairie officielle juste
 * pour lire une session. Tout se fait ici en lisant le localStorage, ce qui
 * évite aussi de dépendre d'un CDN joignable.
 *
 * Les quatre sites (Home, Series, Simu-SCI, Finance) sont servis par la même
 * origine et partagent donc le même localStorage : la session écrite par Home
 * à la connexion est directement lisible ici. Sinon, on renvoie vers Home,
 * qui ramène ici une fois la connexion faite.
 *
 * LIMITE : un site statique reste téléchargeable. Cette garde empêche l'accès
 * direct par l'URL dans un navigateur, pas quelqu'un qui irait chercher les
 * fichiers à la main.
 */

import { PROJECT_REF, HOME_PATH, REQUIRE_AAL2 } from "./config.js";

/** Clé sous laquelle la librairie officielle range la session. */
const SESSION_KEY = `sb-${PROJECT_REF}-auth-token`;

const BOUNCE_KEY = "guard:bounces";
const MAX_BOUNCES = 3;

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    // Certaines versions enveloppent la session dans { currentSession: … }.
    return session?.currentSession ?? session ?? null;
  } catch {
    return null;
  }
}

/** Le jeton est-il encore valide ? expires_at est en secondes. */
function isFresh(session) {
  if (!session?.access_token) return false;
  if (!session.expires_at) return true;
  return session.expires_at * 1000 > Date.now();
}

/**
 * Niveau d'authentification inscrit dans le jeton : « aal1 » avec le mot de
 * passe seul, « aal2 » une fois le code à 6 chiffres validé. On le lit dans
 * le jeton plutôt que dans `user.factors`, absent de certaines sessions.
 */
function assuranceLevel(session) {
  try {
    const payload = session.access_token.split(".")[1]
      .replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).aal || "aal1";
  } catch {
    return "aal1";
  }
}

function reveal() {
  document.documentElement.style.visibility = "";
  sessionStorage.removeItem(BOUNCE_KEY);
}

/** Affiche un message plein écran plutôt que de boucler indéfiniment. */
function stop(text) {
  document.documentElement.style.visibility = "";
  document.body.innerHTML = "";
  const p = document.createElement("p");
  p.style.cssText =
    "max-width:34rem;margin:22vh auto;padding:0 1.5rem;text-align:center;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "font-size:1rem;line-height:1.5;color:#6b7280";
  p.textContent = text;
  document.body.appendChild(p);
}

function redirectToHome() {
  // Compteur anti-aller-retour : si Home nous renvoie ici alors que la session
  // est toujours refusée, on s'arrête au lieu de boucler.
  const bounces = Number(sessionStorage.getItem(BOUNCE_KEY) || 0) + 1;
  if (bounces > MAX_BOUNCES) {
    sessionStorage.removeItem(BOUNCE_KEY);
    stop("Connexion impossible. Ouvre la page d'accueil pour te connecter, puis reviens.");
    return;
  }
  sessionStorage.setItem(BOUNCE_KEY, String(bounces));

  const next = window.location.pathname + window.location.search + window.location.hash;
  window.location.replace(`${HOME_PATH}?next=${encodeURIComponent(next)}`);
}

const session = readSession();
const autorise =
  isFresh(session) && (!REQUIRE_AAL2 || assuranceLevel(session) === "aal2");

if (autorise) reveal();
else redirectToHome();
