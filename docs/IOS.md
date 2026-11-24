# Meridian Afterglow on iPad (side-loaded)

The iPad app is a thin Xcode wrapper (`ios/`) around the same web game as the website and Mac app. It is iPad-only, iOS 16+, landscape.

## A. Build it yourself in Xcode (fastest, on the Mac)
0. One-time setup: install Xcode (free, Mac App Store) and Node.js 22 (nodejs.org), then get the code:
   `git clone https://github.com/jcorrea510/astratest.git && cd astratest` (or GitHub Desktop > Clone).
1. In the repo folder run `npm install && npm run ios:web`. This builds the game into `ios/MeridianAfterglow/game`.
2. Open `ios/MeridianAfterglow.xcodeproj` in Xcode.
3. Xcode > Settings > Accounts: sign in with your Apple ID.
4. Click the project (left sidebar) > target MeridianAfterglow > Signing & Capabilities > Team = your Personal Team.
   If Xcode says the bundle id is taken, change `com.meridianafterglow.game` to something unique (e.g. add your name).
5. iPad: Settings > Privacy & Security > Developer Mode > On (it restarts). Plug the iPad into the Mac and tap Trust.
6. Pick your iPad at the top of Xcode and press Run. On the iPad, if asked, trust the developer in Settings > General > VPN & Device Management.

A free Apple ID installs last 7 days: press Run again to renew. A paid Developer Program account ($99/yr) lasts a year and allows TestFlight.
If you see "The web game is not built", repeat step 1.

## B. Without building: the ready-made .ipa
Download `MeridianAfterglow-unsigned.ipa` from the GitHub release `ios-latest` (or the Actions run artifact). It is unsigned, so install it with
Sideloadly or AltStore: they sign it with your Apple ID and push it to the iPad (same 7-day limit on a free Apple ID).

## C. Playing
- Bluetooth/Magic Keyboard + trackpad or mouse work, and so does a paired controller (PS5, Xbox, MFi): connect it in Settings > Bluetooth first.
- If the mouse cursor cannot be locked, the game falls back to cursor / drag look automatically.
- Debugging: iPad Settings > Apps > Safari > Advanced > Web Inspector On; on the Mac Safari > Develop > your iPad > Meridian Afterglow.
- The CI build is `.github/workflows/ios.yml` (artifact on every run, release `ios-latest` from main).
