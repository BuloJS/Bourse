/**
 * app.js — tableau de bord des positions.
 *
 * Deux sources se rencontrent ici :
 *   - data/cours.json, écrit chaque jour par une GitHub Action (public) ;
 *   - tes positions, lues dans Supabase (privées).
 *
 * Rien n'est calculé côté serveur : quantité × cours, moins le prix de
 * revient, le tout converti en euros.
 */

import { chargerPositions, enregistrerPositions } from "./store.js";
import { coursEnDirect, coursDuDepot } from "./cours.js";

const $ = (id) => document.getElementById(id);

let positions = [];
let cours = { valeurs: {}, taux: {}, maj: null, echecs: [] };
let rangEdite = null;

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurosPrecis = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const pourcent = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} %`;

/** Montant signé : « +86 € » se lit mieux que « 86 € » à côté d'une baisse. */
const eurosSignes = (v) => `${v >= 0 ? "+" : "−"}${euros.format(Math.abs(v))}`;

// --- Calculs ---------------------------------------------------------------

/** Convertit en euros. Les cours américains arrivent en dollars. */
function enEuros(montant, devise) {
  if (devise === "EUR") return montant;
  if (devise === "USD" && cours.taux?.EURUSD) return montant / cours.taux.EURUSD;
  return montant; // devise inconnue : on n'invente pas de taux, on affiche brut
}

/** Enrichit chaque position de sa valorisation et de ses performances. */
function calculer() {
  return positions.map((p) => {
    // Un cours saisi à la main prime sur le cours récupéré : c'est le filet
    // quand la source automatique ne répond pas, et le mode de fonctionnement
    // principal si tu préfères ne dépendre de personne.
    const manuel = Number(p.cours) > 0;
    const valeur = manuel
      ? { prix: Number(p.cours), veille: Number(p.veille) || Number(p.cours), devise: "EUR", nom: p.nom, historique: [] }
      : cours.valeurs[p.ticker];

    if (!valeur) return { ...p, manquant: true, manuel: false, valo: 0, pv: 0, pvPct: 0, jour: 0 };

    const valo = enEuros(valeur.prix * p.qte, valeur.devise);
    const investi = p.pru * p.qte; // le prix de revient est saisi en euros
    const jour = valeur.veille ? ((valeur.prix - valeur.veille) / valeur.veille) * 100 : 0;

    return {
      ...p,
      manquant: false,
      manuel,
      nom: p.nom || valeur.nom || p.ticker,
      prix: valeur.prix,
      devise: valeur.devise,
      historique: valeur.historique || [],
      valo,
      investi,
      pv: valo - investi,
      pvPct: investi ? ((valo - investi) / investi) * 100 : 0,
      jour,
    };
  });
}

// --- Treemap ---------------------------------------------------------------

/**
 * Treemap « squarifié » : on empile les lignes en gardant des blocs aussi
 * carrés que possible, sinon les petites positions deviennent illisibles.
 */
function treemap(items, largeur, hauteur) {
  const total = items.reduce((t, i) => t + i.valo, 0);
  if (!total) return [];

  const sortie = [];
  let reste = items.slice();
  let x = 0, y = 0, w = largeur, h = hauteur, restant = total;

  while (reste.length) {
    const horizontal = w >= h;
    const cote = horizontal ? h : w;
    let ligne = [], somme = 0, meilleur = Infinity;

    for (const item of reste) {
      const essai = somme + item.valo;
      const longueur = (essai / restant) * (horizontal ? w : h);
      const pire = Math.max(
        ...[...ligne, item].map((i) => {
          const c = (i.valo / essai) * cote;
          return c > 0 && longueur > 0 ? Math.max(longueur / c, c / longueur) : Infinity;
        })
      );
      if (pire > meilleur) break;
      meilleur = pire;
      ligne = [...ligne, item];
      somme = essai;
    }

    const longueur = (somme / restant) * (horizontal ? w : h);
    let curseur = horizontal ? y : x;
    for (const item of ligne) {
      const c = (item.valo / somme) * cote;
      sortie.push(horizontal
        ? { item, x, y: curseur, w: longueur, h: c }
        : { item, x: curseur, y, w: c, h: longueur });
      curseur += c;
    }

    if (horizontal) { x += longueur; w -= longueur; } else { y += longueur; h -= longueur; }
    restant -= somme;
    reste = reste.slice(ligne.length);
  }
  return sortie;
}

/**
 * Palette divergente à seuils fixes : une même couleur veut toujours dire la
 * même chose d'un jour à l'autre. Bleu/rouge plutôt que vert/rouge, illisible
 * pour un daltonien — et le pourcentage est écrit sur chaque case, donc la
 * couleur ne porte jamais seule l'information.
 */
function classeVariation(p) {
  if (p > 1.5) return "v-up3";
  if (p > 0.5) return "v-up2";
  if (p > 0.05) return "v-up1";
  if (p < -1.5) return "v-dn3";
  if (p < -0.5) return "v-dn2";
  if (p < -0.05) return "v-dn1";
  return "v-flat";
}

function dessinerTreemap(lignes) {
  const zone = $("map");
  zone.innerHTML = "";

  const visibles = lignes.filter((l) => !l.manquant && l.valo > 0);
  if (!visibles.length) return;

  const largeur = zone.clientWidth || 700;
  const hauteur = zone.clientHeight || 420;
  const total = visibles.reduce((t, l) => t + l.valo, 0);

  for (const boite of treemap([...visibles].sort((a, b) => b.valo - a.valo), largeur, hauteur)) {
    const { item } = boite;
    const cellule = document.createElement("button");
    cellule.type = "button";
    cellule.className = `cellule ${classeVariation(item.jour)}` +
      (boite.w < 92 || boite.h < 62 ? " petite" : "");
    cellule.style.cssText =
      `left:${boite.x}px;top:${boite.y}px;width:${boite.w}px;height:${boite.h}px`;
    cellule.title =
      `${item.nom} · ${eurosPrecis.format(item.valo)} · jour ${pourcent(item.jour)} · ` +
      `plus-value ${pourcent(item.pvPct)}`;
    cellule.addEventListener("click", () => ouvrirForm(positions.indexOf(
      positions.find((p) => p.ticker === item.ticker)
    )));

    cellule.innerHTML =
      `<span class="t">${item.ticker}</span>` +
      `<span><span class="p">${pourcent(item.jour)}</span><br>` +
      `<span class="m">${euros.format(item.valo)} · ${Math.round((item.valo / total) * 100)} %</span></span>`;
    zone.appendChild(cellule);
  }
}

// --- Courbe miniature ------------------------------------------------------

function sparkline(historique, hausse) {
  // L'historique est construit jour après jour par l'action : [{d, c}, …].
  const points = (historique || [])
    .map((p) => (typeof p === "number" ? p : Number(p?.c)))
    .filter(Number.isFinite);

  // Une seule journée connue ne fait pas une courbe : on attend d'en avoir deux.
  if (points.length < 2) return '<span class="attente">—</span>';

  const min = Math.min(...points), max = Math.max(...points);
  const etendue = max - min || 1;
  const d = points
    .map((v, i) => `${i ? "L" : "M"}${(i / (points.length - 1)) * 92 + 2} ${38 - ((v - min) / etendue) * 34}`)
    .join(" ");
  return `<svg class="spark" width="96" height="40" viewBox="0 0 96 40" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${hausse ? "var(--up-2)" : "var(--dn-2)"}"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// --- Rendu -----------------------------------------------------------------

