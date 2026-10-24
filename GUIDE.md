# 📘 Guide d'installation pas à pas — AINAI 100 % gratuit

Durée : 30 à 45 minutes la première fois. Aucun paiement n'est nécessaire.

Ordre des étapes :
1. Clé IA Gemini
2. Base de données (Upstash, ou Neon / MongoDB Atlas)
3. Render (mise en ligne)
4. Premier accès au tableau de bord
5. Application Facebook
6. Tâche cron-job.org (anti-sommeil)
7. Tests et passage en public

Gardez un **bloc-notes** ouvert : vous allez y copier plusieurs clés. Ne les partagez avec personne.

---

## Étape 1 — Clé Gemini (IA gratuite)

1. Ouvrez <https://aistudio.google.com/app/apikey> et connectez-vous avec un compte Google.
2. Acceptez les conditions si on vous le demande.
3. Cliquez sur **Create API key**. Si on vous demande un projet Google Cloud, choisissez-en un ou laissez-le créer.
4. Copiez la clé (elle commence par `AIza…`) dans votre bloc-notes : **CLÉ GEMINI**.

**Fortement conseillé : une ou deux IA de secours gratuites.** Le Gemini gratuit est parfois saturé (erreur 503) : sans IA de secours, les clients n'ont pas de réponse pendant ce temps. Voir la section **IA de secours** juste en dessous.

### IA de secours (gratuites, sans carte bancaire)

Ajoutez-les dans l'onglet **🧠 Moteurs IA** : **Fournisseur** → collez la clé → **Ajouter** → **Tester**. Le champ « Modèle » se remplit tout seul ; ne le changez pas. Ordre conseillé (glisser-déposer) : **1. Gemini → 2. Groq → 3. Cerebras → 4. OpenRouter**.

| IA | Où obtenir la clé | Modèle par défaut | À savoir |
|---|---|---|---|
| **Groq** | <https://console.groq.com/keys> → **Create API Key** (`gsk_…`) | `llama-3.3-70b-versatile` | Très rapide. Limité à environ 1 000 requêtes par jour pour ce modèle. |
| **Cerebras** | <https://cloud.cerebras.ai> → **API Keys** → **Generate API Key** (`csk-…`) | `gpt-oss-120b` | Très rapide. En gratuit, la conversation est limitée en longueur : il convient comme secours, avec une base de connaissances courte. |
| **OpenRouter** | <https://openrouter.ai/keys> → **Create Key** (`sk-or-…`) | `openrouter/free` | Choisit à chaque fois un modèle gratuit disponible. Limité à environ 50 requêtes par jour sans crédit acheté. |
| **Mistral** | <https://console.mistral.ai> → choisir le plan **Experiment** (gratuit, vérification par téléphone) → **API Keys** | `mistral-small-latest` | IA européenne, bonne en français. |
| **Claude** (payant) | <https://console.anthropic.com/settings/keys> | `claude-opus-5-5` | Excellente rédaction. `claude-haiku-5-5` est bien moins cher. |

**Comment ça marche :**
- Si une IA échoue (saturée, quota du jour atteint, panne), la suivante répond automatiquement. Le client ne voit rien.
- Une IA qui renvoie « quota dépassé » est mise de côté pendant 1 minute.
- Si un fournisseur retire un modèle, l'assistante en choisit un autre dans sa liste et le retient. Un message 🔄 apparaît dans le Journal.
- Gemini reste n°1 : c'est la seule à comprendre les **photos et les messages vocaux**. Quand un client envoie une photo, les IA qui savent lire les images passent en premier.

---

## Étape 2 — Base de données gratuite

Choisissez **une seule** option. **Upstash est conseillée** : c'est la plus simple (aucun cluster ni réseau à configurer, pas de mise en veille) et AINAI y compresse ses données pour rester largement dans le gratuit.

### Option A — Upstash Redis ⭐ (conseillée)

1. Ouvrez <https://console.upstash.com> et créez un compte (Google, GitHub ou e-mail). Aucune carte bancaire n'est demandée.
2. Dans le menu **Redis**, cliquez sur **Create Database** :
   - Name : `ainai` ;
   - Primary Region : **Europe (Frankfurt)**, ou la région européenne la plus proche proposée ;
   - plan : **Free** ;
   - cliquez sur **Create**. Si une option « Eviction » est proposée, **laissez-la désactivée** : elle supprimerait des données.
3. Sur la page de la base, ouvrez l'onglet ou la section **REST API** (parfois sous **Connect → REST**). Copiez dans votre bloc-notes :
   - `UPSTASH_REDIS_REST_URL` : l'adresse en `https://….upstash.io` ;
   - `UPSTASH_REDIS_REST_TOKEN` : le jeton (cliquez sur l'œil 👁 pour l'afficher). N'utilisez **pas** le jeton « Read-Only ».

