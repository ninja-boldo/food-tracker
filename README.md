# Plate

Everything starts with one command: `cp .env.example .env`, fill in the key and `HOST`, then `docker compose up -d --build`.
Works on amd64 and arm64 (Apple Silicon). Services: the app (http port 8080), local speech-to-text with Parakeet v3 (first start downloads about 1 GB of model), and HTTPS on port 443.

## HTTPS for every device in your LAN
One local root CA signs a certificate for every address you use: the IP in `HOST` and any hostname such as `mymac.local`.
1. Set `HOST` in `.env` to the LAN IP of the machine running Docker.
2. On the phone, open `http://<HOST>:8080/root.crt` in Safari and install the profile.
3. iPhone: Settings, General, About, Certificate Trust Settings, enable full trust for the Caddy root. Android: install it as a CA certificate.
4. Open `https://<HOST>`. The microphone now works.
If the IP changes (DHCP), update `HOST` or use the hostname. Keep the `caddy-data` volume private: it holds the CA key.
