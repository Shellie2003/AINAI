# 🤖 AINAI — Assistante IA pour votre page Facebook

AINAI répond **automatiquement** aux **commentaires** et aux **messages privés (Messenger)** de votre page Facebook, avec l'IA **gratuite Gemini** (Google AI Studio) et, si vous le souhaitez, **Claude**, ChatGPT, Groq, Mistral, OpenRouter, DeepSeek ou Ollama.

Un **mini-site** (tableau de bord) permet de tout relier sans écrire de code : clé Gemini, application Facebook, pages, personnalité, connaissances, règles…

## ✨ Ce qui la rend différente

| Fonction | Ce que ça fait |
|---|---|
| 🔁 **Plusieurs IA avec relais automatique** | Gemini en premier (gratuit) ; si le quota gratuit est épuisé ou en cas de panne, Groq, Claude ou une autre IA prend le relais. L'IA en quota est mise en pause une minute. |
| 🧠 **Compréhension de chaque message** | Pour chaque message, l'IA renvoie la réponse **et** l'intention (question, achat, réclamation, spam…), le sentiment et la langue, puis indique si un humain doit intervenir. |
| 🌍 **Multilingue** | Répond dans la langue du client : français, malgache, anglais… |
| 💬→✉️ **Du commentaire au MP** | Quand quelqu'un commente « prix ? » ou « dispo ? », l'assistante répond publiquement **et** lui envoie un message privé (« réponse privée » Facebook). |
| 🛡️ **Modération** | Les spams, arnaques et insultes sont masqués automatiquement. Les commentaires positifs reçoivent un like. |
| 🎯 **Repérage des prospects** | Les numéros de téléphone, les e-mails et les intentions d'achat sont relevés dans un mini-CRM (statut, notes, export CSV). |
| 🙋 **Prise en main humaine** | Si vous répondez vous-même depuis Messenger, le bot se met en pause pour ce client (12 h par défaut). |
| 📝 **Mode copilote + apprentissage** | L'IA prépare des brouillons que vous validez. **Vos corrections sont mémorisées** comme exemples : elle adopte votre style. |
| 🧵 **Messages en rafale** | Si le client envoie plusieurs messages d'affilée, l'assistante attend quelques secondes et répond une seule fois à l'ensemble, en tenant compte de l'historique de la conversation. |
| 🖼️🎙️ **Photos et messages vocaux** | Gemini lit les photos (« vous avez ce modèle ? ») et comprend les messages vocaux. |
| 📚 **Base de connaissances** | Prix, livraison, horaires, FAQ (import de .txt/.md possible). L'IA n'invente pas ce qui n'y figure pas. |
| ⚡ **Règles par mots-clés** | Réponse fixe instantanée (sans IA ni quota) ou consigne ciblée pour l'IA. |
| 🕘 **Heures d'ouverture et délais humains** | Délai de réponse aléatoire, indicateur « en train d'écrire… », message adapté hors horaires. |
| 🧪 **Simulateur** | Testez l'assistante comme un client, sans rien publier. |
| 🔒 **Sécurité** | Clés API chiffrées (AES-256-GCM), vérification de la signature des webhooks Facebook, tableau de bord protégé par mot de passe, commande « SUPPRIMER » pour l'effacement des données (RGPD). |

## 🚀 Installation

> 📘 **Guide complet pas à pas (Gemini, Upstash / Neon / MongoDB Atlas, Render, Facebook, dépannage) : [GUIDE.md](GUIDE.md)**

### 1. Lancer le serveur

Il faut **Node.js 20 ou plus récent**.

```bash
npm install
cp .env.example .env    # puis éditez ADMIN_PASSWORD, SECRET_KEY et PUBLIC_URL
npm start
```

Ouvrez <http://localhost:3000>. Si `ADMIN_PASSWORD` est vide, le site vous demande de choisir un mot de passe à la première visite.

> Facebook doit pouvoir joindre votre serveur en **HTTPS**. Pour tester depuis votre PC, utilisez un tunnel, par exemple `npx cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`, puis mettez l'adresse obtenue dans `PUBLIC_URL`.

### 🆓 Hébergement 100 % gratuit (Render + une base de données gratuite)