✅ C'est tout. Sur Render (étape 3), vous remplirez ces deux variables et laisserez `DATABASE_URL` vide ou à `-`.

Le gratuit d'Upstash compte 256 Mo, 500 000 commandes et 10 Go de transfert par mois. AINAI écrit au plus une fois toutes les 10 secondes, données compressées, ce qui couvre largement une page active.

### Option B — Neon (Postgres)

1. Ouvrez <https://neon.tech> → **Sign up**. Aucune carte bancaire n'est demandée.
2. Créez un projet : nom `ainai`, Postgres en version par défaut, région **AWS Europe Central (Frankfurt)**.
3. Sur le tableau de bord du projet, cliquez sur **Connect**. Copiez la *connection string* qui commence par `postgresql://` et se termine par `?sslmode=require` : c'est votre **DATABASE_URL**.
   - Si vous voyez une case **Connection pooling**, vous pouvez la laisser cochée : les deux fonctionnent.

✅ AINAI crée lui-même sa table au premier démarrage.

> Neon gratuit endort la base après 5 minutes sans activité. AINAI ferme ses connexions inutilisées pour la laisser dormir et ne pas épuiser les heures de calcul gratuites (environ 100 par mois). Pour une page qui reçoit des messages toute la journée sans interruption, préférez Upstash.

### Option C — MongoDB Atlas

D'après la documentation officielle, MongoDB propose toujours un cluster gratuit (**M0 / Free**), mais l'écran de création change souvent. Si vous ne le voyez pas :
- sur l'écran **Create a cluster / Deploy your cluster**, cherchez la carte **Free** (parfois à droite de **Flex**, qui, elle, est payante) ;
- Atlas n'autorise **qu'un seul cluster gratuit par projet**. Si vous en avez déjà un, créez un **nouveau projet** (menu en haut à gauche → **New Project**), puis créez le cluster dedans ;
- un cluster gratuit sans aucune connexion pendant 30 jours est mis en pause ; AINAI s'y connecte tous les jours.

Ensuite :
1. Choisissez **Free**, provider **AWS**, région **Frankfurt**, nom `ainai` → **Create Deployment**.
2. Créez l'utilisateur : nom `ainai`, **Autogenerate Secure Password** (copiez-le) → **Create Database User**.
3. **Choose a connection method → Drivers → Node.js** : copiez l'adresse `mongodb+srv://ainai:<db_password>@…` et remplacez `<db_password>` par votre mot de passe. C'est votre **DATABASE_URL**.
4. **Security → Network Access → Add IP Address → Allow access from anywhere** (`0.0.0.0/0`) → **Confirm**.

Si le gratuit reste introuvable, prenez Upstash (option A).

### Option D — Supabase (projet existant)

La limite du plan gratuit porte sur le nombre de projets, pas de tables : vous pouvez réutiliser un projet existant.
1. Ouvrez le projet → **SQL Editor** → **New query**. Collez le contenu de [`supabase.sql`](supabase.sql), puis cliquez sur **Run**.
2. **Project Settings → API Keys** : copiez l'**URL du projet** (`SUPABASE_URL`) et la **clé secrète** (`SUPABASE_SECRET_KEY`).

---

## Étape 3 — Mise en ligne sur Render

1. Ouvrez <https://render.com> → **Get Started**. Inscrivez-vous **avec GitHub** : c'est le plus simple.
2. Autorisez Render à accéder à votre dépôt **AINAI**. Choisissez « Only select repositories », puis sélectionnez `AINAI`.
3. Dans le tableau de bord Render : **New +** → **Blueprint**.
4. Choisissez le dépôt **AINAI** et la branche qui contient le code (celle où se trouve `render.yaml`).
5. Donnez un nom au Blueprint (par exemple `ainai`). Render lit `render.yaml` et affiche un service web **ainai** en plan **Free**.
6. Remplissez les variables :
   | Variable | Valeur |
   |---|---|
   | `ADMIN_PASSWORD` | un mot de passe solide pour **votre** tableau de bord |
   | `PUBLIC_URL` | laissez vide pour l'instant (étape 3.8) |
   | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | si vous avez choisi Upstash (conseillé) |
   | `DATABASE_URL` | si vous avez choisi Neon ou MongoDB : leur adresse (étape 2) |
   | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | seulement si vous avez choisi Supabase |

   Laissez vides les variables des bases que vous n'utilisez pas. Si Render exige une valeur, mettez simplement `-` : AINAI la considère comme vide.
   `SECRET_KEY` est générée automatiquement : **ne la modifiez jamais**, sinon les clés enregistrées deviennent illisibles.
