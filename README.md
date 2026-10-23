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

### 1. Lancer le serveur

Il faut **Node.js 20 ou plus récent**.

```bash
npm install
cp .env.example .env    # puis éditez ADMIN_PASSWORD, SECRET_KEY et PUBLIC_URL
npm start
```

Ouvrez <http://localhost:3000>. Si `ADMIN_PASSWORD` est vide, le site vous demande de choisir un mot de passe à la première visite.

> Facebook doit pouvoir joindre votre serveur en **HTTPS**. Pour tester depuis votre PC, utilisez un tunnel, par exemple `npx cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`, puis mettez l'adresse obtenue dans `PUBLIC_URL`.

**Hébergement conseillé :** Render (le fichier `render.yaml` est fourni), Railway, Fly.io ou un VPS. Prévoyez un **disque persistant** pour `DATA_DIR` : sur un hébergement gratuit sans disque, les réglages sont effacés à chaque redémarrage.

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
  store.js            stockage JSON (data/db.json)
public/               tableau de bord (HTML/CSS/JS, sans framework)
test/                 tests (node --test)
```

Pour ajouter une autre IA compatible OpenAI (Together, Fireworks, LM Studio…), choisissez « Autre (compatible OpenAI) » et indiquez l'URL de l'API.

## 🧪 Tests

```bash
npm test
```