function rendre() {
  const lignes = calculer();
  const connues = lignes.filter((l) => !l.manquant);

  const valo = connues.reduce((t, l) => t + l.valo, 0);
  const investi = connues.reduce((t, l) => t + l.investi, 0);
  const pv = valo - investi;
  const veille = connues.reduce(
    (t, l) => t + (l.jour ? l.valo / (1 + l.jour / 100) : l.valo), 0
  );
  const jour = veille ? ((valo - veille) / veille) * 100 : 0;

  $("hero").hidden = !positions.length;
  $("vide").hidden = Boolean(positions.length);

  $("valo").textContent = euros.format(valo);
  $("valo-jour").textContent = `${eurosSignes(valo - veille)} aujourd'hui (${pourcent(jour)})`;
  $("valo-jour").className = `s ${jour >= 0 ? "pos" : "neg"}`;

  $("pv").textContent = eurosSignes(pv);
  $("pv").className = `v ${pv >= 0 ? "pos" : "neg"}`;
  $("pv-pct").textContent = investi ? `${pourcent((pv / investi) * 100)} depuis l'achat` : "—";
  $("pv-pct").className = `s ${pv >= 0 ? "pos" : "neg"}`;

  $("investi").textContent = euros.format(investi);
  $("investi-sub").textContent =
    `${positions.length} ligne${positions.length > 1 ? "s" : ""}` +
    (cours.maj ? ` · cours du ${new Date(cours.maj).toLocaleDateString("fr-FR")}` : " · cours jamais récupérés");

  dessinerTreemap(lignes);

  $("tbody").innerHTML = lignes
    .slice()
    .sort((a, b) => b.valo - a.valo)
    .map((l, i) => l.manquant
      ? `<tr class="manquante"><td class="nom">${l.ticker}</td>
           <td colspan="3">aucun cours — saisis-le à la main, ou ajoute <code>"${l.ticker}"</code> à data/tickers.json</td>
           <td><button class="lien" data-edit="${positions.indexOf(positions.find(p => p.ticker === l.ticker))}">modifier</button></td></tr>`
      : `<tr>
           <td class="nom">${l.nom}<span class="tick">${l.ticker}${l.manuel ? " · cours saisi" : ""}</span></td>
           <td>${sparkline(l.historique, l.pvPct >= 0)}</td>
           <td>${euros.format(l.valo)}</td>
           <td class="${l.pvPct >= 0 ? "pos" : "neg"}">${pourcent(l.pvPct)}</td>
           <td><button class="lien" data-edit="${positions.indexOf(positions.find(p => p.ticker === l.ticker))}">modifier</button></td>
         </tr>`)
    .join("");

  const absents = lignes.filter((l) => l.manquant).map((l) => l.ticker);
  $("alerte").hidden = !absents.length;
  if (absents.length) {
    $("alerte").innerHTML =
      `<strong>${absents.length} ligne(s) sans cours :</strong> ` +
      absents.map((t) => `<code>${t}</code>`).join(", ") +
      `. Le plus simple est de saisir le cours à la main dans la ligne — ` +
      `« modifier », champ <em>Cours actuel</em>. La récupération automatique ` +
      `reste un bonus, elle n'est pas nécessaire.`;
  }
}

