// Coordonnées du compte unique, partagé avec Home, Series et Simu-SCI.
//
// Aucune clé secrète ici : Finance ne fait que lire la session déposée par
// Home dans le localStorage de l'origine commune. La référence du projet sert
// uniquement à retrouver la bonne clé de stockage.

export const PROJECT_REF = "pyduueytagmzsdwtzltu";

export const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

// Clé publique par conception : elle n'ouvre que ce que les règles RLS
// autorisent, c'est-à-dire les lignes appartenant au compte connecté.
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5ZHV1ZXl0YWdtenNkd3R6bHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTU0ODcsImV4cCI6MjEwMjAzMTQ4N30.6Fl5gkIDF8Vie2o8IRKWSYCFVpTIRw5LSXVHW5TalQk";

// Nom sous lequel les données de ce site sont rangées dans la table user_data.
export const APP_NAME = "bourse";

// Page d'accueil, vers laquelle renvoyer si aucune session valide n'est trouvée.
export const HOME_PATH = "/Home/";

// Exiger que la double authentification ait été franchie (niveau « aal2 »).
// Sans cela, une session arrêtée à l'étape du code à 6 chiffres sur Home —
// donc ouverte avec le mot de passe seul — suffirait à entrer ici.
// À passer à false uniquement si la 2FA est retirée du compte.
export const REQUIRE_AAL2 = true;
