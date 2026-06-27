# Nginx + Let's Encrypt Setup

This setup exposes the screener at `https://screener.itnomad.space` with nginx and
Let's Encrypt. The Node app does not handle TLS and does not bind public ports; it
listens locally on `127.0.0.1:3000`.

## 1. Point DNS at the server

Create or update an `A` record:

```text
screener.itnomad.space -> <server IPv4 address>
```

If the server has IPv6, add an `AAAA` record too. Wait until DNS resolves from the
server:

```bash
dig +short screener.itnomad.space
```

## 2. Configure the app for localhost

In `config.js`:

```javascript
web: {
  port: 3000,
  host: "127.0.0.1",
},
```

Deploy and restart PM2:

```bash
./update.sh
pm2 status
pm2 logs pump-web
curl -i http://127.0.0.1:3000/healthz
```

The health check should return `200 OK` with `ok`.

## 3. Install nginx and Certbot

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y nginx snapd
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
```

Open HTTP/HTTPS in the firewall if UFW is enabled:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw status
```

## 4. Add the nginx reverse proxy

Create `/etc/nginx/sites-available/pump-screener`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name screener.itnomad.space;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -sf /etc/nginx/sites-available/pump-screener /etc/nginx/sites-enabled/pump-screener
sudo nginx -t
sudo systemctl reload nginx
curl -I http://screener.itnomad.space
```

## 5. Issue the Let's Encrypt certificate

```bash
sudo certbot --nginx -d screener.itnomad.space --redirect
```

Follow the prompts and enter your email address. Certbot will update nginx with the
TLS server block and HTTP-to-HTTPS redirect.

Verify renewal:

```bash
sudo certbot renew --dry-run
```

## 6. Useful checks

```bash
pm2 status
pm2 logs pump-web
curl -i http://127.0.0.1:3000/healthz
sudo nginx -t
sudo systemctl status nginx
sudo certbot certificates
```

If the public site times out, check DNS, cloud firewall/security-group rules, and
that ports `80` and `443` are reachable from the internet. If nginx returns `502 Bad
Gateway`, check `pm2 logs pump-web` and the local health check.

References:

- Certbot nginx instructions: <https://certbot.eff.org/instructions?os=snap&ws=nginx>
- NGINX reverse proxy docs: <https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/>
