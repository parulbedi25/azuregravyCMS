# Deploying Azure Gravy on cPanel (Namecheap, Hostinger, GoDaddy…)

Tested against the standard **cPanel → Setup Node.js App** flow (Phusion Passenger). You need:

- a Node.js 20+ application slot in cPanel,
- one MySQL database and one MySQL user.

Total time: about ten minutes, most of it waiting for `npm install`.

---

## 1. Create the database

**cPanel → Databases → MySQL® Databases**

1. **Create New Database** — name it, e.g. `gravy`.
   cPanel prefixes it with your account: `myaccount_gravy`. **Write down the full name.**
2. **Add New User** — choose a user name and a strong password.
   Also prefixed: `myaccount_gravy`. **Write down the full user name and the password.**
3. **Add User To Database** — select the user, select the database, **Add**, tick
   **ALL PRIVILEGES**, then **Make Changes**.

You do *not* need to create any tables. The application creates them.

> Remote MySQL is not needed. The app connects from the same server (`localhost`).

---

## 2. Upload the code

Two options.

### a) Git (if the host offers "Git™ Version Control")

Create a repository pointing at `https://github.com/parulbedi25/azuregravyCMS.git`, branch `main`,
and deploy. The application root is the directory cPanel creates for it.

### b) File Manager / SFTP

Upload the repository **without** `node_modules` and without `.git`:

```
/home/myaccount/azuregravy/         ← application root
├── app.js
├── package.json
├── src/
├── views/
├── public/
├── docs/
└── .env.example
```

`public/` must ship with the code — it holds the CSS, fonts and demo images.

---

## 3. Create the Node.js application

**cPanel → Software → Setup Node.js App → Create Application**

| Field | Value |
| --- | --- |
| Node.js version | **20** or newer |
| Application mode | **Production** |
| Application root | the folder from step 2, e.g. `azuregravy` |
| Application URL | your domain or subdomain |
| **Application startup file** | **`app.js`** |

`app.js` is a thin loader that runs the TypeScript server through tsx, so **no build step is required**
on the host. (If you would rather ship a compiled build, run `npm run build` locally, upload `dist/`,
and set the startup file to `dist/server.js`.)

Click **Create**.

---

## 4. Environment variables

Still on the application screen, open **Environment variables** and add:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` | `myaccount_gravy` *(full name from step 1)* |
| `DB_USER` | `myaccount_gravy` *(full name from step 1)* |
| `DB_PASSWORD` | the password you set |
| `SESSION_SECRET` | 64+ random characters — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SITE_URL` | `https://yourdomain.com` *(optional — detected automatically when blank)* |

Leave `PORT` **unset**: Passenger provides it. If your host does expose one, the app accepts either a
port number or a socket path.

Prefer a file? Copy `.env.example` to `.env` in the application root and fill in the same values.
Environment variables take precedence over the file.

---

## 5. Install dependencies

Click **Run NPM Install** in the Node.js App screen, or from a terminal:

```bash
cd ~/azuregravy
npm install --omit=dev
```

`tsx` is a production dependency on purpose, so `npm start` works without dev dependencies.

---

## 6. Restart and finish setup in the browser

Click **Restart**. Then open:

```
https://yourdomain.com/admin/setup
```

Fill in the publication name, your name, e-mail and a password. That creates the super admin, the
starter pages (About, Contact, Privacy, Terms), the menus and one welcome story — and signs you in.

**Then delete or edit the welcome story**, and replace the About/Privacy/Terms text.

### Prefer to create the admin from the terminal?

Add `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` to the environment, then either restart the app
or run:

```bash
npm run db:setup
```

The wizard then reports that the site is already installed and sends you to the normal sign-in page.

---

## 7. Writable uploads folder

Media uploads are written to `public/uploads/`. If the boot log says it is not writable:

```bash
chmod -R 775 public/uploads
```

(Some hosts need `755` with the file group set to your account — ask support if neither works.)

---

## What the first boot actually does

```
  Azure Gravy CMS
  environment : production
  database    : myaccount_gravy@localhost:3306/myaccount_gravy
  tables      : 19 ready

  ✔ Listening on socket /tmp/passenger.../node.socket
    Site    /
    Studio  /admin

  First run — open /admin/setup to create your administrator account.
```

Every later start is a no-op for the schema: tables are only created when missing, and settings you
have changed are never overwritten. It is safe to restart as often as you like.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `✖ Could not connect … (ER_ACCESS_DENIED_ERROR)` | Wrong user/password, or the user was not added to the database. Re-check step 1.3 (`ALL PRIVILEGES`). |
| `… the database does not exist and this user cannot create it` | The `DB_NAME` is wrong or the database was never created. Use the **full** prefixed name. |
| `ECONNREFUSED` / `ETIMEDOUT` | `DB_HOST` is wrong. On cPanel it is always `localhost`. |
| The site shows a Passenger error page | Check the application's **stderr log** in cPanel; the app prints a specific reason and exits. |
| `Dependencies are missing` | **Run NPM Install** again, or `npm install --omit=dev`. |
| Blank page, assets 404 | `public/` was not uploaded, or the application root is one level too deep. |
| Uploads fail | `public/uploads` is not writable (step 7). |
| Logged out on every restart | `SESSION_SECRET` changes between restarts, or the `sessions` table is missing (restart once after the DB is reachable). |
| 502 / app keeps restarting | Node version below 20, or `app.js` is not the startup file. |

---

## Updating

```bash
cd ~/azuregravy
git pull            # or re-upload the changed files
npm install --omit=dev
# then Restart in the Node.js App screen
```

Any new tables or settings are created automatically on the next start. Back up the database and
`public/uploads/` first.