7. Cliquez sur **Deploy Blueprint**. Attendez 2 à 5 minutes, jusqu'au statut **Live**.
8. En haut de la page du service, Render affiche son adresse, par exemple `https://ainai-x1y2.onrender.com`. Copiez-la : **ADRESSE DU SITE**.
   - Allez dans **Environment**, mettez cette adresse dans `PUBLIC_URL`, **sans `/` à la fin**.
   - Cliquez sur **Save, rebuild, and deploy**.
9. Vérifiez dans l'onglet **Logs** que vous voyez :
   ```
   [store] données chargées depuis Upstash Redis      (ou Postgres / MongoDB / Supabase)
   AINAI prêt sur http://localhost:10000
   ```
   Si vous voyez une erreur, consultez la section Dépannage en bas de ce guide.

---

## Étape 4 — Premier accès au tableau de bord

1. Ouvrez votre **ADRESSE DU SITE** et connectez-vous avec `ADMIN_PASSWORD`.
2. Onglet **🧠 Moteurs IA** :
   - Fournisseur **Google Gemini** → collez la **CLÉ GEMINI** → **Ajouter** → **Tester** (un ✅ doit apparaître) ;
   - (conseillé) Fournisseur **Groq** → collez la **CLÉ GROQ** → **Ajouter** → **Tester**. Il servira de relais.
   - Pour **Claude** : clé sur <https://console.anthropic.com/settings/keys> (payant), fournisseur **Anthropic Claude**.
3. Onglet **🎭 Personnalité** : nom de votre page, description de l'activité, ton.
4. Onglet **📚 Connaissances** : ajoutez des fiches « Tarifs », « Livraison », « Horaires », « Contact »…
5. Onglet **🧪 Simulateur** : écrivez comme un client (« Combien coûte la livraison ? ») et vérifiez les réponses.

---

## Étape 5 — Application Facebook (Meta for Developers)

Il vous faut un compte Facebook **administrateur de la page**.

### 5.1 Compte développeur
1. Ouvrez <https://developers.facebook.com> → **Commencer** / **Get Started**. Validez votre compte (téléphone ou e-mail) si on vous le demande.

