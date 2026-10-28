# Linode deploy — Task-Tool (Seyal)

Server: `zen@172.105.61.231`  
Repo on server: `/home/zen/Task-Tool`  
GitHub: `https://github.com/Urbancode-IT/Task-Tool.git`  
PM2 process: **Task-Tool-backend** only  
Site: `https://seyal.urbancode.in`  
API: `https://api.seyal.urbancode.in`

Do **not** run `pm2 restart all` (that restarts every app on the box).  
Do **not** run `git pull` from `/home/zen` (that is a different repo).

---

## SSH

```bash
ssh zen@172.105.61.231
```

---

## 1. Backend

```bash
cd /home/zen/Task-Tool
git remote -v
git pull origin main

cd /home/zen/Task-Tool/backend
npm install --omit=dev
pm2 restart Task-Tool-backend --update-env
pm2 logs Task-Tool-backend --lines 30 --nostream
```

**Check**

- `git remote -v` shows `Urbancode-IT/Task-Tool`
- Log includes `Database connected OK`
- There is no migration file; schema updates run on backend boot via `dbEnsureTables()`

---

## 2. Frontend

```bash
cd /home/zen/Task-Tool/frontend
npm install
VITE_API_URL=https://api.seyal.urbancode.in npm run build
sudo mkdir -p /var/www/seyal
sudo rm -rf /var/www/seyal/*
sudo cp -r dist/* /var/www/seyal/
```

`VITE_API_URL` is baked into the build. No trailing slash.

Then hard-refresh `https://seyal.urbancode.in` and check Social Media.

---

## Chat (live connection)

Chat uses a live WebSocket connection (Socket.IO) on the same backend port, at the path
`/socket.io/`. Nginx in front of `api.seyal.urbancode.in` must pass WebSocket upgrades through.
Check the server block once:

```bash
sudo grep -rn "api.seyal.urbancode.in" /etc/nginx/sites-enabled/
```

In that file's `location /` block (the one with `proxy_pass` to the backend), make sure these lines exist:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
```

Then test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Without these lines chat still works, but falls back to slower HTTP polling.
`CLIENT_ORIGIN` in `backend/.env` must include `https://seyal.urbancode.in` (the same value CORS already uses).

Chat tables (`chat_*`) are created on backend boot like every other table.

---

## Content pipeline delete log

Pipeline row deletes are stored in `task_delete_log` with `team = 'social_content'`.

```sql
SELECT * FROM public.task_delete_log
WHERE team = 'social_content'
ORDER BY deleted_at DESC;
```

---

## Quick checklist after deploy

- [ ] `pm2 list` → `Task-Tool-backend` is `online`
- [ ] Backend log: `Database connected OK`
- [ ] Site loads: `https://seyal.urbancode.in`
- [ ] Social Media pipeline works (approve / post / green cells)
- [ ] Chat: send a message between two users in two browsers; it appears instantly

---

## Notes

| Item | Detail |
|------|--------|
| DB migrations | None. Applied on API start. |
| Env file | Keep `backend/.env` on the server only. Never commit secrets. |
| Wrong folder | If `git pull` mentions `zen-local`, stop — you are not in Task-Tool. |
| Frontend path | Built files go to `/var/www/seyal/` |
