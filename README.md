# Room99 Feed Duplicator

Pobiera feed Google PL z FeedOptimise → dodaje 360 duplikatów GARDEN LINE z różnymi tytułami → publikuje publicznie. **Działa na GitHub. Zero kosztów. Nic u Ciebie nie działa.**

---

## Setup — 5 minut

### Krok 1: Utwórz repo na GitHub
1. Wejdź na **https://github.com/new**
2. Repository name: `room99-feed-duplicator`
3. Wybierz **Public**
4. Kliknij **Create repository**

### Krok 2: Wgraj 4 pliki (drag&drop)
W swoim nowym repo:
1. Kliknij **Add file → Upload files**
2. Przeciągnij te 4 pliki:
   - `README.md`
   - `generate-feed.js`
   - `config.json`
   - `package.json`
3. Kliknij **Commit changes**

### Krok 3: Stwórz plik workflow (1 raz, ręcznie w GitHub)
GitHub Actions WYMAGA pliku w folderze `.github/workflows/`. Mac ukrywa foldery z kropką — dlatego robimy to bezpośrednio w GitHub:

1. W repo kliknij **Add file → Create new file**
2. W polu **nazwy pliku** wpisz dokładnie (z ukośnikiem!):
   ```
   .github/workflows/regenerate-feed.yml
   ```
   (GitHub automatycznie utworzy oba foldery)
3. Otwórz plik **`WORKFLOW-do-wgrania-recznie/regenerate-feed.yml`** w swoim folderze projekta
4. **Skopiuj cały jego zawartość** i wklej w GitHub web editor
5. Na dole strony: **Commit new file**

### Krok 4: Włącz GitHub Pages
1. **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)**
4. **Save**

### Krok 5: Uruchom pierwszy raz
1. Zakładka **Actions**
2. Kliknij **Regenerate Feed (cron)** (w lewym menu)
3. Po prawej: **Run workflow** → zielony button **Run workflow**
4. Czekaj 30s aż się skończy (zielony ✓)

### Krok 6: Skopiuj URL i wklej w GMC
Publiczny URL będzie:
```
https://<TWOJ-USERNAME>.github.io/room99-feed-duplicator/output/google-pl-with-test-titles.tsv
```

W **Google Merchant Center → Products → Feeds → Add primary feed** → URL → wklej.

---

## To wszystko. Działa się samo:

- ✅ **Co 1h** GitHub Actions cron pobiera świeży feed z FeedOptimise, regeneruje 360 duplikatów GARDEN LINE
- ✅ **GMC** pobiera zmodyfikowany feed co kilka godzin
- ✅ **Twoje kampanie Google Ads** filtrujesz po `custom_label_0=TITLE_TEST` i segmentujesz po `custom_label_1` (t1/t2/t3/t4/t5)
- ✅ **Zero opłat** — GitHub Actions free tier (2000 min/m-c), GitHub Pages free
- ✅ **Zero pracy** — działa autonomicznie

---

## Skalowanie — dodajesz kolejne grupy keywords

Edytuj `config.json` na GitHub (kliknij plik → edit pencil icon):

```json
{
  "id": "marshmallow-m1",
  "matchInTitle": "MARSHMALLOW",
  "searchInTitle": "POSZEWKA DEKORACYJNA",
  "replaceWith": "POSZEWKA OZDOBNA",
  "dupSuffix": "m1",
  "customLabel1": "m1",
  "active": true
}
```

Po commitcie automatycznie regeneruje feed (workflow trigger na push do `config.json`).

---

## Co dostajesz w duplikatach

| Pole | Wartość |
|---|---|
| `id` | `{original_id}_{dupSuffix}` (np. `9491_t1`) |
| `title` | Z F&R case-insensitive: `searchInTitle` → `replaceWith` |
| `gtin` | **puste** (poprawka audytora — żeby GMC nie odrzucił jako "Duplicate Product") |
| `mpn` | **puste** |
| `identifier_exists` | `no` |
| `custom_label_0` | `TITLE_TEST` (filtruj w Google Ads) |
| `custom_label_1` | `t1` / `t2` / `m1` etc. (segmentacja kampanii) |
| Pozostałe pola | dziedziczone z parent (cena, link, image, availability — auto z Shopera) |

---

## Wyniki obecnej konfiguracji

```
72 produkty GARDEN LINE × 5 keywords = 360 duplikatów
+ 1841 oryginałów
= 2201 wierszy w output TSV
```

Twoje 5 keywords:
- `t1` → ZASŁONA DO ALTANY
- `t2` → ZASŁONA NIEPRZEMAKALNA
- `t3` → ZASŁONA WODOSZCZELNA
- `t4` → ZASŁONA BALKONOWA
- `t5` → ZASŁONA DO PERGOLI

---

## Troubleshooting

**"GitHub Action fails / red X"** → Kliknij failed run w Actions, zobacz logi.

**"GMC odrzuca duplikaty"** → Sprawdź czy `identifier_exists=no` i `gtin/mpn` są puste w output.

**"Chcę inny okres update"** → W workflow `cron: '0 * * * *'` → zmień na `'*/30 * * * *'` (30 min).

**"Chcę wyłączyć test"** → W `config.json` zmień `"active": true` na `false` dla danej reguły.