// --- Éditeur de positions --------------------------------------------------

function ouvrirForm(rang) {
  rangEdite = rang >= 0 ? rang : null;
  const p = rangEdite === null ? null : positions[rangEdite];

  $("form-titre").textContent = p ? `Modifier ${p.ticker}` : "Nouvelle ligne";
  $("f-ticker").value = p?.ticker ?? "";
  $("f-nom").value = p?.nom ?? "";
  $("f-qte").value = p?.qte ?? "";
  $("f-pru").value = p?.pru ?? "";
  $("f-cours").value = p?.cours ?? "";
  $("f-veille").value = p?.veille ?? "";
  $("f-supprimer").hidden = rangEdite === null;
  $("form-msg").textContent = "";
  $("dialogue").showModal();
  $("f-ticker").focus();
}

async function sauver() {
  $("form-msg").textContent = "Enregistrement…";
  try {
    await enregistrerPositions(positions);
    $("form-msg").textContent = "";
  } catch (erreur) {
    $("form-msg").textContent = `Non enregistré : ${erreur.message}`;
  }
  rendre();
}

$("form-position").addEventListener("submit", (event) => {
  event.preventDefault();
  const entree = {
    ticker: $("f-ticker").value.trim().toUpperCase(),
    nom: $("f-nom").value.trim(),
    qte: Number($("f-qte").value.replace(",", ".")) || 0,
    pru: Number($("f-pru").value.replace(",", ".")) || 0,
  };
  if (!entree.ticker) return;
  if (!entree.nom) delete entree.nom;

  // Cours saisis à la main : facultatifs, on ne les garde que s'ils existent.
  const cours = Number($("f-cours").value.replace(",", "."));
  const veille = Number($("f-veille").value.replace(",", "."));
  if (cours > 0) entree.cours = cours;
  if (veille > 0) entree.veille = veille;

  if (rangEdite === null) positions = [...positions, entree];
  else positions = positions.map((p, i) => (i === rangEdite ? entree : p));

  $("dialogue").close();
  sauver();
});

$("f-supprimer").addEventListener("click", () => {
  if (rangEdite === null) return;
  if (!confirm(`Supprimer ${positions[rangEdite].ticker} ?`)) return;
  positions = positions.filter((_, i) => i !== rangEdite);
  $("dialogue").close();
  sauver();
});

$("f-annuler").addEventListener("click", () => $("dialogue").close());
$("btn-ajouter").addEventListener("click", () => ouvrirForm(null));
$("btn-ajouter-vide").addEventListener("click", () => ouvrirForm(null));

$("tbody").addEventListener("click", (event) => {
  const bouton = event.target.closest("[data-edit]");
  if (bouton) ouvrirForm(Number(bouton.dataset.edit));
});

window.addEventListener("resize", () => dessinerTreemap(calculer()));

// --- Démarrage -------------------------------------------------------------

(async () => {
  try {
    positions = await chargerPositions();
  } catch (erreur) {
    $("alerte").hidden = false;
    $("alerte").textContent = `Positions illisibles : ${erreur.message}`;
  }

  // Les cours sont demandés pour les lignes réellement détenues : pas de liste
  // de tickers à tenir à jour à côté.
  const symboles = [...new Set(positions.map((p) => p.ticker).filter(Boolean))];
  let raisonDirect = null;

  try {
    cours = await coursEnDirect(symboles);
  } catch (erreur) {
    raisonDirect = erreur.message;
    try {
      cours = await coursDuDepot();
    } catch {
      // Ni fonction, ni fichier : les lignes s'affichent sans valorisation.
    }
  }

  rendre();

  // Le repli est silencieux pour les lignes qui ont un cours ; on ne le
  // signale que s'il en manque, avec la raison.
  if (raisonDirect && !$("alerte").hidden) {
    $("alerte").innerHTML += `<br><small>Cours en direct indisponibles (${raisonDirect}) — ` +
      `repli sur les cours du dépôt.</small>`;
  }

  document.body.dataset.pret = "1";
})();
