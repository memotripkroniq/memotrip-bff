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

## ☁️ Staging .env.staging (Railway)
```bash
DATABASE_URL="postgresql://postgres:<secret>@<railway-host>:5432/railway"
JWT_SECRET="staging_secret"
JWT_EXPIRES_IN="7d"
```
👍 .env.staging a .env.production nepatří do Gitu.

# 🧬 Prisma – database commands
```bash
# apply local migrations
$ npx prisma migrate dev --name init

# push schema without migration (staging)
$ npx prisma db push

# regenerate client
$ npx prisma generate

# open visual DB studio
$ npx prisma studio
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

## 🟧 WiFi (telefon v LAN)
```grandle
BASE_URL = "http://192.168.x.x:3000/"
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
```bash
# login
$ railway login


# link project
$ railway link

# deploy
$ railway up

# cloud env vars
$ railway open
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