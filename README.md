# 🥷 Varjoninja

Varjosaaren kaupunki tarvitsee sankaria! Olet ninja, joka heiluu köydellä pilvenpiirtäjien välissä, kiipeää seiniä ja pysäyttää roistot. Kaupungissa on autoja, ihmisiä, poliiseja ja koko ajan uusia rikoksia. Päivä vaihtuu yöksi ja yö päiväksi.

**Pelaa:** https://leksa-and-jumi.github.io/varjoninja/

Pelin suunnitteli **Julius**. Ninjan värit saa valita itse 🎨.

## Miten pelataan

| Näppäin              | Mitä tapahtuu                                   |
| -------------------- | ----------------------------------------------- |
| `WASD` tai nuolet    | Liiku                                           |
| `Shift`              | Juokse lujaa                                    |
| `Välilyönti`         | Hyppää (ilmassa uudestaan = voltti)             |
| Oikea hiiri tai `E`  | Köysi: pidä pohjassa ja heilu, päästä irti      |
| `Q` tai hiiren rulla | Vedä itsesi köydellä suoraan tähtäimeen         |
| Vasen hiiri          | Isku (monta = kombo), ilmassa syöksypotku       |
| `R`                  | Heitä shuriken                                  |
| `G`                  | Savupommi (roistot hämmentyvät, poliisi hukkaa) |
| `F`                  | Hyppää autoon / nouse autosta                   |
| `M`                  | Iso kartta                                      |
| `H`                  | Näytä / piilota ohjeet                          |
| `Esc`                | Tauko                                           |

Juokse seinää päin, niin ninja kiipeää ylös. Tabletilla on kosketusnapit.

### Mitä kaupungissa tehdään

- 👜 **Laukkuvaras** – ota varas kiinni ennen kuin hän karkaa.
- 👊 **Jengi riehuu** – pysäytä kaikki jengiläiset.
- 🚗 **Autovaras** – pysäytä auto potkuilla tai shurikeneilla ja nappaa varas.
- 🐱 **Kissa katolla** – kiipeä katolle ja pelasta kissa.
- 🥇 **Kultaiset shurikenit** – 40 kappaletta piilossa katoilla.

Rikokset näkyvät kartalla ja punaisena valopylväänä. Ratkaisusta saa **sankaripisteitä**, ja pisteillä nousee sankariarvo.

Sankari ei satuta tavallisia ihmisiä: jos lyöt sivullista, **poliisi** lähtee perään (tähdet oikeassa yläkulmassa). Karkaa katoille tai heitä savupommi.

### Kaverin kanssa

Valitse **Pelaa kaverin kanssa**, niin peli antaa koodin (esim. `SALAMA-VARJO-98`). Kaveri kirjoittaa saman koodin omalla koneellaan. Näette toisenne ja ratkaisette samoja rikoksia. Pelissä ei ole nimiä eikä chattia.

## Kehittäjille

- **TypeScript + Vite + Three.js** (3D), testit Vitestillä.
- Hahmot ja autot on tehty **Blenderillä** koodista: `blender/build_models.py` → `public/models/*.glb` (`npm run models`).
- Moninpeli: **Cloudflare Worker + Durable Objects** (`worker/index.ts`). Huone vain välittää viestit, mitään ei tallenneta.

```bash
npm install
npm run dev          # peli: http://localhost:5181
npm run dev:room     # huonepalvelin moninpeliin: http://localhost:8791
npm run check        # tyypit, lint, muotoilu, testit
npm run build        # tuotantoversio dist/-kansioon
```

Tarkemmat ohjeet: [CLAUDE.md](CLAUDE.md). Lähteet ja lisenssit: [CREDITS.md](CREDITS.md).
