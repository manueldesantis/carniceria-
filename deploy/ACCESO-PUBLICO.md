# ClienteBD — URL fija desde cualquier ciudad / país

El celular **no** usa la IP `192.168.x.x` fuera del local.  
Necesita una **URL pública HTTPS** que apunte a ClienteBD; ClienteBD sigue leyendo **MongoDB Atlas** (nube).

```
Celular (cualquier país)  →  https://SU-URL-FIJA  →  ClienteBD  →  MongoDB Atlas
```

---

## Opción recomendada: Render.com (gratis, URL fija HTTPS)

1. Cree una cuenta en [https://dashboard.render.com](https://dashboard.render.com)
2. **New** → **Web Service**
3. Conecte el código de ClienteBD (GitHub) **o** suba el ZIP generado por:
   ```bat
   scripts\preparar-deploy-publico.bat
   ```
4. Configure:
   - **Runtime:** Node
   - **Build:** `npm install --omit=dev`
   - **Start:** `node api/server.js`
5. Variables de entorno (Environment):

| Variable | Valor |
|----------|--------|
| `MONGODB_URI` | La misma de `api\.env` (Atlas) |
| `MONGODB_DB` | `syncdbf` |
| `APP_PASSWORD` | Opcional si sube `api/claveclie.key`; si no, use esta variable |
| `PUBLIC_BASE_URL` | `https://clientebd-julioabe.onrender.com` (la que Render le asigne) |

6. En **MongoDB Atlas** → Network Access → permita `0.0.0.0/0` (o las IPs de Render).
7. Tras el deploy, la URL fija será del estilo:
   ```
   https://clientebd-julioabe.onrender.com
   ```
8. En el celular (cualquier país): abra esa URL → instale PWA desde `/instalar-movil.html`.

**Nota:** en plan free, Render puede “dormir” tras inactividad; el primer acceso tarda ~30–60 s. Para 24/7 use plan pago o un VPS.

Guarde la URL en `api\.env`:

```ini
PUBLIC_BASE_URL=https://clientebd-julioabe.onrender.com
```

Luego `scripts\start-en-red.bat` también la escribirá en `dist\URLs-ClienteBD-RED.txt`.

---

## Opción B: VPS propio (Windows o Linux)

1. Copie al servidor la carpeta generada por `scripts\preparar-deploy-publico.bat`
2. En el servidor:
   ```bat
   npm install --omit=dev
   node api\server.js
   ```
3. Ponga **nginx** o Caddy con HTTPS (ejemplo: `deploy\nginx-clientebd.conf`)
4. Abra firewall solo puerto **443**
5. URL fija: `https://cliente.tudominio.com`

Windows (servicio siempre encendido):

```bat
scripts\instalar-servicio-windows.bat
```

---

## Opción C: PC del negocio + Cloudflare Tunnel (URL fija)

Si la PC del negocio está siempre encendida:

1. Cuenta gratuita en Cloudflare
2. Instale `cloudflared` y cree un **túnel con nombre**
3. Asocie un hostname (dominio propio o el que Cloudflare le dé)
4. El túnel apunta a `http://127.0.0.1:3080`
5. Ejecute ClienteBD como servicio + el túnel al iniciar Windows

Guía rápida: `scripts\publicar-cloudflare.bat`

---

## Qué NO alcanza

| Método | ¿Sirve desde otro país? |
|--------|-------------------------|
| `http://192.168.x.x:3080` | No (solo WiFi local) |
| `start-en-red.bat` solo | No |
| Portable en una PC con internet | Sí (esa PC) |
| URL pública HTTPS (Render/VPS/túnel) | Sí (celular desde cualquier lado) |

---

## Checklist

- [ ] ClienteBD publicado con HTTPS
- [ ] `MONGODB_URI` de Atlas configurado en el hosting
- [ ] Atlas permite conexiones desde internet (`0.0.0.0/0` o IPs del host)
- [ ] `APP_PASSWORD` cambiado
- [ ] URL anotada en `PUBLIC_BASE_URL` y compartida al celular
- [ ] En el celular: Abrir URL → Agregar a pantalla de inicio