Tout fonctionne sans payer : **Render** (serveur), une **base de données gratuite**, **Gemini** (IA) et **Facebook** (API). Comptez une quinzaine de minutes.

**A. Choisir UNE base de données gratuite**

Le plan gratuit de Render efface son disque à chaque redémarrage : vos réglages doivent donc être stockés ailleurs. AINAI accepte les services suivants ; un seul suffit.

| Service | Gratuit | Ce qu'il faut donner à AINAI |
|---|---|---|
| **Upstash** (Redis) ⭐ conseillé | 256 Mo, 500 000 commandes par mois | `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` |
| **Neon** (Postgres) | 0,5 à 1 Go, environ 100 h de calcul par mois | `DATABASE_URL=postgresql://…` |
| **MongoDB Atlas** | cluster Free (un par projet) | `DATABASE_URL=mongodb+srv://…` |
| **Supabase** | 500 Mo | `SUPABASE_URL` et `SUPABASE_SECRET_KEY`, après avoir exécuté [`supabase.sql`](supabase.sql) |

Avec Upstash, Neon ou MongoDB, **rien d'autre à faire** : AINAI crée lui-même ce dont il a besoin. Toute la base AINAI tient dans un seul enregistrement, de quelques centaines de Ko.

> 💡 **Vous avez déjà atteint la limite de projets Supabase ?** La limite porte sur le nombre de *projets*, pas de tables. Vous pouvez exécuter `supabase.sql` dans un projet existant : AINAI n'y ajoute qu'une table, `ainai_store`.

<details><summary><b>MongoDB Atlas, pas à pas</b> (cluster gratuit parfois introuvable : voir GUIDE.md)</summary>

1. Créez un compte sur <https://www.mongodb.com/cloud/atlas/register>, puis un cluster **M0 (Free)**.
2. **Database Access** : créez un utilisateur et un mot de passe. Évitez les caractères spéciaux comme `@`, `:` ou `/` dans le mot de passe.
3. **Network Access** : ajoutez `0.0.0.0/0`. Render n'a pas d'adresse IP fixe en gratuit, la protection repose donc sur le mot de passe.
4. **Connect → Drivers** : copiez l'adresse `mongodb+srv://…` et remplacez `<db_password>` par votre mot de passe. C'est votre `DATABASE_URL`.
</details>

<details><summary><b>Neon (Postgres), pas à pas</b></summary>

1. Créez un compte sur <https://neon.tech> et un projet.
2. Sur le tableau de bord, cliquez sur **Connect** et copiez la *connection string* (`postgresql://…?sslmode=require`). C'est votre `DATABASE_URL`.
</details>

<details><summary><b>Upstash Redis, pas à pas</b></summary>

1. Créez un compte sur <https://upstash.com> et une base **Redis** (plan Free).
2. Dans la section **REST API**, copiez `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.
</details>

**B. GitHub**
Mettez ce projet dans votre dépôt GitHub. C'est déjà le cas si vous lisez ce fichier sur GitHub.

**C. Render (serveur)**
1. Créez un compte gratuit sur <https://render.com> et connectez votre GitHub.
2. Cliquez sur **New → Blueprint** et choisissez ce dépôt : le fichier `render.yaml` configure tout en mode **Free**.
3. Remplissez les variables demandées :
   - `ADMIN_PASSWORD` : le mot de passe de votre tableau de bord ;
   - les variables de **la** base choisie à l'étape A, en laissant les autres vides ;
   - `PUBLIC_URL` : l'adresse de votre service, par exemple `https://ainai-xxxx.onrender.com`. Vous la verrez après le premier déploiement ; ajoutez-la alors dans **Environment** et redéployez.

   `SECRET_KEY` est générée automatiquement. Ne la changez plus ensuite, sinon les clés API enregistrées deviennent illisibles.
4. Ouvrez votre adresse `https://….onrender.com` : le tableau de bord s'affiche. Dans les journaux Render, la ligne `[store] données chargées depuis …` confirme que la base est bien reliée.

