# OMS Auth Service

Authentication service for the Order Management System. Handles Google OAuth 2.0 login, JWT issuance, and admin user management.

## Stack

- Node.js 20, Express.js
- PostgreSQL (via `pg`)
- JWT (`jsonwebtoken`)
- Passport.js + `passport-google-oauth20`

---

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in every value — see [Environment Variables](#environment-variables) below.

### 3. Run database migrations

```bash
npm run migrate
```

This executes `src/db/schema.sql` against your `DATABASE_URL`, creating all schemas, tables, and triggers. Run once on a fresh database. Re-running on an existing database will fail on duplicate table errors — see note in [Database](#database).

### 4. Start the service

```bash
# Development — auto-reloads on file changes
npm run dev

# Production
npm start
```

The service listens on `PORT` (default `3001`).

---

## Environment Variables

| Variable               | Required | Description                                                                 | Example                                           |
|------------------------|----------|-----------------------------------------------------------------------------|---------------------------------------------------|
| `PORT`                 | No       | HTTP port the server listens on                                             | `3001`                                            |
| `DATABASE_URL`         | Yes      | Full PostgreSQL connection string                                           | `postgresql://user:pass@localhost:5432/oms_auth`  |
| `JWT_SECRET`           | Yes      | Secret used to sign access tokens (HS256). Use a long random string.       | `openssl rand -hex 64`                            |
| `JWT_REFRESH_SECRET`   | Yes      | Separate secret for refresh tokens. Must differ from `JWT_SECRET`.         | `openssl rand -hex 64`                            |
| `GOOGLE_CLIENT_ID`     | Yes      | OAuth 2.0 client ID from Google Cloud Console                              | `123456.apps.googleusercontent.com`               |
| `GOOGLE_CLIENT_SECRET` | Yes      | OAuth 2.0 client secret from Google Cloud Console                          | `GOCSPX-...`                                      |
| `GOOGLE_CALLBACK_URL`  | Yes      | Absolute URL Google redirects to after login. Must match Cloud Console.    | `http://localhost:3001/auth/google/callback`       |
| `FRONTEND_URL`         | Yes      | Base URL of the frontend app — used for post-auth redirects                | `http://localhost:3000`                           |
| `CORS_ORIGIN`          | No       | Allowed CORS origin. Defaults to `*` if unset.                             | `http://localhost:3000`                           |

> **Generating secrets:** `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

---

## Database

The service uses a dedicated `oms_auth` PostgreSQL database. The schema is organized into four PostgreSQL schemas:

| Schema    | Tables                                          | Purpose                              |
|-----------|-------------------------------------------------|--------------------------------------|
| `auth`    | `users`                                         | Approved users and roles             |
| `orders`  | `orders`, `order_items`, `order_status_log`, `recently_viewed` | Order data          |
| `labels`  | `shipping_labels`                               | Uploaded shipping label records      |
| `walmart` | `credentials`, `sync_log`                       | Walmart API integration              |

`npm run migrate` is a one-shot bootstrap. For schema changes after initial setup, write incremental `ALTER TABLE` / `CREATE TABLE` statements and run them manually or add a migration tool (e.g. `node-pg-migrate`).

---

## API Reference

### Auth

| Method | Path                    | Auth    | Description                                                    |
|--------|-------------------------|---------|----------------------------------------------------------------|
| GET    | `/auth/google`          | —       | Redirect to Google OAuth consent screen                        |
| GET    | `/auth/google/callback` | —       | OAuth callback — issues tokens, sets cookie, redirects to frontend |
| POST   | `/auth/refresh`         | Cookie  | Verify `oms_refresh` cookie, return new access token           |
| POST   | `/auth/logout`          | JWT     | Clear refresh cookie                                           |
| GET    | `/auth/me`              | JWT     | Return current user from `auth.users`                          |

**Login flow:**
1. Frontend opens `GET /auth/google`
2. User approves Google consent
3. Service checks `auth.users` — unapproved users are redirected to `FRONTEND_URL/auth/error?reason=not_approved`
4. Approved users are redirected to `FRONTEND_URL/auth/callback?token=<access_token>`; an `oms_refresh` httpOnly cookie is set
5. Frontend stores the access token in memory and uses it as `Authorization: Bearer <token>`

### Admin — User Management

All routes require `Authorization: Bearer <token>` with `role: admin` in the JWT payload.

| Method | Path               | Description                                       |
|--------|--------------------|---------------------------------------------------|
| GET    | `/admin/users`     | List all users, ordered by `created_at DESC`      |
| POST   | `/admin/users`     | Invite a new user (body: `google_email`, `role`, optional `display_name`) |
| PATCH  | `/admin/users/:id` | Update `role` and/or `is_active` for a user       |
| DELETE | `/admin/users/:id` | Soft-deactivate a user (`is_active = false`)      |

**Error response format** (all routes):
```json
{ "error": { "code": "ERROR_CODE", "message": "Human readable message" } }
```

### Health

| Method | Path      | Auth | Description                                         |
|--------|-----------|------|-----------------------------------------------------|
| GET    | `/health` | —    | Returns `{ status, service, timestamp }`. Used by UptimeRobot. |

---

## Deployment — Railway

### First deploy

1. Push this repo to GitHub.
2. In [Railway](https://railway.app), create a new project → **Deploy from GitHub repo** → select this repo.
3. Add a **PostgreSQL** plugin inside the same Railway project. Railway will inject `DATABASE_URL` automatically.
4. Go to the service's **Variables** tab and add all required env vars:
   - `JWT_SECRET`, `JWT_REFRESH_SECRET`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_CALLBACK_URL` — set to `https://<your-railway-domain>/auth/google/callback`
   - `FRONTEND_URL` — your frontend's Railway or custom domain
   - `CORS_ORIGIN` — same as `FRONTEND_URL`
5. Railway uses the `Procfile` (`web: node src/server.js`) as the start command.
6. Trigger a deploy. Once live, run the migration once via Railway's **shell**:
   ```bash
   npm run migrate
   ```

### Update Google Cloud Console

In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → your OAuth 2.0 Client:

- **Authorised JavaScript origins:** `https://<your-railway-domain>`
- **Authorised redirect URIs:** `https://<your-railway-domain>/auth/google/callback`

### Subsequent deploys

Push to the tracked branch — Railway redeploys automatically. No migration step needed unless the schema changed.

### Environment promotion tip

Railway supports multiple environments (e.g. `production`, `staging`). Clone the service into a staging environment and point it at a separate database and Google OAuth client to keep production data isolated.
