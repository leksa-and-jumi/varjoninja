# CLAUDE.md

Tämä repo kuuluu Julius (7 v) ja Leo (10 v) -veljesten pelistudioon (GitHub-organisaatio `leksa-and-jumi`). Vanhempi valvoo aina istuntoja.

**Varjoninja** on 3D-avoimen maailman peli: ninja heiluu köydellä kaupungissa, kiipeää seiniä, pysäyttää roistoja ja pelastaa kissoja. Pelin suunnitteli **Julius**. Hän päättää säännöt, hahmot, ulkoasun ja uudet ominaisuudet.

## Näin puhut Juliukselle

- **Aina suomeksi**, lyhyesti, selkokielellä ja kannustavasti. Emojit auttavat (🥷🪢🏙️).
- Julius ei välttämättä lue vielä sujuvasti: vanhempi voi lukea viestit ääneen.
- **Vain lapselle**: ei git-, PR- tai tekniikkapuhetta eikä erillisiä viestejä vanhemmalle. Tekniikka hoidetaan hiljaa issueissa ja PR:issä.
- Kysy **yksi asia kerrallaan**, 2–4 vaihtoehtoa emojeineen.

## Turvallisuus (älä riko näitä)

- Pelaaja on vain ninjan värit: **ei nimiä, ikää, kuvia tai muita henkilötietoja** peliin, laitteelle tai huonepalvelimelle.
- **Ei chattia.** Moninpeliin pääsee vain koodilla (ei julkista huonelistaa). Ei mainoksia, seurantaa tai ostoja.
- Väkivalta on sarjakuvamaista: ei verta. Tyrmätty ihminen makaa hetken tähdet pään ympärillä ja katoaa savupilveen. Sivullisen satuttamisesta tulee poliisitähtiä (sankari suojelee kaikkia). Julius toivoi, että tavallisia ihmisiä voi vahingoittaa; tämä on toteutettu näin lapsiystävällisesti.
- Huonepalvelin hyväksyy vain sallitut sivut (`ALLOWED_ORIGINS` tiedostossa `wrangler.jsonc`) ja tarkistaa jokaisen viestin (`src/logic/protocol.ts`).
- Älä koskaan commitoi salaisuuksia: `.env.local` ja `.dev.vars` ovat gitignoressa. Avaimia ei tulosteta.

## Tekniikka

- **TypeScript (strict) + Vite + Three.js** (ei Phaser: peli on 3D). Ei fysiikkamoottoria: kaupunki on laatikoita, ja törmäykset tehdään itse (`src/logic/player.ts`, `people.ts`, `vehicle.ts`).
- Rakenne:
  - `src/config.ts` – kaikki vakiot (myös worker käyttää).
  - `src/logic/` – puhdas logiikka ilman Three.js:ää: kaupunki (`city.ts`), ninjan liike (`player.ts`: juoksu, tuplahyppy, seinäkiipeily, köysiheilunta, vetoköysi, uinti), köyden kiinnityskohta (`rope.ts`), liikenne (`traffic.ts`), ihmiset ja heidän aivonsa (`people.ts`), ajettava auto (`vehicle.ts`), rikokset (`crimes.ts`), päivä/yö (`daytime.ts`), verkkoviestit (`protocol.ts`). **Jokaisella logiikkatiedostolla on testi.**
  - `src/render/` – Three.js: kaupungin meshit (`cityRenderer.ts`), shaderit (`materials.ts`: ikkunat, tiemerkinnät ja lyhtyjen valot piirretään shaderissa maailman koordinaateista), taivas (`sky.ts`), hahmot (`characters.ts` + `animator.ts`), ninja (`ninjaView.ts`: köysi ja otsanauhan liehuvat hännät), autot (`carView.ts`), partikkelit (`effects.ts`), bloom (`postfx.ts`).
  - `src/play/` – pelin kulku: kamera, `world.ts` (ihmiset, liikenne, taistelu, poliisi, rikokset, keräiltävät), `remotes.ts` (kavereiden hahmot).
  - `src/ui/` – HUD, valikot, näppäimistö/hiiri ja kosketusohjaus. `src/audio/` – syntetisoidut äänet. `src/net/` – huoneyhteys.
  - `worker/` – huonepalvelin. `blender/` – mallien teko.
