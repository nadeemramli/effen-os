#!/usr/bin/env python3
"""Mint a Supabase session for E2E testing without disabling auth captcha.

hCaptcha on the effen-os Supabase project blocks headless password logins
(captcha_failed). This mints a session server-side instead: Management API
(CLI access token) → service key → auth admin generate_link (magiclink) →
verify token_hash → session. Captcha protection stays on for humans.

Writes ~/.config/effen-os/e2e-session.json (mode 600) in the exact shape
supabase-js stores under localStorage key `sb-<ref>-auth-token`, so a browser
E2E harness can inject it and land authenticated:

  localStorage.setItem("sb-wwgtjjekhehaepbxyrij-auth-token",
                       fs.readFileSync("~/.config/effen-os/e2e-session.json"))

Requires: ~/.supabase/access-token (supabase login) and
~/.config/effen-os/e2e.env (EFFEN_E2E_EMAIL).
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

PROJECT_REF = "wwgtjjekhehaepbxyrij"
PUBLISHABLE_KEY = "sb_publishable_Wdp9R_p1SiVdgrKIQ8fLVA_aNekE-k6"
UA = "supabase-cli/2.33.9 effen-e2e"
OUT_PATH = Path.home() / ".config" / "effen-os" / "e2e-session.json"


def req(url, token, body=None, apikey=None):
    headers = {"User-Agent": UA, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if apikey:
        headers["apikey"] = apikey
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                               method="POST" if body is not None else "GET", headers=headers)
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode())


def main():
    email = None
    env_path = Path.home() / ".config" / "effen-os" / "e2e.env"
    for line in env_path.read_text().splitlines():
        if line.startswith("EFFEN_E2E_EMAIL="):
            email = line.split("=", 1)[1].strip()
    if not email:
        sys.exit(f"EFFEN_E2E_EMAIL not found in {env_path}")

    mgmt_token = (Path.home() / ".supabase" / "access-token").read_text().strip()

    keys = req(f"https://api.supabase.com/v1/projects/{PROJECT_REF}/api-keys?reveal=true", mgmt_token)
    service_key = next(k["api_key"] for k in keys if k.get("name") == "service_role")

    link = req(f"https://{PROJECT_REF}.supabase.co/auth/v1/admin/generate_link",
               service_key, {"type": "magiclink", "email": email}, apikey=service_key)
    token_hash = link.get("hashed_token") or link.get("properties", {}).get("hashed_token")
    if not token_hash:
        sys.exit(f"generate_link gave no hashed_token: {link}")

    session = req(f"https://{PROJECT_REF}.supabase.co/auth/v1/verify",
                  None, {"type": "magiclink", "token_hash": token_hash}, apikey=PUBLISHABLE_KEY)
    if "access_token" not in session:
        sys.exit(f"verify failed: {session}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(session))
    OUT_PATH.chmod(0o600)
    print(f"session minted for {session['user']['email']} → {OUT_PATH}")
    print(f"localStorage key: sb-{PROJECT_REF}-auth-token")


if __name__ == "__main__":
    main()
