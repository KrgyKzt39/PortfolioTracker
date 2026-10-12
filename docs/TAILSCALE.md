# Open the app from anywhere with Tailscale

Tailscale links your PC and iPhone in a private network. The app then opens on your iPhone over 4G/5G or any Wi-Fi, but only on your own devices: nothing is public, so the app does not need a login. The free Personal plan is enough.

You need Tailscale on **both** devices: the PC is the one the iPhone connects to. The Tailscale website (admin console) is only for settings; it does not connect the PC by itself.

## One-time setup (about 10 minutes)

### On the PC

1. Download and install Tailscale for Windows: https://tailscale.com/download/windows
2. Sign in with the **same account** you use in the Tailscale app on your iPhone (e.g. the same Google or Apple ID).
3. A Tailscale icon appears near the clock. Click it: it should say *Connected* and show this PC's name.
4. Run `start.bat`. If it asks **"Allow access from your iPhone"**, answer **Y**.
   - If you answered N before: open `.env` in Notepad, change `PT_HOST=127.0.0.1` to `PT_HOST=0.0.0.0`, save, and run `start.bat` again.
5. If Windows Firewall asks about Python, tick **Private networks** and allow. (Windows treats the Tailscale connection as a private network.)
6. The start window now prints a line like:

   ```
   From anywhere with Tailscale on (see docs/TAILSCALE.md):
        http://my-pc:8000
        http://100.x.y.z:8000
   ```

   The same addresses are in the app under Settings → iPhone access.

### On the iPhone

1. Open the Tailscale app, sign in with the same account, and switch it **on** (it asks once to add a VPN configuration: allow).
2. Your PC should appear in the device list.
3. In Safari, open the address from the start window, e.g. `http://my-pc:8000`. If the name does not work, use the `100.x.y.z` one.
4. Share → **Add to Home Screen**. This icon now works at home and away.
   - If you added the app to your Home Screen before with a `192.168…` address, delete that icon and add it again with the Tailscale address.

## Everyday use

- The **PC must be on and awake** with `start.bat` running. To keep it awake: Windows Settings → System → Power → *When plugged in, put my device to sleep after* → **Never**.
- **Tailscale must be on** on the iPhone (it can stay on all the time; it only routes traffic to your own devices).

## If it does not open

| What you see | Fix |
|---|---|
| Safari spins, then "could not connect" | PC asleep or `start.bat` closed; or Tailscale switched off on one device. Check the PC shows *Connected*. |
| Works at home, not away | You are still using the `192.168…` address. Use the Tailscale one. |
| Name (`my-pc`) does not work, IP does | MagicDNS is off. Use the `100.x.y.z` address, or turn on MagicDNS in the Tailscale admin console → DNS. |
| Neither works, Tailscale says Connected | Windows Firewall or antivirus is blocking Python. Allow Python for private networks (Windows Security → Firewall → Allow an app). Third-party firewalls (e.g. Bitdefender) may need their own rule. |

## Do not

- Do not turn on **Tailscale Funnel** for this app: that makes it public on the internet, and the app has no login.
- Do not port-forward on your router.