**Pourquoi ça tient sur le gratuit :**
- Render endort un service gratuit après 15 minutes sans visite. AINAI se rend visite toutes les 10 minutes pour rester éveillé et ne pas rater de messages. Par sécurité, vous pouvez aussi créer une tâche gratuite sur <https://cron-job.org> qui appelle `https://VOTRE-ADRESSE/healthz` toutes les 10 minutes.
- Le plan gratuit de Render inclut 750 heures par mois, ce qui suffit pour un service allumé en permanence.
- Les bases gratuites mettent en veille les projets inactifs. AINAI consulte la sienne une fois par jour pour l'éviter, et regroupe ses écritures (au plus une toutes les 10 secondes, compressées pour Upstash) pour rester dans les quotas.
- Les clés API sont chiffrées avant d'être enregistrées : même la base de données ne les voit pas en clair.
- Pour l'IA, Gemini est gratuit. Ajoutez Groq ou OpenRouter, gratuits aussi, comme relais en cas de quota atteint.

> Autres hébergeurs : Koyeb (gratuit), ou n'importe quel VPS. Avec un disque permanent, aucune base distante n'est nécessaire : AINAI utilise alors `data/db.json`.
>
> Vercel n'est pas recommandé : son fonctionnement « serverless » coupe les traitements en arrière-plan, et le plan gratuit est réservé à un usage non commercial.

### 2. Obtenir une clé Gemini (gratuite)

1. Allez sur <https://aistudio.google.com/app/apikey>.
2. Cliquez sur **Create API key** et copiez la clé.
3. Dans le tableau de bord, ouvrez **🧠 Moteurs IA**, choisissez « Google Gemini », collez la clé, cliquez sur **Ajouter**, puis sur **Tester**.

Le bouton ↻ affiche la liste des modèles accessibles avec votre clé.

**Pour ajouter Claude :** créez une clé sur <https://console.anthropic.com/settings/keys> et ajoutez « Anthropic Claude ». Le modèle par défaut est `claude-opus-5-5` ; `claude-haiku-5-5` coûte beaucoup moins cher pour des réponses courtes. Placez Claude en premier pour une qualité maximale, ou en second comme secours de Gemini.

### 3. Relier Facebook

Tout est guidé dans l'onglet **📘 Facebook** :

1. Créez une app sur <https://developers.facebook.com/apps> (type **Entreprise**), puis ajoutez **Messenger** et **Facebook Login**.
2. Collez l'**ID** et la **clé secrète** de l'app dans le tableau de bord.
3. Cliquez sur **⚡ Configurer automatiquement** : le webhook est créé pour vous.
4. Cliquez sur **Se connecter avec Facebook**, choisissez vos pages, puis **Activer l'assistante**.

Permissions utilisées : `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`.

> **Mode développement / mode Live :** tant que l'app est en mode développement, seules les personnes ayant un rôle sur l'app (administrateur, testeur) reçoivent des réponses. Pour répondre à tout le monde, passez l'app en mode **Live** et soumettez ces permissions à l'**examen de l'app** par Meta. L'URL de politique de confidentialité exigée est fournie : `https://VOTRE-DOMAINE/privacy`.

### 4. Personnaliser

- **🎭 Personnalité** : nom, ton, langue, signature, consignes.
- **📚 Connaissances** : vos produits, prix, livraison, horaires…
- **⚙️ Automatisation** : mode automatique ou copilote, modération, MP automatiques, heures d'ouverture, règles.
- **🧪 Simulateur** : testez avant d'activer.

## 🧩 Architecture

```
src/
  server.js           API + webhook + mini-site
  engine.js           traitement des commentaires / MP, file de validation, prospects
  brain.js            prompt, base de connaissances, règles, analyse JSON
  ai/                 Gemini, Claude (SDK officiel), fournisseurs compatibles OpenAI, relais automatique
  facebook/graph.js   API Graph (réponses, MP privés, like, masquage, OAuth)
  store.js            stockage : data/db.json, ou base distante (remotes.js : MongoDB, Postgres, Upstash, Supabase)
public/               tableau de bord (HTML/CSS/JS, sans framework)
test/                 tests (node --test)
```

Pour ajouter une autre IA compatible OpenAI (Together, Fireworks, LM Studio…), choisissez « Autre (compatible OpenAI) » et indiquez l'URL de l'API.

## 🧪 Tests

```bash
npm test
```
