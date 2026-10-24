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

---

## Notes

| Item | Detail |
|------|--------|
| DB migrations | None. Applied on API start. |
| Env file | Keep `backend/.env` on the server only. Never commit secrets. |
| Wrong folder | If `git pull` mentions `zen-local`, stop — you are not in Task-Tool. |
| Frontend path | Built files go to `/var/www/seyal/` |
