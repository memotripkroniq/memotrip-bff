## 🚀 MemoTrip BFF

Backend pro MemoTrip — NestJS + Prisma + PostgreSQL + Railway

<p align="center"> <img src="https://nestjs.com/img/logo-small.svg" width="80" /> </p>

## 📦 Project setup
```bash
$ npm install
```

# ▶️ Run the project
```bash
## development
$ npm run start

## watch mode (recommended)
$ npm run start:dev

## production mode
$ npm run start:prod
```

# 🌍 Environment configuration
## 🧩 Local .env
```bash
DATABASE_URL="postgresql://postgres:<heslo>@localhost:5432/memotrip"
JWT_SECRET="local_secret"
JWT_EXPIRES_IN="7d"
```

## ☁️ Railway (staging / production)
```bash
DATABASE_URL="postgresql://postgres:<secret>@<railway-host>:5432/railway"
JWT_SECRET="staging_secret"
JWT_EXPIRES_IN="7d"
```
👍 .env.staging a .env.production nepatří do Gitu.

# 🧬 Prisma – database commands

✅ Běžný vývoj (nový sloupec / tabulka)

Zásada:
Lokálně generujeme migrace, produkční DB se mění pouze přes Railway deploy.
1️⃣ Uprav databázový model

- změň prisma/schema.prisma (přidání sloupce, tabulky, indexu, relace…)

2️⃣ Vygeneruj migraci lokálně (proti lokální DB)
```bash
npx prisma migrate dev --name add_some_feature
```

3. Commitni změny:
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "DB: add some feature"
git push
```

4. Push -> Railway deploy
- Raiway automaticky spustí => npx prisma migrate deploy
- migrace se aplikuje na produkční databázi

# 🛠️ Ostatní Prisma příkazy
```bash
# regenerate Prisma client
npx prisma generate

# open Prisma Studio
npx prisma studio

# validate schema
npx prisma validate
```

# 📡 API Endpoints
## 👤 Auth
| Method | Endpoint      | Description          | Body                          |
|--------|---------------|----------------------|-------------------------------|
| POST   | /auth/signup  | Registrace uživatele | { email, password, name }     |
| POST   | /auth/login   | Přihlášení           | { email, password }           |


## 🧑‍🤝‍🧑 Users
| Method | Endpoint   | Description                           |
|--------|------------|-------------------------------------- |
| GET    | /users/me  | Vrátí informace o sobě (JWT required) |

## 🧭 Trips
| Method | Endpoint      | Description       |
|--------|---------------|-------------------|
| GET    | /trips        | List tripů        |
| POST   | /trips        | Vytvoření tripu   |
| GET    | /trips/:id    | Detail tripu      |
| DELETE | /trips/:id    | Smazání           |


## 📚 Books (pokud používáš)
| Method | Endpoint     | Description        |
|--------|--------------|--------------------|
| GET    | /books       | List všech knih    |
| POST   | /books       | Vytvoří knihu      |
| GET    | /books/:id   | Detail knihy       |

## 🎨 Themes
| Method | Endpoint      | Description      |
|--------|---------------|------------------|
| GET    | /themes       | Všechny themes   |
| GET    | /themes/:id   | Detail           |

## 👥 Groups
| Method | Endpoint             | Description     |
|--------|----------------------|-----------------|
| GET    | /groups              | List skupin     |
| POST   | /groups              | Create group    |
| POST   | /groups/:id/members  | Add member      |

# 📱 Android Build Flavors
## 🟦 Local (emulátor)
```grandle
BASE_URL = "http://10.0.2.2:3000/"
```

## 🟠 Staging (Railway cloud)
```grandle
BASE_URL = "https://memotrip-bff-production.up.railway.app/"
```

## 🟢 Production
```grandle
BASE_URL = "https://api.memotrip.app/"
```

# 🧳 Railway Deployment
Railway má nastavený pre-deploy step:
```bash
npx prisma migrate deploy
```
Start cmmand:
```bash
npm run start
```

# 📁 Folder Structure
```bash
/prisma
    schema.prisma
    migrations/

/src
    /auth
    /users
    /trips
    /groups
    main.ts
```

# 🔒 Git ignore rules
```bash
# ignore all env files
.env
.env.*
!.env.example
```

# 🧠 Shrnutí jednou větou
Upravím schema.prisma → migrate dev lokálně → commit → Railway migrate deploy.