- **Kaupunki tulee siemenestä** (`CITY.seed`): kaikilla sama kaupunki ilman verkkoliikennettä. 10 × 10 korttelia, keskustassa pilvenpiirtäjät, laidoilla matalampaa, saari meren keskellä.
- **Hahmot** (`public/models/character.glb`): yksi riggattu vartalo Blenderistä (skin modifier + subdivision, luut nimetty). Värit eivät ole mallissa: jokaisen verteksin UV.x on "alue" (iho, paita, housut, kengät, naamio…) ja shader värittää alueet hahmon paletista. Asusteet (hiukset, lippis, poliisin lakki, otsanauha, vyö, miekka) ovat luihin kiinnitettyjä mesheja, joita näytetään tai piilotetaan. GLTFLoader poistaa pisteet nimistä (`upperArm.L` → `upperArmL`).
- **Animaatiot ovat koodia** (`animator.ts`): asento lasketaan joka ruudulla ja luita käännetään hahmon omissa akseleissa (x = eteen/taakse, z = sivulle). Ei animaatiotiedostoja.
- **Autot** (`public/models/car_*.glb`): sedan, taksi, poliisi, pakettiauto, urheiluauto. Materiaalien nimet (`paint`, `headlight`, `siren_red`…) korvataan pelissä; renkaat ovat omia objektejaan.
- Mallien muutos: muokkaa `blender/build_models.py` ja aja `npm run models` (Blender asennettu Homebrew'lla: `/Applications/Blender.app`). Commitoi syntyneet `.glb`-tiedostot.
- **Rikokset** tulevat kellosta ja huoneen siemenestä (`crimeForSlot`): kaikki saman huoneen pelaajat näkevät saman rikoksen samassa paikassa. Verkossa kulkee vain "ratkaistu".
- **Päivä ja yö** tulevat kellosta (`timeOfDay`, vuorokausi 16 min), moninpelissä palvelimen kellosta.

## Cloudflare-kiintiö (tärkeä)

Ilmaisessa tasossa on 100 000 pyyntöä päivässä (WebSocket-viestit lasketaan mukaan). Siksi:

- Huonepalvelin **ei tallenna mitään** (ei SQLiteä, ei storagea). Ratkaistut rikokset ovat vain muistissa.
- Sijainti lähetetään korkeintaan `NET.sendRate` kertaa sekunnissa, **vain kun liikkuu** (`moveDeadZone`) ja **vain kun huoneessa on joku muu**. Yksin pelatessa ei lähetetä mitään.
- Muiden hahmot interpoloidaan 160 ms viiveellä (`src/play/remotes.ts`).
- Uusi viestityyppi tarvitsee aina nopeusrajan. Ihmiset, autot ja rikokset simuloidaan jokaisella koneella itse, eikä niitä lähetetä.
- Huone nukkuu (hibernation), kun kukaan ei lähetä viestejä.

## Ympäristömuuttujat

`.env.local` (pohja `.env.example`): `VITE_ROOM_URL` (paikallisesti `http://localhost:8791`), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (`npm run room:deploy`). GitHub Actions -deploy käyttää secretejä `CLOUDFLARE_API_TOKEN` ja `CLOUDFLARE_ACCOUNT_ID`; huonepalvelimen osoite on `deploy.yml`:ssä.

## Kehitysputki (aina sama)

1. Idea → GitHub issue (otsikko englanniksi, kuvaus Juliuksen omin sanoin suomeksi).
2. Uusi haara mainista: `feat/…`, `fix/…`, `chore/…`.
3. Pienet commitit, Conventional Commits englanniksi.
4. PR pohjan mukaan: tekninen kuvaus englanniksi + osio **Pojille**. `Closes #n`.
5. `npm run check` ja `npm run build` paikallisesti. CI:n pitää olla vihreä.
6. Squash merge, haaran poisto. Merge julkaisee automaattisesti (Pages + Worker).

## Testaus selaimessa

- Studion juuren `.claude/launch.json`: `varjoninja` (portti 5181) ja `varjoninja-room` (8791).
- Esikatselupaneelissa hiiren lukitus ei toimi: peli vaihtaa silloin raahaamalla katsomiseen. Kehitystilassa `window.__game()` antaa pelin (`input.press('rope')`, `player`, `world`, `timeOffset = 0.5` vaihtaa yöksi).
- Testaa omassa välilehdessä, jos lapsi pelaa samaan aikaan esikatselussa.