### 5.2 Créer l'application
1. <https://developers.facebook.com/apps> → **Créer une app**.
2. Nom : `AINAI Assistante` (n'utilisez pas « Facebook » ni « Meta » dans le nom). Indiquez votre e-mail.
3. Cas d'utilisation : choisissez **Autre**, puis le type **Entreprise**.
   > Si votre écran est différent, choisissez le cas d'utilisation **« Interagir avec les clients sur Messenger »**.
4. Portefeuille d'entreprise : vous pouvez choisir « Je ne veux pas en associer pour le moment ».
5. **Créer l'app**, puis confirmez votre mot de passe Facebook.

### 5.3 Ajouter les produits
Dans le tableau de bord de l'app (**Ajouter des produits**) :
1. **Messenger** → **Configurer**.
2. **Facebook Login** (ou **Facebook Login for Business**) → **Configurer**.
   Dans **Paramètres** de Facebook Login, à **URI de redirection OAuth valides**, collez :
   ```
   https://VOTRE-ADRESSE.onrender.com/auth/facebook/callback
   ```
   L'adresse exacte est affichée dans l'onglet 📘 Facebook de votre tableau de bord, avec un bouton « Copier ». Cliquez sur **Enregistrer les modifications**.

### 5.4 Paramètres de base
**Paramètres de l'app → Général** (ou « Basique ») :
1. **URL de la politique de confidentialité** : `https://VOTRE-ADRESSE.onrender.com/privacy`
2. **Domaines de l'app** : `VOTRE-ADRESSE.onrender.com` (sans `https://`).
3. Catégorie : par exemple « Entreprises et pages ».
4. **Enregistrer les modifications**.
5. Copiez l'**ID de l'app**, puis cliquez sur **Afficher** à côté de la **Clé secrète** et copiez-la.

### 5.5 Relier l'app à AINAI
Dans votre tableau de bord AINAI, onglet **📘 Facebook** :
1. Collez l'**ID de l'app** et la **Clé secrète** → **Enregistrer**.
2. Cliquez sur **⚡ Configurer automatiquement** : le webhook (réception des messages) est créé.
   > En cas d'échec, faites-le à la main : dans Meta, **Messenger → Paramètres de l'API Messenger → Configurer les webhooks**. Collez l'**URL de rappel** et le **Jeton de vérification** affichés dans AINAI → **Vérifier et enregistrer**. Abonnez-vous ensuite aux champs `messages`, `messaging_postbacks`, `message_echoes` et `feed`.
3. Cliquez sur **Se connecter avec Facebook**, acceptez toutes les autorisations demandées et **cochez votre page**.
4. De retour dans AINAI, votre page apparaît : cliquez sur **Activer l'assistante**. La pastille passe à **● Active**.

> **Le bouton « Se connecter avec Facebook » ne marche pas ?** Utilisez la méthode de secours :
> 1. Ouvrez l'[Explorateur de l'API Graph](https://developers.facebook.com/tools/explorer/).
> 2. À droite, choisissez votre app **AINAI Assistante**.
> 3. Dans **Autorisations**, ajoutez : `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`.
> 4. Cliquez sur **Generate Access Token**, puis acceptez en sélectionnant votre page.
> 5. Copiez le jeton. Dans AINAI, ouvrez « Autre méthode : coller un jeton d'accès », collez-le, cliquez sur **Importer**, puis sur **Activer l'assistante**.

---

## Étape 6 — Anti-sommeil (cron-job.org)

AINAI se réveille déjà tout seul toutes les 10 minutes. Ce second réveil, externe, est une sécurité supplémentaire.

1. Ouvrez <https://cron-job.org> → **Sign up** (gratuit), puis confirmez votre e-mail.
2. **Create cronjob** :
   - Title : `AINAI` ;
   - URL : `https://VOTRE-ADRESSE.onrender.com/healthz` ;
   - Execution schedule : **Every 10 minutes**.
3. **Create**. La colonne « Last execution » doit afficher **200 OK**.

---

## Étape 7 — Tester, puis ouvrir au public

### 7.1 Test (mode développement)
Tant que l'app est en **mode développement**, Facebook n'envoie que les messages des personnes qui ont un **rôle** sur l'app.
1. Avec votre compte (administrateur de l'app), envoyez un MP à votre page et commentez une publication.
2. Pour faire tester un ami : **Rôles de l'app → Rôles → Ajouter des personnes → Testeur**. Il doit accepter l'invitation sur <https://developers.facebook.com/requests>.
3. Dans AINAI, regardez l'onglet **📜 Journal**. Vous devez y voir « ✅ Webhook vérifié », puis les réponses envoyées.

### 7.2 Passer en public (mode Live)
Pour que l'assistante réponde à **tout le monde** :
1. **Paramètres de l'app → Général** : vérifiez la politique de confidentialité, l'icône (1024×1024) et la catégorie.
2. **Vérification de l'app → Autorisations et fonctionnalités** : demandez l'**accès avancé** pour `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_read_user_content` et `pages_manage_engagement`.
3. Pour chaque autorisation, Meta demande une explication et une **courte vidéo** montrant l'usage (par exemple : un client envoie un message, l'assistante répond, vous montrez le tableau de bord).
4. Meta peut demander la **vérification de l'entreprise** (documents officiels).
5. Une fois l'examen validé (quelques jours en général), basculez le mode de l'app sur **Live** (en haut du tableau de bord).

---

## 🛠️ Dépannage

| Problème | Solution |
|---|---|
| Logs Render : `SECRET_KEY est obligatoire…` | Dans **Environment**, vérifiez que `SECRET_KEY` existe et n'est pas vide. |
| Logs : `MongoServerSelectionError` / timeout | Atlas → **Network Access** : `0.0.0.0/0` doit être **Active**. |
| Logs : `bad auth` / `Authentication failed` | Mot de passe erroné dans `DATABASE_URL`, ou `<db_password>` non remplacé. Régénérez un mot de passe sans caractères spéciaux. |
| Logs : `DATABASE_URL doit commencer par…` | L'adresse doit commencer par `mongodb+srv://`, `mongodb://`, `postgresql://` ou `postgres://`. |
| Logs : `Upstash 401` | URL ou jeton Upstash mal copié : utilisez ceux de la section **REST API**, pas le jeton « Read-Only ». |
| Logs : `Upstash 400` / `max request size` | Base trop grosse (rare) : videz le Journal ou contactez-moi. |
| « Configurer automatiquement » : erreur HTTPS | `PUBLIC_URL` est vide ou incorrect (étape 3.8). |
| Facebook : « L'URL de rappel n'a pas pu être validée » | Le service Render dormait ou redémarrait : patientez 1 minute et réessayez. Vérifiez que le jeton est identique. |
| Le bot ne répond pas | 1) La page est-elle **● Active** ? 2) Journal : « Toutes les IA ont échoué » signifie une clé IA invalide, à retester dans 🧠 Moteurs IA. 3) Mode développement : l'auteur du message a-t-il un rôle sur l'app ? 4) Le client est-il en pause « prise en main humaine » (onglet 💬 Conversations) ? |
| « Toutes les IA ont échoué… 429 » | Quota gratuit de Gemini atteint : ajoutez Groq ou OpenRouter comme relais. |
| Les réglages ont disparu | Aucune base n'est reliée : une alerte rouge s'affiche sur l'accueil. Refaites l'étape 2 et renseignez les variables. |
| Mot de passe du tableau de bord oublié | Changez `ADMIN_PASSWORD` dans **Environment** sur Render. |
